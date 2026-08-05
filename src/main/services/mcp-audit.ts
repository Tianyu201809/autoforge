import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import type { McpErrorCode } from '../../shared/mcp-control-protocol'
import { getAppUserDataPath } from './app-data-root'

const MAX_AUDIT_BYTES = 10 * 1024 * 1024

export interface McpAuditEntry {
  ts: string
  connectionId: string
  requestId: string
  operation: string
  target?: string
  confirmed: boolean
  outcome: 'success' | 'rejected' | 'error'
  errorCode?: McpErrorCode
}

export class McpAuditService {
  private readonly filePath: string
  private readonly backupPath: string
  private readonly maxBytes: number

  constructor(runtimeDirectory = join(getAppUserDataPath(), 'runtime'), maxBytes = MAX_AUDIT_BYTES) {
    mkdirSync(runtimeDirectory, { recursive: true })
    this.filePath = join(runtimeDirectory, 'mcp-audit.jsonl')
    this.backupPath = `${this.filePath}.1`
    this.maxBytes = maxBytes
  }

  record(entry: McpAuditEntry): void {
    const safeEntry: McpAuditEntry = {
      ts: entry.ts,
      connectionId: entry.connectionId,
      requestId: entry.requestId,
      operation: entry.operation,
      target: entry.target,
      confirmed: entry.confirmed,
      outcome: entry.outcome,
      errorCode: entry.errorCode
    }
    appendFileSync(this.filePath, `${JSON.stringify(safeEntry)}\n`, 'utf8')
    if (existsSync(this.filePath) && statSync(this.filePath).size > this.maxBytes) {
      if (existsSync(this.backupPath)) {
        try {
          rmSync(this.backupPath, { force: true })
        } catch {
          return
        }
      }
      renameSync(this.filePath, this.backupPath)
    }
  }
}
