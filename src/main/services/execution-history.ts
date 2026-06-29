import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { UTF8 } from '../../shared/encoding'
import type {
  ExecutionDaySummary,
  ExecutionHistoryQuery,
  ExecutionRecord,
  ExecutionTrigger,
  SessionStatus
} from '../../shared/types/script'

const HISTORY_FILENAME = 'execution-history.json'
const MAX_RECORDS = 5000
const RETENTION_DAYS = 90

interface PersistedHistory {
  records: ExecutionRecord[]
}

function localDateKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function durationMs(startedAt: string, finishedAt: string): number {
  return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
}

export class ExecutionHistoryService {
  private dataPath = ''
  private records: ExecutionRecord[] = []
  private initialized = false

  private ensureInitialized(): void {
    if (this.initialized) return
    const userData = app.getPath('userData')
    if (!existsSync(userData)) {
      mkdirSync(userData, { recursive: true })
    }
    this.dataPath = join(userData, HISTORY_FILENAME)
    this.records = this.load()
    this.reconcileInterruptedRuns()
    this.pruneOldRecords()
    this.initialized = true
  }

  private load(): ExecutionRecord[] {
    if (!existsSync(this.dataPath)) return []
    try {
      const raw = readFileSync(this.dataPath, UTF8)
      const parsed = JSON.parse(raw) as Partial<PersistedHistory>
      return Array.isArray(parsed.records) ? parsed.records : []
    } catch {
      return []
    }
  }

  private save(): void {
    writeFileSync(this.dataPath, JSON.stringify({ records: this.records }, null, 2), UTF8)
  }

  /** 应用重启后，将未结束的运行标记为已停止 */
  private reconcileInterruptedRuns(): void {
    let changed = false
    const now = new Date().toISOString()
    for (const record of this.records) {
      if (record.status === 'running') {
        record.status = 'stopped'
        record.finishedAt = now
        record.durationMs = durationMs(record.startedAt, now)
        changed = true
      }
    }
    if (changed) this.save()
  }

  private pruneOldRecords(): void {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    const before = this.records.length
    this.records = this.records.filter((r) => new Date(r.startedAt).getTime() >= cutoff)
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS)
    }
    if (this.records.length !== before) this.save()
  }

  recordStart(input: {
    sessionId: string
    scriptId: string
    scriptName: string
    envId?: string
    trigger?: ExecutionTrigger
    startedAt: string
  }): ExecutionRecord {
    this.ensureInitialized()
    const record: ExecutionRecord = {
      id: input.sessionId,
      scriptId: input.scriptId,
      scriptName: input.scriptName,
      status: 'running',
      envId: input.envId,
      trigger: input.trigger ?? 'manual',
      startedAt: input.startedAt
    }
    this.records.push(record)
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS)
    }
    this.save()
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
    this.ensureInitialized()
    const record = this.records.find((r) => r.id === input.sessionId)
    if (!record) return null

    record.status = input.status
    record.finishedAt = input.finishedAt
    record.exitCode = input.exitCode
    record.errorMessage = input.errorMessage
    if (input.result !== undefined) {
      record.result = input.result
    }
    record.durationMs = durationMs(record.startedAt, input.finishedAt)
    this.save()
    return record
  }

  getTodayCount(): number {
    this.ensureInitialized()
    const today = localDateKey(new Date().toISOString())
    return this.records.filter((r) => localDateKey(r.startedAt) === today).length
  }

  query(options: ExecutionHistoryQuery = {}): ExecutionDaySummary[] {
    this.ensureInitialized()
    const days = options.days ?? 30
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

    let list = this.records.filter((r) => new Date(r.startedAt).getTime() >= cutoff)
    if (options.scriptId) {
      list = list.filter((r) => r.scriptId === options.scriptId)
    }
    if (options.date) {
      list = list.filter((r) => localDateKey(r.startedAt) === options.date)
    }

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
    this.ensureInitialized()
    return [...this.records]
      .filter((r) => r.scriptId === scriptId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
  }
}

export const executionHistory = new ExecutionHistoryService()
