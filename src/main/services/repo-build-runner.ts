import { existsSync, readdirSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { utf8ChildEnv } from '../../shared/encoding'

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'uv' | 'poetry' | 'unknown'

export interface DetectedBuildPlan {
  packageManager: PackageManager
  /** 探测到的锁文件 / 依赖清单 */
  manifests: string[]
  /** 建议的依赖安装命令；无法判断时为 null */
  suggestedInstallCommand: string | null
}

/** 允许执行的构建命令首词白名单 */
const ALLOWED_COMMANDS = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'tsc',
  'vite',
  'webpack',
  'rollup',
  'esbuild',
  'parcel',
  'pip',
  'pip3',
  'python',
  'python3',
  'uv',
  'poetry',
  'hatch',
  'pdm',
  'make',
  'cmake',
  'ninja',
  'gcc',
  'g++',
  'clang',
  'go',
  'cargo',
  'swiftc',
  'mvn',
  'gradle'
])

/** 反引号、变量展开、管道、重定向、换行，以及非 && 形式的单个 & */
const FORBIDDEN_PATTERN = /[`$;|><\n\r]|(?<!&)&(?!&)/

export const MAX_BUILD_COMMANDS = 5
export const MAX_BUILD_COMMAND_LENGTH = 500
export const DEFAULT_BUILD_TIMEOUT_MS = 10 * 60 * 1000

export class BuildCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuildCommandError'
  }
}

const LOCKFILE_MANAGERS: Array<{ file: string; manager: PackageManager }> = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' }
]

const PYTHON_MANIFESTS = ['uv.lock', 'poetry.lock', 'pyproject.toml', 'requirements.txt', 'Pipfile']

export function detectBuildPlan(rootDir: string): DetectedBuildPlan {
  const manifests: string[] = []
  let manager: PackageManager = 'unknown'

  for (const candidate of LOCKFILE_MANAGERS) {
    if (existsSync(join(rootDir, candidate.file))) {
      manifests.push(candidate.file)
      if (manager === 'unknown') manager = candidate.manager
    }
  }

  if (manager === 'unknown' && existsSync(join(rootDir, 'package.json'))) {
    manifests.push('package.json')
    manager = 'npm'
  }

  for (const file of PYTHON_MANIFESTS) {
    if (existsSync(join(rootDir, file))) manifests.push(file)
  }

  let pythonManager: PackageManager = 'unknown'
  if (existsSync(join(rootDir, 'uv.lock'))) pythonManager = 'uv'
  else if (existsSync(join(rootDir, 'poetry.lock'))) pythonManager = 'poetry'
  else if (manifests.some((m) => m === 'pyproject.toml' || m === 'requirements.txt' || m === 'Pipfile')) {
    pythonManager = 'pip'
  }

  const suggestedInstallCommand = buildInstallCommand(manager, pythonManager)
  return { packageManager: manager === 'unknown' ? pythonManager : manager, manifests, suggestedInstallCommand }
}

function buildInstallCommand(jsManager: PackageManager, pythonManager: PackageManager): string | null {
  switch (jsManager) {
    case 'pnpm':
      return 'pnpm install'
    case 'yarn':
      return 'yarn install'
    case 'bun':
      return 'bun install'
    case 'npm':
      return 'npm install'
    default:
      break
  }
  switch (pythonManager) {
    case 'uv':
      return 'uv sync'
    case 'poetry':
      return 'poetry install'
    case 'pip':
      return 'pip install -r requirements.txt'
    default:
      return null
  }
}

/** 校验单条构建命令；不通过时抛出带原因的 BuildCommandError */
export function assertSafeBuildCommand(rawCommand: string): string {
  const command = rawCommand?.trim()
  if (!command) throw new BuildCommandError('构建命令为空')
  if (command.length > MAX_BUILD_COMMAND_LENGTH) {
    throw new BuildCommandError(`构建命令过长（上限 ${MAX_BUILD_COMMAND_LENGTH} 字符）`)
  }
  if (FORBIDDEN_PATTERN.test(command)) {
    throw new BuildCommandError(`构建命令包含不允许的 shell 元字符：${command}`)
  }
  const first = command.split(/\s+/)[0]
  const binary = first.split(/[/\\]/).pop() ?? first
  const normalized = binary.replace(/\.(cmd|exe|bat|ps1)$/i, '').toLowerCase()
  if (!ALLOWED_COMMANDS.has(normalized)) {
    throw new BuildCommandError(`构建命令不在允许清单中：${binary}`)
  }
  return command
}

export function assertSafeBuildCommands(commands: string[]): string[] {
  if (!Array.isArray(commands)) return []
  const cleaned = commands.map((command) => String(command ?? '').trim()).filter(Boolean)
  if (cleaned.length > MAX_BUILD_COMMANDS) {
    throw new BuildCommandError(`构建命令过多（上限 ${MAX_BUILD_COMMANDS} 条）`)
  }
  return cleaned.map(assertSafeBuildCommand)
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      /* ignore */
    }
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    /* ignore */
  }
}

function createLineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = ''
  return (chunk) => {
    buffer += chunk.toString('utf-8')
    const parts = buffer.split(/\r\n|\r|\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (line) onLine(line)
    }
  }
}

export interface RunBuildCommandsInput {
  rootDir: string
  commands: string[]
  onLog: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void
  timeoutMs?: number
}

export interface RunBuildCommandsResult {
  ok: boolean
  executed: string[]
  failedCommand?: string
  error?: string
}

function runSingleCommand(
  command: string,
  cwd: string,
  onLog: RunBuildCommandsInput['onLog'],
  timeoutMs: number
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    const finish = (ok: boolean, error?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, error })
    }

    // 通过 shell 执行以支持 npm/pnpm 等 .cmd 包装脚本；命令已通过白名单与元字符校验
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `chcp 65001 >nul && ${command}`], {
            cwd,
            shell: false,
            windowsHide: true,
            env: utf8ChildEnv({ CI: '1', NPM_CONFIG_FUND: 'false', NPM_CONFIG_AUDIT: 'false' })
          })
        : spawn('sh', ['-c', command], {
            cwd,
            shell: false,
            env: utf8ChildEnv({ CI: '1', NPM_CONFIG_FUND: 'false', NPM_CONFIG_AUDIT: 'false' })
          })

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)

    const splitter = createLineSplitter((line) => onLog('INFO', line))
    child.stdout?.on('data', splitter)
    child.stderr?.on('data', splitter)

    child.on('error', (error) => finish(false, error.message))
    child.on('close', (code) => {
      if (timedOut) {
        finish(false, `执行超时（${Math.round(timeoutMs / 1000)} 秒）`)
        return
      }
      if (code === 0) {
        finish(true)
        return
      }
      finish(false, `退出码 ${code}`)
    })
  })
}

/** 依次执行构建命令，任一条失败即停止 */
export async function runBuildCommands(input: RunBuildCommandsInput): Promise<RunBuildCommandsResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS
  const executed: string[] = []

  for (const command of input.commands) {
    input.onLog('INFO', `$ ${command}`)
    const result = await runSingleCommand(command, input.rootDir, input.onLog, timeoutMs)
    if (!result.ok) {
      input.onLog('ERROR', `命令失败：${command}（${result.error ?? '未知原因'}）`)
      return { ok: false, executed, failedCommand: command, error: result.error }
    }
    executed.push(command)
  }

  return { ok: true, executed }
}

/** 判断目录下是否已经存在常见的构建产物 */
export function detectExistingBuildOutput(rootDir: string): string[] {
  const candidates = ['dist', 'build', 'out', 'lib', '.next', 'public/build']
  return candidates.filter((name) => {
    const path = join(rootDir, name)
    if (!existsSync(path)) return false
    try {
      return readdirSync(path).length > 0
    } catch {
      return false
    }
  })
}
