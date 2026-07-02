/** 脚本向平台报告执行阶段与进度的控制协议 */

import { SCRIPT_CONTROL_PREFIX } from './script-protocol'

export { SCRIPT_CONTROL_PREFIX }

export type ScriptProgressScope = 'task' | 'total'

/** 脚本自定义执行阶段（区别于平台 lifecycle phase） */
export interface ScriptStageControl {
  kind: 'stage'
  /** 机器可读阶段 ID，如 import / validate */
  name: string
  /** UI 展示名 */
  label?: string
  message?: string
}

/** 进度切片 — scope=task 为当前子任务，scope=total 为整批总进度 */
export interface ScriptProgressControl {
  kind: 'progress'
  scope: ScriptProgressScope
  current: number
  /** 省略时表示不确定进度（indeterminate） */
  total?: number
  label?: string
  message?: string
  /** 计数单位，如 条 / 文件 / 页 */
  unit?: string
}

export type ScriptControlMessage = ScriptStageControl | ScriptProgressControl

export interface ScriptProgressSlice {
  current: number
  total?: number
  label?: string
  message?: string
  unit?: string
}

export interface ScriptStageInfo {
  name: string
  label?: string
  message?: string
}

/** 会话上聚合的最新进度快照 */
export interface ScriptRunProgress {
  stage?: ScriptStageInfo
  task?: ScriptProgressSlice
  total?: ScriptProgressSlice
  updatedAt?: string
}

export type ScriptStageInput = Omit<ScriptStageControl, 'kind'>
export type ScriptProgressInput = Omit<ScriptProgressControl, 'kind'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function readOptionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const raw = obj[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

function readFiniteNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const raw = obj[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) return Number(raw)
  return undefined
}

/** 序列化为单行控制消息（供 ctx.log 或 stdout 使用） */
export function serializeScriptControl(message: ScriptControlMessage): string {
  return `${SCRIPT_CONTROL_PREFIX}${JSON.stringify(message)}`
}

/** 从日志行解析控制消息；非控制行返回 null */
export function parseScriptControlMessage(line: string): ScriptControlMessage | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith(SCRIPT_CONTROL_PREFIX)) return null

  const jsonText = trimmed.slice(SCRIPT_CONTROL_PREFIX.length)
  try {
    const raw = JSON.parse(jsonText) as unknown
    if (!isRecord(raw) || typeof raw.kind !== 'string') return null

    if (raw.kind === 'stage') {
      const name = readOptionalString(raw, 'name')
      if (!name) return null
      return {
        kind: 'stage',
        name,
        label: readOptionalString(raw, 'label'),
        message: readOptionalString(raw, 'message')
      }
    }

    if (raw.kind === 'progress') {
      const scope = raw.scope
      if (scope !== 'task' && scope !== 'total') return null
      const current = readFiniteNumber(raw, 'current')
      if (current === undefined || current < 0) return null
      const total = readFiniteNumber(raw, 'total')
      if (total !== undefined && total < 0) return null
      return {
        kind: 'progress',
        scope,
        current,
        total,
        label: readOptionalString(raw, 'label'),
        message: readOptionalString(raw, 'message'),
        unit: readOptionalString(raw, 'unit')
      }
    }

    return null
  } catch {
    return null
  }
}

/** 将控制消息合并进会话进度快照 */
export function applyScriptControl(
  prev: ScriptRunProgress | undefined,
  message: ScriptControlMessage
): ScriptRunProgress {
  const next: ScriptRunProgress = { ...(prev ?? {}) }

  if (message.kind === 'stage') {
    next.stage = {
      name: message.name,
      label: message.label,
      message: message.message
    }
    return next
  }

  const slice: ScriptProgressSlice = {
    current: message.current,
    total: message.total,
    label: message.label,
    message: message.message,
    unit: message.unit
  }

  if (message.scope === 'task') {
    next.task = slice
  } else {
    next.total = slice
  }

  return next
}

function formatSlice(scopeLabel: string, slice: ScriptProgressSlice): string {
  const unit = slice.unit ? ` ${slice.unit}` : ''
  const ratio =
    slice.total != null && slice.total > 0
      ? `${slice.current}/${slice.total}${unit} (${Math.min(100, Math.round((slice.current / slice.total) * 100))}%)`
      : `${slice.current}${unit}`
  const title = slice.label?.trim() || scopeLabel
  const detail = slice.message?.trim()
  return detail ? `${title} · ${ratio} — ${detail}` : `${title} · ${ratio}`
}

/** 终端面板可读的单行文本 */
export function formatControlLogLine(message: ScriptControlMessage): string {
  if (message.kind === 'stage') {
    const title = message.label?.trim() || message.name
    return message.message?.trim() ? `[阶段] ${title} — ${message.message}` : `[阶段] ${title}`
  }

  const scopeLabel = message.scope === 'task' ? '任务' : '总计'
  return `[进度·${scopeLabel}] ${formatSlice(scopeLabel, {
    current: message.current,
    total: message.total,
    label: message.label,
    message: message.message,
    unit: message.unit
  })}`
}

/** 脚本卡片 / 状态栏一行摘要 */
export function formatScriptRunProgressSummary(progress: ScriptRunProgress | undefined): string | null {
  if (!progress) return null

  const parts: string[] = []
  if (progress.stage) {
    parts.push(progress.stage.label?.trim() || progress.stage.name)
  }
  if (progress.total) {
    parts.push(formatSlice('总进度', progress.total))
  } else if (progress.task) {
    parts.push(formatSlice('任务', progress.task))
  }

  return parts.length ? parts.join(' · ') : null
}

/** 判断日志是否为控制行（用于 UI 样式） */
export function isControlLogMessage(message: string): boolean {
  return message.startsWith('[阶段]') || message.startsWith('[进度·')
}
