import type { SqliteDatabase } from '../database'
import type { ExecutionRecord, ExecutionTrigger, SessionStatus } from '../../../shared/types/script'
import { executionRecordToRow, rowToExecutionRecord } from '../row-mappers'

const MAX_RECORDS = 5000
const RETENTION_DAYS = 90

const SELECT_ALL = `
  SELECT id, script_id, script_name, status, env_id, trigger, started_at,
         finished_at, exit_code, error_message, duration_ms, result
  FROM execution_records
`

export class ExecutionRepository {
  constructor(private db: SqliteDatabase) {}

  insert(record: ExecutionRecord): void {
    const row = executionRecordToRow(record)
    this.db
      .prepare(
        `INSERT INTO execution_records (
          id, script_id, script_name, status, env_id, trigger, started_at,
          finished_at, exit_code, error_message, duration_ms, result
        ) VALUES (
          @id, @script_id, @script_name, @status, @env_id, @trigger, @started_at,
          @finished_at, @exit_code, @error_message, @duration_ms, @result
        )`
      )
      .run(row)
    this.enforceLimits()
  }

  updateFinish(input: {
    sessionId: string
    status: SessionStatus
    finishedAt: string
    exitCode?: number
    errorMessage?: string
    result?: unknown
  }): ExecutionRecord | null {
    const existing = this.getById(input.sessionId)
    if (!existing) return null

    const durationMs = Math.max(
      0,
      new Date(input.finishedAt).getTime() - new Date(existing.startedAt).getTime()
    )

    this.db
      .prepare(
        `UPDATE execution_records SET
          status = @status, finished_at = @finished_at, exit_code = @exit_code,
          error_message = @error_message, duration_ms = @duration_ms, result = @result
         WHERE id = @id`
      )
      .run({
        id: input.sessionId,
        status: input.status,
        finished_at: input.finishedAt,
        exit_code: input.exitCode ?? null,
        error_message: input.errorMessage ?? null,
        duration_ms: durationMs,
        result: input.result !== undefined ? JSON.stringify(input.result) : null
      })

    return this.getById(input.sessionId)
  }

  getById(id: string): ExecutionRecord | null {
    const row = this.db.prepare(`${SELECT_ALL} WHERE id = ?`).get(id)
    return row ? rowToExecutionRecord(row as Parameters<typeof rowToExecutionRecord>[0]) : null
  }

  reconcileInterruptedRuns(now: string): number {
    const running = this.db
      .prepare(`${SELECT_ALL} WHERE status = 'running'`)
      .all() as Parameters<typeof rowToExecutionRecord>[0][]

    if (running.length === 0) return 0

    const update = this.db.prepare(
      `UPDATE execution_records SET status = 'stopped', finished_at = @finished_at, duration_ms = @duration_ms
       WHERE id = @id`
    )

    const tx = this.db.transaction(() => {
      for (const row of running) {
        const startedAt = row.started_at
        const durationMs = Math.max(0, new Date(now).getTime() - new Date(startedAt).getTime())
        update.run({ id: row.id, finished_at: now, duration_ms: durationMs })
      }
    })
    tx()
    return running.length
  }

  pruneOldRecords(): void {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    this.db.prepare('DELETE FROM execution_records WHERE started_at < ?').run(cutoff)
    this.enforceLimits()
  }

  private enforceLimits(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM execution_records').get() as { count: number })
      .count
    if (count <= MAX_RECORDS) return

    const excess = count - MAX_RECORDS
    this.db
      .prepare(
        `DELETE FROM execution_records WHERE id IN (
          SELECT id FROM execution_records ORDER BY started_at ASC LIMIT ?
        )`
      )
      .run(excess)
  }

  getTodayCount(todayKey: string): number {
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const records = this.queryRecords({ cutoffIso: cutoff })
    return records.filter((r) => {
      const d = new Date(r.startedAt)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}` === todayKey
    }).length
  }

  queryRecords(options: { cutoffIso: string; scriptId?: string; scriptName?: string }): ExecutionRecord[] {
    const { whereSql, params } = this.buildWhereClause(options)
    const rows = this.db
      .prepare(`${SELECT_ALL} WHERE ${whereSql} ORDER BY started_at DESC`)
      .all(...params)
    return rows.map((row) => rowToExecutionRecord(row as Parameters<typeof rowToExecutionRecord>[0]))
  }

  queryRecordsPage(options: {
    cutoffIso: string
    scriptId?: string
    scriptName?: string
    status?: SessionStatus | 'all'
    trigger?: ExecutionTrigger | 'all'
    offset?: number
    limit?: number
  }): { records: ExecutionRecord[]; total: number } {
    const { whereSql, params } = this.buildWhereClause(options)
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM execution_records WHERE ${whereSql}`)
      .get(...params) as { count: number }

    const offset = options.offset ?? 0
    const limit = options.limit ?? 20
    const rows = this.db
      .prepare(`${SELECT_ALL} WHERE ${whereSql} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)

    return {
      total: countRow.count,
      records: rows.map((row) => rowToExecutionRecord(row as Parameters<typeof rowToExecutionRecord>[0]))
    }
  }

  private buildWhereClause(options: {
    cutoffIso: string
    scriptId?: string
    scriptName?: string
    status?: SessionStatus | 'all'
    trigger?: ExecutionTrigger | 'all'
  }): { whereSql: string; params: string[] } {
    const clauses = ['started_at >= ?']
    const params: string[] = [options.cutoffIso]

    if (options.scriptId) {
      clauses.push('script_id = ?')
      params.push(options.scriptId)
    }
    if (options.scriptName) {
      clauses.push('script_name LIKE ?')
      params.push(`%${options.scriptName}%`)
    }
    if (options.status && options.status !== 'all') {
      clauses.push('status = ?')
      params.push(options.status)
    }
    if (options.trigger && options.trigger !== 'all') {
      clauses.push('trigger = ?')
      params.push(options.trigger)
    }

    return { whereSql: clauses.join(' AND '), params }
  }

  listForScript(scriptId: string, limit: number): ExecutionRecord[] {
    const rows = this.db
      .prepare(`${SELECT_ALL} WHERE script_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(scriptId, limit)
    return rows.map((row) => rowToExecutionRecord(row as Parameters<typeof rowToExecutionRecord>[0]))
  }

  bulkInsert(records: ExecutionRecord[]): void {
    const insert = this.db.prepare(
      `INSERT INTO execution_records (
        id, script_id, script_name, status, env_id, trigger, started_at,
        finished_at, exit_code, error_message, duration_ms, result
      ) VALUES (
        @id, @script_id, @script_name, @status, @env_id, @trigger, @started_at,
        @finished_at, @exit_code, @error_message, @duration_ms, @result
      )`
    )
    const tx = this.db.transaction((items: ExecutionRecord[]) => {
      for (const record of items) {
        insert.run(executionRecordToRow(record))
      }
    })
    tx(records)
    this.enforceLimits()
  }
}
