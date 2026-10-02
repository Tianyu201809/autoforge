export type ConversionTurnStatus = 'running' | 'complete' | 'cancelled' | 'error'

export interface ConversionFileChange {
  path: string
  kind: 'generate' | 'copy' | 'manifest'
  note: string
  lines?: number
}

export interface ConversionTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  status: ConversionTurnStatus
  error?: string
  /** 这一轮写进脚本包的文件，供界面列出修改点 */
  changes?: ConversionFileChange[]
  createdAt: string
}

export interface ConversionConversation {
  turns: ConversionTurn[]
}

const TURN_STATUSES = new Set<ConversionTurnStatus>(['running', 'complete', 'cancelled', 'error'])

const CHANGE_KINDS = new Set<ConversionFileChange['kind']>(['generate', 'copy', 'manifest'])

function readFileChanges(value: unknown): ConversionFileChange[] | undefined {
  if (!Array.isArray(value)) return undefined
  const changes: ConversionFileChange[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const change = item as Partial<ConversionFileChange>
    if (typeof change.path !== 'string' || !change.path.trim()) continue
    if (typeof change.note !== 'string') continue
    if (change.kind !== 'generate' && change.kind !== 'copy' && change.kind !== 'manifest') continue
    if (!CHANGE_KINDS.has(change.kind)) continue
    const lines = typeof change.lines === 'number' && change.lines >= 0 ? change.lines : undefined
    changes.push({ path: change.path, kind: change.kind, note: change.note, lines })
  }
  return changes.length > 0 ? changes : undefined
}

function isConversionTurn(value: unknown): value is ConversionTurn {
  if (!value || typeof value !== 'object') return false
  const turn = value as Partial<ConversionTurn>
  if (turn.role !== 'user' && turn.role !== 'assistant') return false
  if (typeof turn.content !== 'string') return false
  if (typeof turn.id !== 'string' || typeof turn.createdAt !== 'string') return false
  if (typeof turn.status !== 'string' || !TURN_STATUSES.has(turn.status)) return false
  const changes = readFileChanges((value as { changes?: unknown }).changes)
  if (changes) turn.changes = changes
  else delete turn.changes
  return true
}

/** 把一次转换结果整理成界面上的修改点。 */
export function describeConversionChanges(input: {
  entry: string
  files: Array<{ path: string; content: string }>
  copies: Array<{ from: string; to: string }>
}): ConversionFileChange[] {
  const changes: ConversionFileChange[] = input.files.map((file) => ({
    path: file.path,
    kind: 'generate' as const,
    note: file.path === input.entry ? '脚本入口' : '新生成的文件',
    lines: file.content ? file.content.split(/\r?\n/).length : undefined
  }))
  for (const copy of input.copies) {
    changes.push({
      path: copy.to,
      kind: 'copy',
      note: `从仓库 ${copy.from} 复制`
    })
  }
  changes.push({
    path: 'autoforge.json',
    kind: 'manifest',
    note: '脚本清单'
  })
  return changes
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

/** 送给模型的先前对话。只有用户原话和助手摘要，跳过思考过程和仍在进行的轮次。 */
export function formatConversionHistory(turns: ConversionTurn[]): string {
  const lines: string[] = []
  for (const turn of turns) {
    if (turn.status === 'running') continue
    if (turn.role === 'user') lines.push(`用户：${turn.content}`)
    else lines.push(`助手：${turn.content}`)
  }
  if (lines.length === 0) return ''
  return ['先前对话：', ...lines].join('\n')
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
