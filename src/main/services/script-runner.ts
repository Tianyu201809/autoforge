import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { ScriptRunFn, ScriptStageInput, ScriptProgressInput } from '../../shared/script-contract'
import type { LogLine, RunSession, ScriptMeta, ExecutionTrigger } from '../../shared/types/script'
import {
  applyScriptControl,
  formatControlLogLine,
  parseScriptControlMessage,
  type ScriptControlMessage
} from '../../shared/script-progress'
import { dependencyManager } from './dependency-manager'
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

interface ActiveSession {
  session: RunSession
  abortController: AbortController
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

  async start(
    scriptId: string,
    envId?: string,
    runtimeParams?: Record<string, string>,
    options?: { trigger?: ExecutionTrigger }
  ): Promise<RunSession> {
    const existing = this.getActiveSessionForScript(scriptId)
    if (existing) return existing

    const script = scriptRegistry.getById(scriptId)
    if (!script) {
      throw new Error(`脚本不存在: ${scriptId}`)
    }

    const resolvedEnvId = envId ?? script.defaultEnvId ?? scriptStore.getDefaultEnvironment().id
    const env = scriptStore.resolveEnvForScript(script, resolvedEnvId)
    const envError = scriptStore.validateEnvForScript(script, env)
    if (envError) {
      throw new Error(envError)
    }

    const params = scriptStore.resolveParamsForScript(script, resolvedEnvId, runtimeParams)
    const paramsError = scriptStore.validateParamsForScript(script, params)
    if (paramsError) {
      throw new Error(paramsError)
    }
    scriptStore.setScriptParams(scriptId, resolvedEnvId, params)

    const session: RunSession = {
      id: randomUUID(),
      scriptId,
      status: 'running',
      envId: resolvedEnvId,
      phase: 'queued',
      startedAt: new Date().toISOString()
    }

    const abortController = new AbortController()
    this.sessions.set(session.id, { session, abortController })
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

  stop(sessionId: string): RunSession | null {
    const active = this.sessions.get(sessionId)
    if (!active) return null

    this.setPhase(active.session, 'stopping', '正在停止…')
    active.abortController.abort()

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

      if (script.dependencies && Object.keys(script.dependencies).length) {
        this.setPhase(session, 'installing-deps', '安装脚本依赖…')
        log('INFO', '正在安装 npm 依赖…')
        const result = await dependencyManager.installScriptDeps(script.workspacePath)
        if (!result.ok) {
          throw new Error(`依赖安装失败: ${result.stderr || result.stdout}`)
        }
        log('INFO', '依赖安装完成')
      }

      this.setPhase(session, 'starting', '加载脚本模块…')
      this.addScriptModulePaths(script.workspacePath)

      const mod = await import(pathToFileURL(entryPath).href)
      const runFn: ScriptRunFn | undefined =
        typeof mod.run === 'function' ? mod.run : typeof mod.default === 'function' ? mod.default : undefined

      if (!runFn) {
        throw new Error('脚本必须导出 async function run(ctx) 或 default 函数')
      }

      this.setPhase(session, 'running', '脚本运行中…')
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
        sdk: createScriptSdk(config, script.workspacePath, log, script.browser)
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
    session.phase = phase
    this.lifecycle.emit(session.id, session.scriptId, phase!, message)
    this.broadcastSession(session)
  }

  private handleScriptControl(session: RunSession, control: ScriptControlMessage): void {
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
}

export function enrichScriptItem(
  meta: ScriptMeta,
  sessions: RunSession[]
): import('../../shared/types/script').ScriptItem {
  const scriptSessions = sessions.filter((s) => s.scriptId === meta.id)
  const active = scriptSessions.find((s) => s.status === 'running')
  const lastTerminal = [...scriptSessions]
    .filter((s) => s.status === 'success' || s.status === 'error' || s.status === 'stopped')
    .sort((a, b) =>
      (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt)
    )[0]

  let status: import('../../shared/types/script').ScriptStatus = 'idle'
  let metaText = meta.recentRunAt ? `最近运行 ${formatRelative(meta.recentRunAt)}` : '尚未运行'
  let errorMeta: string | undefined

  if (active) {
    status = 'running'
    const progressSummary = formatScriptRunProgressSummary(active.runProgress)
    metaText = progressSummary
      ?? (active.phase ? `${phaseLabel(active.phase)} · ${formatTime(active.startedAt)}` : `运行中 · ${formatTime(active.startedAt)}`)
  } else if (lastTerminal?.status === 'error') {
    status = 'error'
    errorMeta = `Exit code ${lastTerminal.exitCode ?? 1} · ${formatRelative(lastTerminal.finishedAt ?? lastTerminal.startedAt)}`
    metaText = ''
  }

  if (meta.schedule?.enabled) {
    metaText = metaText ? `${metaText} · 已启用定时` : '定时任务已启用'
  }

  return {
    ...meta,
    status,
    meta: metaText,
    errorMeta,
    activeSessionId: active?.id
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
