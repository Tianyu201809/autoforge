import { EventEmitter } from 'events'
import type { LogLevel, LogLine, RunSession } from '../../shared/types/script'

class LogBus extends EventEmitter {
  emitLog(line: Omit<LogLine, 'sessionId'> & { sessionId: string }): void {
    this.emit('log', line)
  }

  emitSession(session: RunSession): void {
    this.emit('session', session)
  }
}

export const logBus = new LogBus()

export function createLog(
  sessionId: string,
  level: LogLevel,
  message: string
): LogLine {
  return {
    sessionId,
    ts: new Date().toISOString(),
    level,
    message
  }
}
