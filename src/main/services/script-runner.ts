import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { fileURLToPath } from 'url'
import type { BrowserWindow } from 'electron'
import type { ChildProcess } from 'child_process'
import { IPC } from '../../shared/ipc-channels'
import type { LogLine, RunSession, ScriptMeta, ExecutionTrigger } from '../../shared/types/script'
import {
  applyScriptControl,
  formatControlLogLine,
  parseScriptControlMessage,
  type ScriptControlMessage
} from '../../shared/script-progress'
import { dependencyManager } from './dependency-manager'
import { needsScriptDepsInstall } from './script-deps-cache'
import { executionHistory } from './execution-history'
import { createLog, logBus } from './log-bus'
import { ScriptLifecycleBus } from './script-lifecycle'
import { getAppUserDataPath } from './app-data-root'
import { getPlaywrightBrowsersPath, resolveBrowserLaunchPlans } from './browser-path'
import { scriptRegistry } from './script-registry'
import { buildCategorySidebarItems } from './category-service'
import { scriptStore } from './script-store'
import { scriptWorkspace } from './script-workspace'
import { formatScriptRunProgressSummary } from '../../shared/script-progress'
import { broadcastToRenderers } from './window-broadcast'
import { parseHostOutbound, type HostStartMessage } from '../../shared/script-host-protocol'
import { armHostStop } from './script-host-stop'
import { killPythonProcess, runPythonScript } from './python-script-runner'
import { resolvePythonExecutable } from './python-resolver'
import { MAX_CONCURRENT_SESSIONS_PER_SCRIPT } from '../../shared/instance-slots'
import type { ScriptInstanceSlot } from '../../shared/types/script'
import { buildExecutableEnvironment } from '../../shared/executable-environment'
import {
  ExecutableAuthorizationCancelledError,
  type ExecutableAuthorization,
  type ExecutableTrustService
} from './executable-trust'
import {
  killExecutableProcess,
  runExecutableScript,
  type ExecutableRunInput
} from './executable-script-runner'

export interface ScriptHostHandle {
  postMessage: (message: unknown) => void
  kill: () => void
  onMessage: (handler: (message: unknown) => void) => void
  onExit: (handler: () => void) => void
}

type LaunchScriptHost = (hostFile: string) => ScriptHostHandle | Promise<ScriptHostHandle>

const HOST_GRACE_MS = 1000

function readBrowserClose(message: { type: 'browser'; pid: number }): 'unexpected' | 'intentional' | undefined {
  const closed = (message as { closed?: unknown }).closed
  if (closed === 'unexpected' || closed === 'intentional') return closed
  return undefined
}
const EMPTY_BROWSER_PLAN_ERROR =
  '未找到可用浏览器。请安装 Google Chrome、Microsoft Edge 或 Mozilla Firefox，或运行 npm run install:browsers 安装内置 Chromium。'

interface ActiveSession {
  session: RunSession
  abortController: AbortController
  childProcess?: ChildProcess
  executableChild?: ChildProcess
  executableAuthorization?: ExecutableAuthorization
  runTimeoutHandle?: ReturnType<typeof setTimeout>
  browserForRun?: ScriptMeta['browser']
  scriptHost?: ScriptHostHandle
  browserPids?: number[]
  hostExited?: boolean
  hostStopCancel?: { cancel: () => void }
}

export type StartOptions = {
  trigger?: ExecutionTrigger
  persistParams?: boolean
  instanceSlotId?: string
  instanceName?: string
  browserOverride?: { headless?: boolean }
  /** 覆盖脚本 configByEnv（批量实例用；不写回偏好） */
  configOverride?: Record<string, string>
  interactive?: boolean
}

export function runnerKindForScript(script: ScriptMeta): 'javascript' | 'python' | 'executable' {
  return script.language
}

export function preflightExecutableStart<T>(
  script: ScriptMeta,
  interactive: boolean,
  requireTrusted: (script: ScriptMeta) => T
): T | undefined {
  if (script.language !== 'executable' || interactive) return undefined
  return requireTrusted(script)
}

