import { EventEmitter } from 'events'
import type { LogLine, RunSession } from '../../shared/types/script'
import type { LogCursorPage } from '../../shared/mcp-types'
import { logBus } from './log-bus'

const MAX_LINES_PER_SESSION = 2_000
const MAX_BYTES_PER_SESSION = 2 * 1024 * 1024

interface StoredLog {
  seq: number
  line: LogLine
  bytes: number
}

export interface RunLogEvent {
  sessionId: string
  seq: number
  line: LogLine
}

function cloneSession(session: RunSession): RunSession {
  return JSON.parse(JSON.stringify(session)) as RunSession
}

export class RunEventStore extends EventEmitter {
  private readonly logs = new Map<string, StoredLog[]>()
  private readonly sessions = new Map<string, RunSession>()
  private readonly onLog = (line: LogLine): void => this.appendLog(line)
  private readonly onSession = (session: RunSession): void => this.updateSession(session)

  constructor() {
    super()
    logBus.on('log', this.onLog)
    logBus.on('session', this.onSession)
  }

  appendLog(line: LogLine): void {
    const bucket = this.logs.get(line.sessionId) ?? []
    const seq = (bucket[bucket.length - 1]?.seq ?? 0) + 1
    const bytes = Buffer.byteLength(JSON.stringify(line), 'utf8')
    bucket.push({ seq, line: { ...line }, bytes })

    let totalBytes = bucket.reduce((sum, item) => sum + item.bytes, 0)
    while (bucket.length > MAX_LINES_PER_SESSION || totalBytes > MAX_BYTES_PER_SESSION) {
      const removed = bucket.shift()
      if (!removed) break
      totalBytes -= removed.bytes
    }

    this.logs.set(line.sessionId, bucket)
    this.emit('log', { sessionId: line.sessionId, seq, line: { ...line } } satisfies RunLogEvent)
  }

  updateSession(session: RunSession): void {
    const snapshot = cloneSession(session)
    this.sessions.set(session.id, snapshot)
    this.emit('session', snapshot)
  }

  getLogs(sessionId: string, cursor = 0, limit = 200): LogCursorPage {
    const bucket = this.logs.get(sessionId) ?? []
    const safeLimit = Math.min(MAX_LINES_PER_SESSION, Math.max(1, Math.floor(limit)))
    const firstSeq = bucket[0]?.seq ?? cursor + 1
    const gap = bucket.length > 0 && cursor < firstSeq - 1
    const lines = bucket.filter((item) => item.seq > cursor).slice(0, safeLimit)
    const nextCursor = lines.at(-1)?.seq ?? cursor
    return {
      lines: lines.map((item) => ({ ...item.line })),
      nextCursor,
      gap
    }
  }

  getLogsWithSeq(sessionId: string, cursor = 0, limit = 200): {
    events: RunLogEvent[]
    nextCursor: number
    gap: boolean
  } {
    const bucket = this.logs.get(sessionId) ?? []
    const safeLimit = Math.min(MAX_LINES_PER_SESSION, Math.max(1, Math.floor(limit)))
    const firstSeq = bucket[0]?.seq ?? cursor + 1
    const gap = bucket.length > 0 && cursor < firstSeq - 1
    const events = bucket.filter((item) => item.seq > cursor).slice(0, safeLimit).map((item) => ({
      sessionId,
      seq: item.seq,
      line: { ...item.line }
    }))
    return { events, nextCursor: events.at(-1)?.seq ?? cursor, gap }
  }

  getSession(sessionId: string): RunSession | undefined {
    const session = this.sessions.get(sessionId)
    return session ? cloneSession(session) : undefined
  }

  waitForTerminal(sessionId: string, timeoutMs: number): Promise<RunSession> {
    const current = this.sessions.get(sessionId)
    if (!current) return Promise.reject(new Error(`not_found: session ${sessionId}`))
    if (current.status !== 'running') return Promise.resolve(cloneSession(current))

    return new Promise<RunSession>((resolve, reject) => {
      const onSession = (session: RunSession): void => {
        if (session.id !== sessionId || session.status === 'running') return
        cleanup()
        resolve(cloneSession(session))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('timeout: session wait exceeded timeout'))
      }, timeoutMs)
      const cleanup = (): void => {
        clearTimeout(timer)
        this.removeListener('session', onSession)
      }
      this.on('session', onSession)
    })
  }

  dispose(): void {
    logBus.removeListener('log', this.onLog)
    logBus.removeListener('session', this.onSession)
    this.removeAllListeners()
    this.logs.clear()
    this.sessions.clear()
  }
}
