export type ConversionTurnStatus = 'running' | 'complete' | 'cancelled' | 'error'

export interface ConversionTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  status: ConversionTurnStatus
  error?: string
  createdAt: string
}

export interface ConversionConversation {
  turns: ConversionTurn[]
}

const TURN_STATUSES = new Set<ConversionTurnStatus>(['running', 'complete', 'cancelled', 'error'])

function isConversionTurn(value: unknown): value is ConversionTurn {
  if (!value || typeof value !== 'object') return false
  const turn = value as Partial<ConversionTurn>
  if (turn.role !== 'user' && turn.role !== 'assistant') return false
  if (typeof turn.content !== 'string') return false
  if (typeof turn.id !== 'string' || typeof turn.createdAt !== 'string') return false
  if (typeof turn.status !== 'string' || !TURN_STATUSES.has(turn.status)) return false
  return true
}

/** 解析对话文件。空内容、坏 JSON、或 turns 不是数组时返回空对话。 */
export function readConversionConversation(raw: string): ConversionConversation {
  if (!raw.trim()) return { turns: [] }
  try {
    const parsed = JSON.parse(raw) as { turns?: unknown }
    if (!Array.isArray(parsed?.turns)) return { turns: [] }
    return { turns: parsed.turns.filter(isConversionTurn) }
  } catch {
    return { turns: [] }
  }
}

/** 进程中断后仍标着 running 的助手轮次改成失败，用户轮次保持原样。 */
export function normalizeInterruptedConversation(
  conversation: ConversionConversation
): ConversionConversation {
  return {
    turns: conversation.turns.map((turn) =>
      turn.role === 'assistant' && turn.status === 'running'
        ? { ...turn, status: 'error' as const, error: '上次转换未完成' }
        : turn
    )
  }
}

/** 写回对话、也送给模型的结果摘要。只含结论、文件和告警，不含思考过程。 */
export function summarizeAssistantTurn(input: {
  summary: string
  files: string[]
  warnings?: string[]
  notes?: string
}): string {
  const lines = [input.summary.trim()]
  if (input.files.length > 0) lines.push(`写入文件：${input.files.join('、')}`)
  const warnings = (input.warnings ?? []).map((item) => item.trim()).filter(Boolean)
  if (warnings.length > 0) lines.push(`告警：${warnings.join('、')}`)
  const notes = input.notes?.trim()
  if (notes) lines.push(notes)
  return lines.filter(Boolean).join('\n')
}
