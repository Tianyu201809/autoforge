/** JS utility process 与主进程之间的宿主消息 */

import type { ScriptProgressInput, ScriptStageInput } from './script-progress'

export type HostStartMessage = {
  type: 'start'
  entryPath: string
  sessionId: string
  scriptId: string
  env: Record<string, string>
  params: Record<string, string>
  paths: { userData: string; scriptDir: string }
}

export type HostInbound = HostStartMessage | { type: 'abort' }

export type HostOutbound =
  | { type: 'log'; level: 'INFO' | 'WARN' | 'ERROR'; message: string }
  | { type: 'stage'; stage: ScriptStageInput }
  | { type: 'progress'; progress: ScriptProgressInput }
  | { type: 'browser'; pid: number }
  | { type: 'result'; value: unknown }
  | { type: 'error'; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** 解析宿主出站消息；无法识别时返回 null。未点名的字段原样保留。 */
export function parseHostOutbound(value: unknown): HostOutbound | null {
  if (!isRecord(value)) return null

  if (value.type === 'log') {
    if (value.level !== 'INFO' && value.level !== 'WARN' && value.level !== 'ERROR') return null
    if (typeof value.message !== 'string') return null
    return value as HostOutbound
  }

  if (value.type === 'error') {
    if (typeof value.message !== 'string') return null
    return value as HostOutbound
  }

  if (value.type === 'browser') {
    if (!isPositiveInteger(value.pid)) return null
    return value as HostOutbound
  }

  if (value.type === 'stage' || value.type === 'progress' || value.type === 'result') {
    return value as HostOutbound
  }

  return null
}
