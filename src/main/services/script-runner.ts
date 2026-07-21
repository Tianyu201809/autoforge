import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { BrowserWindow } from 'electron'
import type { ChildProcess } from 'child_process'
import { IPC } from '../../shared/ipc-channels'
import {
  resolveScriptEntryFn,
  SCRIPT_ENTRY_FN_ERROR,
  type ScriptStageInput,
  type ScriptProgressInput
} from '../../shared/script-contract'
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
import { createScriptSdk } from './script-sdk'
import { scriptRegistry } from './script-registry'
import { buildCategorySidebarItems } from './category-service'
import { scriptStore } from './script-store'
import { scriptWorkspace } from './script-workspace'
import { formatScriptRunProgressSummary } from '../../shared/script-progress'
import { broadcastToRenderers } from './window-broadcast'
import { killPythonProcess, runPythonScript } from './python-script-runner'
import { resolvePythonExecutable } from './python-resolver'
import { MAX_CONCURRENT_SESSIONS_PER_SCRIPT } from '../../shared/instance-slots'
import type { ScriptInstanceSlot } from '../../shared/types/script'

interface ActiveSession {
  session: RunSession
  abortController: AbortController
  childProcess?: ChildProcess
  runTimeoutHandle?: ReturnType<typeof setTimeout>
  browserForRun?: ScriptMeta['browser']
}

export type StartOptions = {
  trigger?: ExecutionTrigger
  persistParams?: boolean
  instanceSlotId?: string
  instanceName?: string
  browserOverride?: { headless?: boolean }
  /** 覆盖脚本 configByEnv（批量实例用；不写回偏好） */
  configOverride?: Record<string, string>
}

export class ScriptRunnerService {
  private sessions = new Map<string, ActiveSession>()
  private getWindow: () => BrowserWindow | null
  private lifecycle: ScriptLifecycleBus

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow
    this.lifecycle = new ScriptLifecycleBus(getWindow)
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
    this.sessions.set(session.id, { session, abortController, browserForRun })
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
        configOverride: slot.config
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

  stop(sessionId: string): RunSession | null {
    const active = this.sessions.get(sessionId)
    if (!active) return null
    if (active.session.status !== 'running') return active.session

    this.setPhase(active.session, 'stopping', '正在停止…')
    active.abortController.abort()
    killPythonProcess(active.childProcess)
    active.childProcess = undefined
    this.clearRunTimeout(sessionId)

    active.session.status = 'stopped'
    active.session.phase = 'stopped'
    active.session.finishedAt = new Date().toISOString()
    executionHistory.recordFinish({
      sessionId: active.session.id,
      status: 'stopped',
      finishedAt: active.session.finishedAt
    })
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
    if (script.language === 'python') {
      return this.executePythonPackage(session, script, env, params, abortController)
    }
    return this.executeJsPackage(session, script, env, params, abortController)
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
    const stage = (input: ScriptStageInput): void => {
      this.handleScriptControl(session, { kind: 'stage', ...input })
    }
    const progress = (input: ScriptProgressInput): void => {
      this.handleScriptControl(session, { kind: 'progress', ...input })
    }

    try {
      this.setPhase(session, 'validating', '校验脚本包…')
      const entryPath = scriptWorkspace.getEntryPath(script)
      if (!existsSync(entryPath)) {
        throw new Error(`入口文件不存在: ${script.entry}`)
      }

      await this.ensureScriptDeps(session, script, log)

      this.setPhase(session, 'starting', '加载脚本模块…')
      this.addScriptModulePaths(script.workspacePath)

      const mod = await import(pathToFileURL(entryPath).href)
      const runFn = resolveScriptEntryFn(mod as Record<string, unknown>)

      if (!runFn) {
        throw new Error(SCRIPT_ENTRY_FN_ERROR)
      }

      this.setPhase(session, 'running', '脚本运行中…')
      this.armRunTimeout(session.id)
      const config = scriptStore.getConfig()
      const ctx = {
        sessionId: session.id,
        scriptId: script.id,
        env,
        params,
        signal: abortController.signal,
        log,
        stage,
        progress,
        sdk: createScriptSdk(
          config,
          script.workspacePath,
          log,
          this.sessions.get(session.id)?.browserForRun ?? script.browser,
          abortController.signal
        )
      }

      const result = await runFn(ctx)

      if (abortController.signal.aborted) {
        this.stop(session.id)
        return
      }

      this.completeSession(session.id, result)
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
     
    require('module').Module._initPaths()
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
      this.stop(sessionId)
    }, seconds * 1000)
  }

  private clearRunTimeout(sessionId: string): void {
    const active = this.sessions.get(sessionId)
    if (!active?.runTimeoutHandle) return
    clearTimeout(active.runTimeoutHandle)
    active.runTimeoutHandle = undefined
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