interface ExecutableRunnerDependencies {
  trust: ExecutableTrustService
  run?: typeof runExecutableScript
  kill?: typeof killExecutableProcess
}

async function defaultLaunchHost(hostFile: string): Promise<ScriptHostHandle> {
  const { utilityProcess } = await import('electron')
  if (!utilityProcess || typeof utilityProcess.fork !== 'function') {
    throw new Error('当前环境无法启动脚本宿主进程')
  }
  const child = utilityProcess.fork(hostFile)
  return {
    postMessage: (message) => {
      child.postMessage(message)
    },
    kill: () => {
      child.kill()
    },
    onMessage: (handler) => {
      child.on('message', handler)
    },
    onExit: (handler) => {
      child.on('exit', () => {
        handler()
      })
    }
  }
}

export class ScriptRunnerService {
  private sessions = new Map<string, ActiveSession>()
  private getWindow: () => BrowserWindow | null
  private lifecycle: ScriptLifecycleBus
  private executable?: ExecutableRunnerDependencies
  private launchHost: LaunchScriptHost

  constructor(
    getWindow: () => BrowserWindow | null,
    executable?: ExecutableRunnerDependencies,
    launchHost?: LaunchScriptHost
  ) {
    this.getWindow = getWindow
    this.lifecycle = new ScriptLifecycleBus(getWindow)
    this.executable = executable
    this.launchHost = launchHost ?? defaultLaunchHost
  }

  listSessions(): RunSession[] {
    return Array.from(this.sessions.values()).map((s) => s.session)
  }

  getSession(sessionId: string): RunSession | undefined {
    return this.sessions.get(sessionId)?.session
  }

  getActiveSessionForScript(scriptId: string): RunSession | undefined {
    for (const { session } of this.sessions.values()) {
      if (session.scriptId === scriptId && session.status === 'running') {
        return session
      }
    }
    return undefined
  }

  countRunningSessions(scriptId: string): number {
    let count = 0
    for (const { session } of this.sessions.values()) {
      if (session.scriptId === scriptId && session.status === 'running') count += 1
    }
    return count
  }

  async start(
    scriptId: string,
    envId?: string,
    runtimeParams?: Record<string, string>,
    options?: StartOptions
  ): Promise<RunSession> {
    const running = this.countRunningSessions(scriptId)
    if (running >= MAX_CONCURRENT_SESSIONS_PER_SCRIPT) {
      throw new Error(
        `该脚本最多同时运行 ${MAX_CONCURRENT_SESSIONS_PER_SCRIPT} 个实例，当前已满`
      )
    }

    const script = scriptRegistry.getById(scriptId)
    if (!script) {
      throw new Error(`脚本不存在: ${scriptId}`)
    }

    const executableAuthorization = this.executable
      ? preflightExecutableStart(
          script,
          options?.interactive === true,
          (target) => this.executable!.trust.requireTrusted(target)
        )
      : undefined

    const resolvedEnvId = envId ?? script.defaultEnvId ?? scriptStore.getDefaultEnvironment().id
    const env = scriptStore.resolveEnvForScript(script, resolvedEnvId, options?.configOverride)
    const envError = scriptStore.validateEnvForScript(script, env)
    if (envError) {
      throw new Error(envError)
    }

    const params = scriptStore.resolveParamsForScript(script, resolvedEnvId, runtimeParams)
    const paramsError = scriptStore.validateParamsForScript(script, params)
    if (paramsError) {
      throw new Error(paramsError)
    }
    if (options?.persistParams !== false) {
      scriptStore.setScriptParams(scriptId, resolvedEnvId, params)
    }

    const browserForRun: ScriptMeta['browser'] = {
      ...script.browser,
      ...options?.browserOverride
    }

    const session: RunSession = {
      id: randomUUID(),
      scriptId,
      status: 'running',
      envId: resolvedEnvId,
      phase: 'queued',
      startedAt: new Date().toISOString(),
      instanceSlotId: options?.instanceSlotId,
      instanceName: options?.instanceName
    }

    const abortController = new AbortController()
    this.sessions.set(session.id, {
      session,
      abortController,
      browserForRun,
      executableAuthorization
    })
    executionHistory.recordStart({
      sessionId: session.id,
      scriptId: script.id,
      scriptName: script.name,
      envId: resolvedEnvId,
      trigger: options?.trigger ?? 'manual',
      startedAt: session.startedAt
    })
    this.broadcastSession(session)

    void this.executePackage(session, script, env, params, abortController)

    return session
  }

