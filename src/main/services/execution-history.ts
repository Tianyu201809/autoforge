import type {
  ExecutionDaySummary,
  ExecutionHistoryQuery,
  ExecutionRecord,
  ExecutionTrigger,
  SessionStatus
} from '../../shared/types/script'
import { getDb } from '../db/database'
import { createRepositories, type Repositories } from '../db/repositories'

function localDateKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export class ExecutionHistoryService {
  private repos: Repositories | null = null

  private ensureInitialized(): Repositories {
    if (this.repos) return this.repos
    this.repos = createRepositories(getDb())
    this.reconcileInterruptedRuns()
    this.pruneOldRecords()
    return this.repos
  }

  /** 应用重启后，将未结束的运行标记为已停止 */
  private reconcileInterruptedRuns(): void {
    const now = new Date().toISOString()
    this.repos!.execution.reconcileInterruptedRuns(now)
  }

  private pruneOldRecords(): void {
    this.repos!.execution.pruneOldRecords()
  }

  recordStart(input: {
    sessionId: string
    scriptId: string
    scriptName: string
    envId?: string
    trigger?: ExecutionTrigger
    startedAt: string
  }): ExecutionRecord {
    const repos = this.ensureInitialized()
    const record: ExecutionRecord = {
      id: input.sessionId,
      scriptId: input.scriptId,
      scriptName: input.scriptName,
      status: 'running',
      envId: input.envId,
      trigger: input.trigger ?? 'manual',
      startedAt: input.startedAt
    }
    repos.execution.insert(record)
    return record
  }

  recordFinish(input: {
    sessionId: string
    status: SessionStatus
    finishedAt: string
    exitCode?: number
    errorMessage?: string
    result?: unknown
  }): ExecutionRecord | null {
    const repos = this.ensureInitialized()
    return repos.execution.updateFinish(input)
  }

  getTodayCount(): number {
    const repos = this.ensureInitialized()
    const today = localDateKey(new Date().toISOString())
    return repos.execution.getTodayCount(today)
  }

  query(options: ExecutionHistoryQuery = {}): ExecutionDaySummary[] {
    const repos = this.ensureInitialized()
    const days = options.days ?? 30
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const list = repos.execution.queryRecords({
      cutoffIso: cutoff,
      scriptId: options.scriptId
    }).filter((r) => !options.date || localDateKey(r.startedAt) === options.date)

    const grouped = new Map<string, ExecutionRecord[]>()
    for (const record of list) {
      const key = localDateKey(record.startedAt)
      const bucket = grouped.get(key) ?? []
      bucket.push(record)
      grouped.set(key, bucket)
    }

    return [...grouped.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, records]) => {
        const sorted = [...records].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        return {
          date,
          total: sorted.length,
          success: sorted.filter((r) => r.status === 'success').length,
          error: sorted.filter((r) => r.status === 'error').length,
          stopped: sorted.filter((r) => r.status === 'stopped').length,
          running: sorted.filter((r) => r.status === 'running').length,
          records: sorted
        }
      })
  }

  listForScript(scriptId: string, limit = 50): ExecutionRecord[] {
    const repos = this.ensureInitialized()
    return repos.execution.listForScript(scriptId, limit)
  }
}

export const executionHistory = new ExecutionHistoryService()
