import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type {
  PipelineMeta,
  PipelineNode,
  PipelineNodeSession,
  PipelineLogLine,
  PipelineSession,
  ScriptMeta
} from '../../shared/types/script'
import { pipelineStore } from './pipeline-store'
import { scriptRegistry } from './script-registry'
import { scriptStore } from './script-store'
import { ScriptRunnerService } from './script-runner'
import { getDb } from '../db/database'
import { broadcastToRenderers } from './window-broadcast'

interface ActivePipeline {
  session: PipelineSession
  childSessionId?: string
}

function getPathValue(value: unknown, path?: string): unknown {
  if (!path) return value
  let current = value
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export class PipelineRunnerService {
  private sessions = new Map<string, ActivePipeline>()
  private activeByPipeline = new Map<string, string>()

  constructor(private getWindow: () => BrowserWindow | null, private scriptRunner: ScriptRunnerService) {}

  listSessions(): PipelineSession[] {
    return Array.from(this.sessions.values()).map(({ session }) => session)
  }

  getSession(sessionId: string): PipelineSession | undefined {
    return this.sessions.get(sessionId)?.session
  }

  async start(
    pipelineId: string,
    envId?: string,
    runtimeParams?: Record<string, string>
  ): Promise<PipelineSession> {
    const pipeline = pipelineStore.get(pipelineId)
    if (!pipeline) throw new Error(`流水线不存在: ${pipelineId}`)
    const existingId = this.activeByPipeline.get(pipelineId)
    const existing = existingId ? this.sessions.get(existingId)?.session : undefined
    if (existing?.status === 'running') return existing

    const session: PipelineSession = {
      id: randomUUID(),
      pipelineId,
      status: 'running',
      envId: envId ?? scriptStore.getDefaultEnvironment().id,
      startedAt: new Date().toISOString(),
      nodes: []
    }
    this.sessions.set(session.id, { session })
    this.activeByPipeline.set(pipelineId, session.id)
    this.insertHistoryStart(session, pipeline)
    this.broadcast(session)
    void this.execute(session, pipeline, runtimeParams ?? {})
    return session
  }

  stop(sessionId: string): PipelineSession | null {
    const active = this.sessions.get(sessionId)
    if (!active) return null
    if (active.session.status !== 'running') return active.session
    if (active.childSessionId) this.scriptRunner.stop(active.childSessionId)
    active.session.status = 'stopped'
    active.session.finishedAt = new Date().toISOString()
    active.session.errorMessage = '流水线已停止'
    this.finishHistory(active.session)
    this.broadcast(active.session)
    return active.session
  }

  private async execute(
    session: PipelineSession,
    pipeline: PipelineMeta,
    runtimeParams: Record<string, string>
  ): Promise<void> {
    let previousResult: unknown = undefined
    try {
      const nodes = [...pipeline.nodes].sort((a, b) => a.order - b.order)
      for (const node of nodes) {
        if (session.status !== 'running') return
        const script = scriptRegistry.getById(node.scriptId)
        if (!script) throw new Error(`节点引用的脚本不存在: ${node.scriptId}`)
        const nodeSession: PipelineNodeSession = {
          nodeId: node.id,
          scriptId: node.scriptId,
          status: 'running',
          startedAt: new Date().toISOString()
        }
        session.currentNodeId = node.id
        session.nodes.push(nodeSession)
        this.broadcast(session)

        const params = this.resolveNodeParams(pipeline, node, script, runtimeParams, session.envId)
        const pipelineEnv = this.resolveNodeValues(pipeline, node, script.envSchema.map((field) => field.key), runtimeParams, 'env', session.envId)
        const resolvedEnv = {
          ...scriptStore.resolveEnvForPipeline(script, session.envId),
          ...pipelineEnv
        }
        const mappedParams = this.applyMappings(node, previousResult, runtimeParams, params)
        const childPromise = this.scriptRunner.startAndWait(script.id, session.envId, undefined, previousResult, undefined, {
          resolvedParams: mappedParams,
          resolvedEnv,
          onLog: (line) => this.handleChildLog(session, nodeSession, line),
          onSession: (childSession) => {
            nodeSession.scriptSessionId = childSession.id
            nodeSession.status = childSession.status
            nodeSession.phase = childSession.phase
            nodeSession.runProgress = childSession.runProgress
            nodeSession.result = childSession.result
            this.broadcast(session)
          }
        })
        const active = this.sessions.get(session.id)
        active!.childSessionId = this.scriptRunner.getActiveSessionForScript(script.id)?.id
        const child = await childPromise
        const current = this.sessions.get(session.id)
        if (!current || current.session.status !== 'running') return
        current.childSessionId = undefined
        nodeSession.status = child.status
        nodeSession.result = child.result
        nodeSession.finishedAt = child.finishedAt ?? new Date().toISOString()
        if (child.status !== 'success') {
          nodeSession.errorMessage = child.result && typeof child.result === 'object' && 'error' in child.result
            ? String((child.result as { error: unknown }).error)
            : `脚本节点执行${child.status === 'stopped' ? '已停止' : '失败'}`
          throw new Error(nodeSession.errorMessage)
        }
        previousResult = child.result
        this.broadcast(session)
      }
      session.status = 'success'
      session.result = { final: previousResult, steps: session.nodes }
      session.finishedAt = new Date().toISOString()
      this.finishHistory(session)
      this.broadcast(session)
    } catch (error) {
      if (session.status !== 'running') return
      session.status = 'error'
      session.errorMessage = error instanceof Error ? error.message : String(error)
      session.result = { final: previousResult, steps: session.nodes, error: session.errorMessage }
      session.finishedAt = new Date().toISOString()
      this.finishHistory(session)
      this.broadcast(session)
    } finally {
      session.currentNodeId = undefined
      const currentId = this.activeByPipeline.get(session.pipelineId)
      if (currentId === session.id) this.activeByPipeline.delete(session.pipelineId)
      this.broadcast(session)
    }
  }

  private resolveNodeValues(
    pipeline: PipelineMeta,
    node: PipelineNode,
    keys: string[],
    runtimeParams: Record<string, string>,
    kind: 'params' | 'env',
    envId?: string
  ): Record<string, string> {
    const saved = kind === 'params' ? pipeline.paramsByEnv?.[envId ?? ''] : pipeline.configByEnv?.[envId ?? '']
    const values: Record<string, string> = {}
    for (const key of keys) {
      const namespaced = `${node.id}.${key}`
      const value = runtimeParams[namespaced] ?? saved?.[namespaced]
      if (value !== undefined) values[key] = value
    }
    return values
  }

  private resolveNodeParams(
    pipeline: PipelineMeta,
    node: PipelineNode,
    script: ScriptMeta,
    runtimeParams: Record<string, string>,
    envId?: string
  ): Record<string, string> {
    const pipelineValues = this.resolveNodeValues(
      pipeline,
      node,
      script.paramSchema.map((field) => field.key),
      runtimeParams,
      'params',
      envId
    )
    return {
      ...(node.paramValues ?? {}),
      ...pipelineValues
    }
  }

  private applyMappings(
    node: PipelineNode,
    previousResult: unknown,
    runtimeParams: Record<string, string>,
    params: Record<string, string>
  ): Record<string, string> {
    const next = { ...params }
    for (const mapping of node.inputMappings ?? []) {
      const source = mapping.source === 'previous-result' ? previousResult : runtimeParams
      const value = getPathValue(source, mapping.sourcePath)
      if (value === undefined) throw new Error(`节点 ${node.name} 的映射源字段不存在: ${mapping.sourcePath ?? '(root)'}`)
      next[mapping.targetParam] = typeof value === 'string' ? value : JSON.stringify(value)
    }
    return next
  }

  private insertHistoryStart(session: PipelineSession, pipeline: PipelineMeta): void {
    getDb()
      .prepare(
        `INSERT INTO pipeline_execution_records
          (id, pipeline_id, pipeline_name, status, env_id, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(session.id, pipeline.id, pipeline.name, 'running', session.envId ?? null, session.startedAt)
  }

  private finishHistory(session: PipelineSession): void {
    getDb()
      .prepare(
        `UPDATE pipeline_execution_records SET status = ?, finished_at = ?, error_message = ?, result = ? WHERE id = ?`
      )
      .run(
        session.status,
        session.finishedAt ?? new Date().toISOString(),
        session.errorMessage ?? null,
        session.result === undefined ? null : JSON.stringify(session.result),
        session.id
      )
  }

  private broadcast(session: PipelineSession): void {
    broadcastToRenderers(IPC.EVENT_PIPELINE_SESSION, session)
  }

  private handleChildLog(session: PipelineSession, nodeSession: PipelineNodeSession, line: import('../../shared/types/script').LogLine): void {
    nodeSession.logs = [...(nodeSession.logs ?? []), line]
    const pipelineLine: PipelineLogLine = {
      ...line,
      pipelineSessionId: session.id,
      nodeId: nodeSession.nodeId,
      scriptSessionId: line.sessionId
    }
    broadcastToRenderers(IPC.EVENT_PIPELINE_LOG, pipelineLine)
    this.broadcast(session)
  }
}