  async startBatch(
    scriptId: string,
    slotIds: string[]
  ): Promise<{ ok: boolean; started: RunSession[]; error?: string }> {
    if (!slotIds.length) {
      return { ok: false, started: [], error: '请至少选择一个实例' }
    }

    const script = scriptRegistry.getById(scriptId)
    if (!script) {
      return { ok: false, started: [], error: `脚本不存在: ${scriptId}` }
    }

    const slots = scriptStore.getInstanceSlots(scriptId)
    const selected: ScriptInstanceSlot[] = []
    for (const id of slotIds) {
      const slot = slots.find((s) => s.id === id)
      if (!slot) {
        return { ok: false, started: [], error: `实例配置不存在: ${id}` }
      }
      selected.push(slot)
    }

    for (const slot of selected) {
      const env = scriptStore.resolveEnvForScript(script, slot.envId, slot.config)
      const envError = scriptStore.validateEnvForScript(script, env)
      if (envError) {
        return { ok: false, started: [], error: `「${slot.name}」: ${envError}` }
      }
      const params = scriptStore.resolveParamsForScript(script, slot.envId, slot.params)
      const paramsError = scriptStore.validateParamsForScript(script, params)
      if (paramsError) {
        return { ok: false, started: [], error: `「${slot.name}」: ${paramsError}` }
      }
    }

    const running = this.countRunningSessions(scriptId)
    const remaining = MAX_CONCURRENT_SESSIONS_PER_SCRIPT - running
    if (selected.length > remaining) {
      return {
        ok: false,
        started: [],
        error: `该脚本最多同时运行 ${MAX_CONCURRENT_SESSIONS_PER_SCRIPT} 个实例，还可启动 ${Math.max(0, remaining)} 个`
      }
    }

    const started: RunSession[] = []
    for (const slot of selected) {
      const session = await this.start(scriptId, slot.envId, slot.params, {
        persistParams: false,
        instanceSlotId: slot.id,
        instanceName: slot.name,
        browserOverride: slot.browser,
        configOverride: slot.config,
        interactive: false
      })
      started.push(session)
    }
    return { ok: true, started }
  }

  stopAllForScript(scriptId: string): void {
    const ids = Array.from(this.sessions.values())
      .filter(({ session }) => session.scriptId === scriptId && session.status === 'running')
      .map(({ session }) => session.id)
    for (const id of ids) {
      this.stop(id)
    }
  }

  stop(sessionId: string, reason: 'user' | 'timeout' = 'user'): RunSession | null {
    const active = this.sessions.get(sessionId)
    if (!active) return null
    if (active.session.status !== 'running') return active.session

    this.setPhase(active.session, 'stopping', '正在停止…')
    if (active.scriptHost) {
      this.armScriptHostStop(active)
    } else {
      active.abortController.abort()
      if (active.executableChild) {
        ;(this.executable?.kill ?? killExecutableProcess)(active.executableChild)
      } else {
        killPythonProcess(active.childProcess)
      }
    }
    active.childProcess = undefined
    active.executableChild = undefined
    this.clearRunTimeout(sessionId)

    const timedOut = reason === 'timeout'
    active.session.status = timedOut ? 'error' : 'stopped'
    active.session.phase = timedOut ? 'failed' : 'stopped'
    active.session.finishedAt = new Date().toISOString()
    if (timedOut) {
      active.session.exitCode = active.session.exitCode ?? 1
      const errorMessage = '运行超时，已自动停止'
      active.session.result = { error: errorMessage }
      executionHistory.recordFinish({
        sessionId: active.session.id,
        status: 'error',
        finishedAt: active.session.finishedAt,
        exitCode: active.session.exitCode,
        errorMessage,
        result: active.session.result
      })
    } else {
      executionHistory.recordFinish({
        sessionId: active.session.id,
        status: 'stopped',
        finishedAt: active.session.finishedAt
      })
    }
    this.broadcastSession(active.session)
    return active.session
  }

