import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { getAppUserDataPath } from './app-data-root'
import { buildIsolatedPythonEnv } from './python-isolated-env'
import { decodeUtf8 } from '../../shared/encoding'
import { parsePythonProtocolLine } from '../../shared/script-protocol'
import type { LogLine, ScriptMeta } from '../../shared/types/script'
import type { ScriptControlMessage } from '../../shared/script-progress'
import {
  buildPythonCommand,
  getPythonRuntimeRoot,
  resolvePythonExecutable
} from './python-resolver'
import { pythonDependencyManager } from './python-dependency-manager'
import { scriptStore } from './script-store'
import { resolvePythonBrowserLaunchConfig } from './browser-path'

export interface PythonRunCallbacks {
  log: (level: LogLine['level'], message: string) => void
  control: (message: ScriptControlMessage) => void
  onPid: (pid: number) => void
  isAborted: () => boolean
}

export interface PythonRunOutcome {
  ok: boolean
  result?: unknown
  errorMessage?: string
  aborted?: boolean
}

/** 终止 Python 子进程（含 Windows 进程树） */
export function killPythonProcess(child: ChildProcess | null | undefined): void {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }, 2000)
}

function buildPythonPath(script: ScriptMeta, runtimeRoot: string): string {
  const parts = [runtimeRoot, script.workspacePath]
  const globalSite = pythonDependencyManager.getGlobalSitePackagesPath()
  if (globalSite) parts.push(globalSite)
  const scriptSite = pythonDependencyManager.getScriptSitePackagesPath(script.workspacePath)
  if (scriptSite) parts.push(scriptSite)
  return parts.join(process.platform === 'win32' ? ';' : ':')
}

/** 在子进程中运行 Python 脚本 */
export async function runPythonScript(
  script: ScriptMeta,
  sessionId: string,
  env: Record<string, string>,
  params: Record<string, string>,
  callbacks: PythonRunCallbacks,
  getChild: () => ChildProcess | undefined,
  setChild: (child: ChildProcess | undefined) => void
): Promise<PythonRunOutcome> {
  const python = await resolvePythonExecutable(scriptStore.getConfig().python)
  const runtimeRoot = getPythonRuntimeRoot()
  if (!existsSync(join(runtimeRoot, 'autoforge_runtime'))) {
    return {
      ok: false,
      errorMessage: `缺少 Python 运行时: ${runtimeRoot}/autoforge_runtime`
    }
  }

  const entryPath = join(script.workspacePath, script.entry)
  const config = scriptStore.getConfig()
  const browserLaunch = resolvePythonBrowserLaunchConfig(config, {
    headless: script.browser?.headless
  })
  const ctxPayload = {
    sessionId,
    scriptId: script.id,
    env,
    params,
    browser: browserLaunch,
    paths: {
      userData: getAppUserDataPath(),
      scriptDir: script.workspacePath
    }
  }

  const venvDir = pythonDependencyManager.getVenvDir(script.workspacePath)
  const childEnv = buildIsolatedPythonEnv({
    AUTOFORGE_SESSION_ID: sessionId,
    AUTOFORGE_SCRIPT_ID: script.id,
    AUTOFORGE_ENTRY_PATH: entryPath,
    AUTOFORGE_CTX_JSON: JSON.stringify(ctxPayload),
    AUTOFORGE_RUNTIME_ROOT: runtimeRoot,
    PYTHONPATH: buildPythonPath(script, runtimeRoot),
    PLAYWRIGHT_BROWSERS_PATH: browserLaunch.playwrightBrowsersPath,
    ...(existsSync(venvDir) ? { VIRTUAL_ENV: venvDir } : {})
  })

  const { executable, baseArgs } = buildPythonCommand(python)
  const child = spawn(executable, [...baseArgs, '-m', 'autoforge_runtime'], {
    cwd: script.workspacePath,
    env: childEnv,
    windowsHide: true
  })
  setChild(child)
  if (child.pid) callbacks.onPid(child.pid)

  return new Promise((resolve) => {
    let settled = false
    let resultValue: unknown
    let gotResult = false

    const finish = (outcome: PythonRunOutcome): void => {
      if (settled) return
      settled = true
      setChild(undefined)
      resolve(outcome)
    }

    const handleLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed) return
      const parsed = parsePythonProtocolLine(trimmed)
      if (!parsed) return

      if (parsed.kind === 'log') {
        callbacks.log(parsed.level, parsed.message)
        return
      }
      if (parsed.kind === 'control') {
        callbacks.control(parsed.control)
        return
      }
      if (parsed.kind === 'result') {
        resultValue = parsed.value
        gotResult = true
        return
      }
      if (parsed.kind === 'error') {
        finish({ ok: false, errorMessage: parsed.message })
      }
    }

    let stdoutBuffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += decodeUtf8(chunk)
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = decodeUtf8(chunk).trim()
      if (!text) return
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) callbacks.log('ERROR', line.trim())
      }
    })

    child.on('close', (code) => {
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer)

      if (callbacks.isAborted()) {
        finish({ ok: false, aborted: true })
        return
      }

      if (gotResult) {
        finish({ ok: true, result: resultValue })
        return
      }

      if (code === 0) {
        finish({ ok: true, result: undefined })
        return
      }

      finish({
        ok: false,
        errorMessage: code != null ? `Python 进程退出码 ${code}` : 'Python 进程异常退出'
      })
    })

    child.on('error', (err) => {
      finish({ ok: false, errorMessage: err.message })
    })
  })
}

export async function installPythonScriptDeps(
  scriptDir: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const config = scriptStore.getConfig()
  const python = await resolvePythonExecutable(config.python)
  return pythonDependencyManager.installScriptDeps(scriptDir, python, config.python?.pipIndexUrl)
}
