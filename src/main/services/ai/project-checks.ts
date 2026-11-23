import { execFile } from 'node:child_process'
import { lstatSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { resolveSafeExistingWorkspaceFile, scriptWorkspace } from '../script-workspace'
import type { ScriptManifest } from '../../../shared/script-contract'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_ENTRY_BYTES = 512 * 1024
const MAX_DIAGNOSTIC_BYTES = 64 * 1024
const PYTHON_AST_CHECK =
  'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), filename=sys.argv[1])'

interface CommandOptions {
  timeoutMs: number
  cwd: string
  env?: NodeJS.ProcessEnv
}

interface CommandResult {
  stdout: string
  stderr: string
}

type CommandRunner = (executable: string, args: string[], options: CommandOptions) => Promise<CommandResult>

export interface ProjectCheckResult {
  status: 'passed' | 'failed' | 'blocked'
  code: string
  message: string
  diagnostics: string[]
}

export interface ProjectChecksOptions {
  timeoutMs?: number
  runCommand?: CommandRunner
  validatePackageDirectory?: (projectPath: string) => ScriptManifest
  resolvePython?: () => Promise<{ executable: string; args?: string[] }>
}

function defaultRunCommand(executable: string, args: string[], options: CommandOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: MAX_DIAGNOSTIC_BYTES,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, ...options.env, NODE_OPTIONS: '' }
    }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr })
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function diagnosticsFrom(error: unknown): string[] {
  const record = error as NodeJS.ErrnoException & { stderr?: string }
  const stderr = typeof record.stderr === 'string' ? record.stderr : ''
  const line = /line (\d+)/i.exec(stderr)?.[1] ?? /:(\d+)(?::\d+)?(?:\r?\n|$)/.exec(stderr)?.[1]
  const errorType = /\b(SyntaxError|IndentationError|TabError):/.exec(stderr)?.[1] ?? 'SyntaxError'
  return [line ? `${errorType} at line ${line}` : errorType]
}

function checkResult(
  status: ProjectCheckResult['status'],
  code: string,
  message: string,
  diagnostics: string[] = []
): ProjectCheckResult {
  return { status, code, message, diagnostics }
}

function findUnsafePackagePath(projectPath: string): { path: string; code: 'project_symlink' | 'project_special_file' } | null {
  const pending = [projectPath]
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      const relativePath = relative(projectPath, path).replace(/\\/g, '/')
      if (stat.isSymbolicLink()) return { path: relativePath, code: 'project_symlink' }
      if (stat.isDirectory()) pending.push(path)
      else if (!stat.isFile()) return { path: relativePath, code: 'project_special_file' }
    }
  }
  return null
}

async function resolvePythonCommand(
  pythonExecutable?: string,
  configuredResolver?: ProjectChecksOptions['resolvePython']
): Promise<{ executable: string; args: string[] } | null> {
  if (pythonExecutable?.trim()) return { executable: pythonExecutable.trim(), args: [] }
  if (configuredResolver) {
    try {
      const configured = await configuredResolver()
      return { executable: configured.executable, args: configured.args ?? [] }
    } catch {
      return null
    }
  }
  try {
    const resolver = await import('../python-resolver')
    const info = await resolver.resolvePythonExecutable()
    const command = resolver.buildPythonCommand(info)
    return { executable: command.executable, args: command.baseArgs }
  } catch {
    return null
  }
}

export function createProjectChecks(options: ProjectChecksOptions = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const runCommand = options.runCommand ?? defaultRunCommand
  const validatePackage = options.validatePackageDirectory ?? ((path: string) => scriptWorkspace.validatePackageDirectory(path))

  async function checkScriptPackage(projectPath: string): Promise<ProjectCheckResult> {
    try {
      const unsafePath = findUnsafePackagePath(projectPath)
      if (unsafePath) {
        return checkResult('failed', unsafePath.code, '项目包不能包含符号链接或特殊文件', [unsafePath.path])
      }
      validatePackage(projectPath)
      return checkResult('passed', 'package_valid', '脚本包校验通过')
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知校验错误'
      return checkResult('failed', 'invalid_package', '脚本包校验失败', [detail.slice(0, 500)])
    }
  }

  async function checkScriptSyntax(
    projectPath: string,
    manifest: ScriptManifest,
    pythonExecutable?: string
  ): Promise<ProjectCheckResult> {
    const language = manifest.language
    if (language !== 'javascript' && language !== 'python') {
      return checkResult('blocked', 'unsupported_language', '当前仅支持 JavaScript 和 Python 脚本')
    }

    let entryPath: string
    try {
      entryPath = resolveSafeExistingWorkspaceFile(projectPath, manifest.entry ?? 'index.mjs')
      if (statSync(entryPath).size > MAX_ENTRY_BYTES) {
        return checkResult('blocked', 'entry_too_large', '脚本入口超过 512 KiB，无法安全检查')
      }
    } catch {
      return checkResult('failed', 'invalid_entry', '脚本入口文件无效')
    }

    const executable = language === 'javascript' ? process.execPath : undefined
    let args: string[]
    if (language === 'javascript') {
      args = ['--check', entryPath]
    } else {
      const python = await resolvePythonCommand(pythonExecutable, options.resolvePython)
      if (!python) return checkResult('blocked', 'python_missing', '未检测到可用的 Python 解释器')
      args = [...python.args, '-I', '-c', PYTHON_AST_CHECK, entryPath]
      try {
        await runCommand(python.executable, args, { timeoutMs, cwd: projectPath })
        return checkResult('passed', 'syntax_valid', 'Python 语法检查通过')
      } catch (error) {
        return mapCommandError(error, 'python')
      }
    }

    try {
      await runCommand(executable!, args, { timeoutMs, cwd: projectPath, env: { ELECTRON_RUN_AS_NODE: '1' } })
      return checkResult('passed', 'syntax_valid', 'JavaScript 语法检查通过')
    } catch (error) {
      return mapCommandError(error, 'javascript')
    }
  }

  return { checkScriptPackage, checkScriptSyntax }
}

function mapCommandError(error: unknown, language: 'javascript' | 'python'): ProjectCheckResult {
  const commandError = error as NodeJS.ErrnoException & { killed?: boolean }
  const code = commandError.code
  if (code === 'ETIMEDOUT' || commandError.killed) {
    return checkResult('blocked', 'checker_timeout', '脚本语法检查超时')
  }
  if (language === 'python' && code === 'ENOENT') {
    return checkResult('blocked', 'python_missing', '未检测到可用的 Python 解释器')
  }
  if (code !== undefined || (error as { stderr?: string }).stderr) {
    return checkResult(
      'failed',
      language === 'python' ? 'python_syntax' : 'javascript_syntax',
      language === 'python' ? 'Python 语法检查失败' : 'JavaScript 语法检查失败',
      diagnosticsFrom(error)
    )
  }
  return checkResult('blocked', 'checker_failed', '无法完成脚本语法检查')
}

