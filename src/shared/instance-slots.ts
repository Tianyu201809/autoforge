import type { ScriptInstanceSlot } from './types/script'

export const MAX_INSTANCE_SLOTS = 5
export const MAX_CONCURRENT_SESSIONS_PER_SCRIPT = 5

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeParams(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const params: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params[key] = raw
    else if (raw == null) params[key] = ''
    else params[key] = String(raw)
  }
  return params
}

function normalizeBrowser(value: unknown): ScriptInstanceSlot['browser'] | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.headless === 'boolean') return { headless: value.headless }
  return undefined
}

export function normalizeInstanceSlots(input: unknown): ScriptInstanceSlot[] {
  if (!Array.isArray(input)) return []
  const slots: ScriptInstanceSlot[] = []
  for (const item of input) {
    if (!isRecord(item)) continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const envId = typeof item.envId === 'string' ? item.envId.trim() : ''
    if (!id || !name || !envId) continue
    slots.push({
      id,
      name,
      envId,
      params: normalizeParams(item.params),
      browser: normalizeBrowser(item.browser)
    })
  }
  return slots
}

export function assertSlotsWritable(slots: ScriptInstanceSlot[]): void {
  if (slots.length > MAX_INSTANCE_SLOTS) {
    throw new Error(`每个脚本最多保存 ${MAX_INSTANCE_SLOTS} 个实例配置`)
  }
  for (const slot of slots) {
    if (!slot.id?.trim()) throw new Error('实例配置缺少 id')
    if (!slot.name?.trim()) throw new Error('实例名称不能为空')
    if (!slot.envId?.trim()) throw new Error('实例必须选择运行环境')
  }
  const ids = new Set(slots.map((s) => s.id))
  if (ids.size !== slots.length) throw new Error('实例配置 id 不能重复')
}
