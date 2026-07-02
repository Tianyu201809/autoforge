/** Autoforge 脚本 stdout 行协议前缀 — Node 与 Python 运行时共用 */

import type { LogLevel } from './types/script'
import { parseScriptControlMessage, type ScriptControlMessage } from './script-progress'

export const SCRIPT_LOG_PREFIX = '@autoforge/log '
export const SCRIPT_RESULT_PREFIX = '@autoforge/result '
export const SCRIPT_ERROR_PREFIX = '@autoforge/error '
export const SCRIPT_CONTROL_PREFIX = '@autoforge/ctl '

export interface ParsedScriptLog {
  level: LogLevel
  message: string
}

function parseJsonPayload<T>(line: string, prefix: string): T | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith(prefix)) return null
  try {
    return JSON.parse(trimmed.slice(prefix.length)) as T
  } catch {
    return null
  }
}

/** 解析 @autoforge/log 行 */
export function parseScriptLogMessage(line: string): ParsedScriptLog | null {
  const raw = parseJsonPayload<{ level?: string; message?: string }>(line, SCRIPT_LOG_PREFIX)
  if (!raw?.message) return null
  const level =
    raw.level === 'WARN' || raw.level === 'ERROR' ? raw.level : ('INFO' as LogLevel)
  return { level, message: raw.message }
}

/** 解析 @autoforge/result 行，返回 value 字段 */
export function parseScriptResultMessage(line: string): unknown | null {
  if (!line.trim().startsWith(SCRIPT_RESULT_PREFIX)) return null
  const raw = parseJsonPayload<{ value?: unknown }>(line, SCRIPT_RESULT_PREFIX)
  if (!raw || !('value' in raw)) return null
  return raw.value
}

/** 解析 @autoforge/error 行 */
export function parseScriptErrorMessage(line: string): string | null {
  const raw = parseJsonPayload<{ message?: string }>(line, SCRIPT_ERROR_PREFIX)
  return raw?.message?.trim() ? raw.message.trim() : null
}

export type PythonProtocolMessage =
  | { kind: 'log'; level: LogLevel; message: string }
  | { kind: 'control'; control: ScriptControlMessage }
  | { kind: 'result'; value: unknown }
  | { kind: 'error'; message: string }

/** 解析 Python 子进程 stdout 单行协议消息 */
export function parsePythonProtocolLine(line: string): PythonProtocolMessage | null {
  const log = parseScriptLogMessage(line)
  if (log) return { kind: 'log', ...log }

  const control = parseScriptControlMessage(line)
  if (control) return { kind: 'control', control }

  const value = parseScriptResultMessage(line)
  if (value !== null || line.trim().startsWith(SCRIPT_RESULT_PREFIX)) {
    return { kind: 'result', value: value ?? null }
  }

  const err = parseScriptErrorMessage(line)
  if (err) return { kind: 'error', message: err }

  return null
}
