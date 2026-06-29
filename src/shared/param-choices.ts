/** checkbox 多选参数的值 — 序列化为 JSON 字符串数组存入 ctx.params[key] */

export function parseCheckboxValue(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function serializeCheckboxValue(values: string[]): string {
  return JSON.stringify(values)
}

export function toggleCheckboxValue(raw: string | undefined, value: string): string {
  const current = parseCheckboxValue(raw)
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
  return serializeCheckboxValue(next)
}