  private async executePackage(
    session: RunSession,
    script: ScriptMeta,
    env: Record<string, string>,
    params: Record<string, string>,
    abortController: AbortController
  ): Promise<void> {
    if (runnerKindForScript(script) === 'python') {
      return this.executePythonPackage(session, script, env, params, abortController)
    }
    if (runnerKindForScript(script) === 'executable') {
      return this.executeExecutablePackage(session, script, env, params, abortController)
    }
    return this.executeJsPackage(session, script, env, params, abortController)
  }

  private async executeExecutablePackage(
    session: RunSession,
    script: ScriptMeta,
    env: Record<string, string>,
    params: Record<string, string>,
    abortController: AbortController
  ): Promise<void> {
    const active = (): ActiveSession | undefined => this.sessions.get(session.id)
    const log = (level: LogLine['level'], message: string): void => {
      this.pushLog(session.id, level, message)
    }
    try {
      if (!this.executable) throw new Error('可执行程序运行器未初始化')
      this.setPhase(session, 'validating', '校验可执行程序…')
      let authorization = active()?.executableAuthorization
      if (!authorization) {
        this.setPhase(session, 'awaiting-confirmation', '等待运行授权…')
        authorization = await this.executable.trust.authorize({
          script,
          interactive: true
        })
      }
      this.executable.trust.assertCurrent(authorization)
      this.setPhase(session, 'starting', '启动可执行程序…')
      const childEnv = buildExecutableEnvironment({
        baseEnv: process.env,
        env,
        params,
        sessionId: session.id,
        scriptId: script.id,
        scriptDir: script.workspacePath
      })
      const runInput: ExecutableRunInput = {
        entryPath: authorization.entryPath,
        cwd: script.workspacePath,
        env: childEnv
      }
      this.setPhase(session, 'running', '可执行程序运行中…')
      this.armRunTimeout(session.id)
      const outcome = await (this.executable.run ?? runExecutableScript)(runInput, {
        log,
        onPid: (pid) => {
          session.pid = pid
          this.broadcastSession(session)
        },
        onChild: (child) => {
          const current = active()
          if (current) current.executableChild = child
        },
        isAborted: () => abortController.signal.aborted
      })
      if (abortController.signal.aborted || outcome.aborted) {
        this.stop(session.id)
        return
      }
      session.exitCode = outcome.exitCode
      if (outcome.ok) {
        this.completeSession(session.id)
        return
      }
      throw new Error(outcome.errorMessage ?? '可执行程序运行失败')
    } catch (error) {
      if (error instanceof ExecutableAuthorizationCancelledError) {
        this.stop(session.id)
        return
      }
      if (abortController.signal.aborted) {
        this.stop(session.id)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.pushLog(session.id, 'ERROR', message)
      this.failSession(session.id, message)
    }
  }

  private async executeJsPackage(
    session: RunSession,
    script: ScriptMeta,
    env: Record<string, string>,
    params: Record<string, string>,
    abortController: AbortController
  ): Promise<void> {
    const log = (level: LogLine['level'], message: string): void => {
      this.pushLog(session.id, level, message)
    }

    try {
      this.setPhase(session, 'validating', '校验脚本包…')
      const entryPath = scriptWorkspace.getEntryPath(script)
      if (!existsSync(entryPath)) {
        throw new Error(`入口文件不存在: ${script.entry}`)
      }

      await this.ensureScriptDeps(session, script, log)
      if (abortController.signal.aborted || this.sessions.get(session.id)?.session.status !== 'running') {
        return
      }

      this.setPhase(session, 'starting', '启动脚本宿主…')
      this.addScriptModulePaths(script.workspacePath)

      const hostFile = fileURLToPath(new URL('./script-host.js', import.meta.url))
      const host = await this.launchHost(hostFile)
      const active = this.sessions.get(session.id)
      if (!active || active.session.status !== 'running' || abortController.signal.aborted) {
        try {
          host.kill()
        } catch {
          /* 会话已经结束 */
        }
        return
      }

      active.scriptHost = host
      active.hostExited = false
      active.browserPids = []
      host.onMessage((message) => {
        this.handleHostMessage(session.id, message)
      })
      host.onExit(() => {
        this.handleHostExit(session.id)
      })

      this.setPhase(session, 'running', '脚本运行中…')
      this.armRunTimeout(session.id)
      const browserForRun = active.browserForRun ?? script.browser
      host.postMessage({
        type: 'start',
        entryPath,
        sessionId: session.id,
        scriptId: script.id,
        env,
        params,
        paths: {
          userData: getAppUserDataPath(),
          scriptDir: script.workspacePath
        },
        ...this.resolveHostBrowserFields(browserForRun)
      } satisfies HostStartMessage)
    } catch (error) {
      if (abortController.signal.aborted) {
        this.stop(session.id)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.pushLog(session.id, 'ERROR', message)
      this.failSession(session.id, message)
    }
  }

  private async executePythonPackage(
    session: RunSession,
    script: ScriptMeta,
    env: Record<string, string>,
    params: Record<string, string>,
    abortController: AbortController
  ): Promise<void> {
    const log = (level: LogLine['level'], message: string): void => {
      this.pushLog(session.id, level, message)
    }

    const active = (): ActiveSession | undefined => this.sessions.get(session.id)

    try {
      this.setPhase(session, 'validating', '校验脚本包…')
      const entryPath = scriptWorkspace.getEntryPath(script)
      if (!existsSync(entryPath)) {
        throw new Error(`入口文件不存在: ${script.entry}`)
      }

      await resolvePythonExecutable(scriptStore.getConfig().python)

      await this.ensureScriptDeps(session, script, log)

      this.setPhase(session, 'starting', '启动 Python 脚本…')
      this.setPhase(session, 'running', '脚本运行中…')
      this.armRunTimeout(session.id)

      const outcome = await runPythonScript(
        {
          ...script,
          browser: this.sessions.get(session.id)?.browserForRun ?? script.browser
        },
        session.id,
        env,
        params,
        {
          log,
          control: (control) => {
            const current = active()
            if (current) this.handleScriptControl(current.session, control)
          },
          onPid: (pid) => {
            session.pid = pid
            this.broadcastSession(session)
          },
          isAborted: () => abortController.signal.aborted
        },
        () => active()?.childProcess,
        (child) => {
          const current = active()
          if (current) current.childProcess = child
        }
      )

      if (abortController.signal.aborted || outcome.aborted) {
        this.stop(session.id)
        return
      }

      if (outcome.ok) {
        this.completeSession(session.id, outcome.result)
        return
      }

      throw new Error(outcome.errorMessage ?? 'Python 脚本执行失败')
    } catch (error) {
      if (abortController.signal.aborted) {
        this.stop(session.id)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.pushLog(session.id, 'ERROR', message)
      this.failSession(session.id, message)
    }
  }

  /** 仅在依赖缺失或 manifest 变更时安装脚本依赖 */
  private async ensureScriptDeps(
    session: RunSession,
    script: ScriptMeta,
    log: (level: LogLine['level'], message: string) => void
  ): Promise<void> {
    const deps = script.dependencies
    if (!deps || !Object.keys(deps).length) return

    const pipIndexUrl =
      script.language === 'python' ? scriptStore.getConfig().python?.pipIndexUrl : undefined
    if (!needsScriptDepsInstall(script.workspacePath, script.language, deps, pipIndexUrl)) {
      log('INFO', '依赖已就绪，跳过安装')
      return
    }

    this.setPhase(session, 'installing-deps', '安装脚本依赖…')
    log('INFO', script.language === 'python' ? '正在安装 pip 依赖…' : '正在安装 npm 依赖…')
    const result = await dependencyManager.installScriptDeps(script.workspacePath, script.language)
    if (!result.ok) {
      throw new Error(`依赖安装失败: ${result.stderr || result.stdout}`)
    }
    log('INFO', '依赖安装完成')
  }

  /** 将脚本 node_modules 与全局 runtime node_modules 加入模块搜索路径 */
  private addScriptModulePaths(scriptDir: string): void {
    const paths = [
      join(scriptDir, 'node_modules'),
      dependencyManager.getRuntimeNodeModules()
    ].filter((p) => existsSync(p))

    const existing = process.env.NODE_PATH ?? ''
    const merged = [...paths, ...existing.split(process.platform === 'win32' ? ';' : ':').filter(Boolean)]
    process.env.NODE_PATH = merged.join(process.platform === 'win32' ? ';' : ':')

    createRequire(import.meta.url)('module').Module._initPaths()
  }

  private setPhase(session: RunSession, phase: RunSession['phase'], message?: string): void {
    if (session.status !== 'running' && phase !== 'stopping' && phase !== 'stopped') {
      return
    }
    session.phase = phase
    this.lifecycle.emit(session.id, session.scriptId, phase!, message)
    this.broadcastSession(session)
  }

  private handleScriptControl(session: RunSession, control: ScriptControlMessage): void {
    if (session.status !== 'running') return
    session.runProgress = {
      ...applyScriptControl(session.runProgress, control),
      updatedAt: new Date().toISOString()
    }
    this.broadcastSession(session)
    this.pushLogLine(session.id, 'INFO', formatControlLogLine(control))
  }

  private pushLogLine(sessionId: string, level: LogLine['level'], message: string): void {
    const line = createLog(sessionId, level, message)
    logBus.emitLog(line)
    broadcastToRenderers(IPC.EVENT_LOG, line)
  }

  private pushLog(sessionId: string, level: LogLine['level'], message: string): void {
    const control = parseScriptControlMessage(message)
    if (control) {
      const active = this.sessions.get(sessionId)
      if (active) {
        this.handleScriptControl(active.session, control)
      }
      return
    }
    this.pushLogLine(sessionId, level, message)
  }

  private completeSession(sessionId: string, result?: unknown): void {
    const active = this.sessions.get(sessionId)
    if (!active) return
    if (active.session.status !== 'running') return
    this.clearRunTimeout(sessionId)
    active.session.status = 'success'
    active.session.phase = 'completed'
    active.session.finishedAt = new Date().toISOString()
    active.session.result = result
    active.session.exitCode = 0
    this.updateRecentRun(active.session.scriptId)
    executionHistory.recordFinish({
      sessionId: active.session.id,
      status: 'success',
      finishedAt: active.session.finishedAt,
      exitCode: 0,
      result
    })
    this.lifecycle.emit(sessionId, active.session.scriptId, 'completed')
    this.broadcastSession(active.session)
    this.releaseScriptHost(active)
  }

  private failSession(sessionId: string, message: string): void {
    const active = this.sessions.get(sessionId)
    if (!active) return
    if (active.session.status !== 'running') return
    this.clearRunTimeout(sessionId)
    active.session.status = 'error'
    active.session.phase = 'failed'
    active.session.finishedAt = new Date().toISOString()
    active.session.exitCode = active.session.exitCode ?? 1
    active.session.result = { error: message }
    executionHistory.recordFinish({
      sessionId: active.session.id,
      status: 'error',
      finishedAt: active.session.finishedAt,
      exitCode: active.session.exitCode,
      errorMessage: message,
      result: active.session.result
    })
    this.lifecycle.emit(sessionId, active.session.scriptId, 'failed', message)
    this.broadcastSession(active.session)
    this.releaseScriptHost(active)
  }

  private updateRecentRun(scriptId: string): void {
    scriptRegistry.update(scriptId, { recentRunAt: new Date().toISOString() })
  }

  private broadcastSession(session: RunSession): void {
    logBus.emitSession(session)
    broadcastToRenderers(IPC.EVENT_SESSION, session)
  }

  private getRunTimeoutSeconds(): number {
    const seconds = scriptStore.getConfig().script?.runTimeoutSeconds
    return typeof seconds === 'number' && seconds > 0 ? Math.floor(seconds) : 0
  }

  private armRunTimeout(sessionId: string): void {
    const seconds = this.getRunTimeoutSeconds()
    if (!seconds) return
    const active = this.sessions.get(sessionId)
    if (!active) return
    this.clearRunTimeout(sessionId)
    active.runTimeoutHandle = setTimeout(() => {
      const current = this.sessions.get(sessionId)
      if (!current || current.session.status !== 'running') return
      this.pushLog(sessionId, 'ERROR', `运行超时（${seconds} 秒），已自动停止`)
      this.stop(sessionId, 'timeout')
    }, seconds * 1000)
  }

  private clearRunTimeout(sessionId: string): void {
    const active = this.sessions.get(sessionId)
    if (!active?.runTimeoutHandle) return
    clearTimeout(active.runTimeoutHandle)
    active.runTimeoutHandle = undefined
  }

  private resolveHostBrowserFields(browserForRun?: ScriptMeta['browser']): Pick<
    HostStartMessage,
    'browserPlan' | 'browserLaunchError'
  > {
    const config = scriptStore.getConfig()
    const plans = resolveBrowserLaunchPlans(config, browserForRun)
    if (plans.length === 0) {
      const customPath = config.browser?.executablePath?.trim()
      return {
        browserLaunchError: customPath
          ? `指定的浏览器路径不存在：${customPath}`
          : EMPTY_BROWSER_PLAN_ERROR
      }
    }
    const plan = plans[0]
    return {
      browserPlan: {
        browsersPath: getPlaywrightBrowsersPath(),
        engine: plan.engine,
        headless: plan.headless,
        ...(plan.executablePath ? { executablePath: plan.executablePath } : {}),
        ...(plan.channel ? { channel: plan.channel } : {})
      }
    }
  }

  private armScriptHostStop(active: ActiveSession): void {
    const host = active.scriptHost
    if (!host) return
    active.hostStopCancel?.cancel()
    active.hostStopCancel = armHostStop({
      postAbort: () => {
        try {
          host.postMessage({ type: 'abort' })
        } catch {
          /* 宿主已经退出 */
        }
        active.abortController.abort()
      },
      kill: () => {
        try {
          host.kill()
        } catch {
          /* 宿主已经退出 */
        }
        this.killBrowserPids(active.browserPids)
      },
      hasExited: () => active.hostExited === true,
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms)
        return {
          cancel: () => {
            clearTimeout(timer)
          }
        }
      },
      graceMs: HOST_GRACE_MS
    })
  }

  private handleHostMessage(sessionId: string, message: unknown): void {
    const parsed = parseHostOutbound(message)
    if (!parsed) return
    const active = this.sessions.get(sessionId)
    if (!active) return
    switch (parsed.type) {
      case 'log':
        this.pushLog(sessionId, parsed.level, parsed.message)
        break
      case 'stage':
        this.handleScriptControl(active.session, { kind: 'stage', ...parsed.stage })
        break
      case 'progress':
        this.handleScriptControl(active.session, { kind: 'progress', ...parsed.progress })
        break
      case 'browser':
        this.handleBrowserMessage(active, parsed)
        break
      case 'result':
        this.completeSession(sessionId, parsed.value)
        break
      case 'error':
        this.pushLog(sessionId, 'ERROR', parsed.message)
        this.failSession(sessionId, parsed.message)
        break
      default:
        break
    }
  }

  private handleHostExit(sessionId: string): void {
    const active = this.sessions.get(sessionId)
    if (!active) return
    active.hostExited = true
    if (active.session.status !== 'running') return
    const message = '脚本宿主进程已退出'
    this.pushLog(sessionId, 'ERROR', message)
    this.failSession(sessionId, message)
    this.killBrowserPids(active.browserPids)
  }

  /** 没有仍打开的浏览器窗口时收回宿主。 */
  private releaseScriptHost(active: ActiveSession): void {
    if (active.browserPids?.length) return
    this.killHostProcess(active)
  }

  private handleBrowserMessage(
    active: ActiveSession,
    message: { type: 'browser'; pid: number }
  ): void {
    const closed = readBrowserClose(message)
    if (closed === 'unexpected' && active.session.status === 'running') {
      this.forgetBrowserPid(active, message.pid)
      this.stop(active.session.id)
      return
    }
    if (closed === 'unexpected' || closed === 'intentional') {
      this.forgetBrowserPid(active, message.pid)
      if (active.session.status !== 'running') this.releaseScriptHost(active)
      return
    }
    if (!(active.browserPids ?? []).includes(message.pid)) {
      active.browserPids = [...(active.browserPids ?? []), message.pid]
    }
  }

  private forgetBrowserPid(active: ActiveSession, pid: number): void {
    active.browserPids = (active.browserPids ?? []).filter((item) => item !== pid)
  }

  private killHostProcess(active: ActiveSession): void {
    if (!active.scriptHost || active.hostExited) return
    try {
      active.scriptHost.kill()
    } catch {
      /* 宿主已经退出 */
    }
  }

  private killBrowserPids(pids: number[] | undefined): void {
    if (!pids?.length) return
    for (const pid of pids) {
      try {
        process.kill(pid)
      } catch {
        /* 浏览器进程已经不在 */
      }
    }
  }
}

export function enrichScriptItem(
  meta: ScriptMeta,
  sessions: RunSession[]
): import('../../shared/types/script').ScriptItem {
  const scriptSessions = sessions.filter((s) => s.scriptId === meta.id)
  const activeSessions = scriptSessions.filter((s) => s.status === 'running')
  const active = activeSessions[0]
  const activeSessionCount = activeSessions.length
  const lastTerminal = [...scriptSessions]
    .filter((s) => s.status === 'success' || s.status === 'error' || s.status === 'stopped')
    .sort((a, b) =>
      (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt)
    )[0]

  let status: import('../../shared/types/script').ScriptStatus = 'idle'
  let metaText = meta.recentRunAt ? `最近运行 ${formatRelative(meta.recentRunAt)}` : '尚未运行'
  let errorMeta: string | undefined

  if (activeSessionCount > 0 && active) {
    status = 'running'
    const progressSummary = formatScriptRunProgressSummary(active.runProgress)
    const countLabel =
      activeSessionCount > 1 ? `运行中 ${activeSessionCount}/${MAX_CONCURRENT_SESSIONS_PER_SCRIPT}` : null
    metaText =
      countLabel ??
      progressSummary ??
      (active.phase
        ? `${phaseLabel(active.phase)} · ${formatTime(active.startedAt)}`
        : `运行中 · ${formatTime(active.startedAt)}`)
  } else if (lastTerminal?.status === 'error') {
    status = 'error'
    errorMeta = `Exit code ${lastTerminal.exitCode ?? 1} · ${formatRelative(lastTerminal.finishedAt ?? lastTerminal.startedAt)}`
    metaText = ''
  }

  return {
    ...meta,
    status,
    meta: metaText,
    errorMeta,
    activeSessionId: active?.id,
    activeSessionCount
  }
}

function phaseLabel(phase: string): string {
  const map: Record<string, string> = {
    queued: '排队中',
    validating: '校验中',
    'awaiting-confirmation': '等待授权',
    'installing-deps': '安装依赖',
    starting: '启动中',
    running: '运行中',
    stopping: '停止中',
    completed: '已完成',
    failed: '失败',
    stopped: '已停止'
  }
  return map[phase] ?? phase
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function computeStats(items: import('../../shared/types/script').ScriptItem[]): import('../../shared/types/script').ScriptStats {
  return {
    total: items.filter((s) => !s.archived).length,
    running: items.filter((s) => s.status === 'running').length,
    scheduled: items.filter((s) => s.schedule?.enabled).length,
    todayRuns: executionHistory.getTodayCount()
  }
}

export function getCategories(items: import('../../shared/types/script').ScriptItem[]): import('../../shared/types/script').CategoryItem[] {
  const definitions = scriptStore.getCategoryDefinitions()
  return buildCategorySidebarItems(items, definitions)
}

export type { AppConfig } from '../../shared/types/script'
