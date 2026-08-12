export function normalizeExecutableParamKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

export function assertExecutableParamKeys(params: Array<{ key: string }>): void {
  const seen = new Map<string, string>()
  for (const item of params) {
    const normalized = normalizeExecutableParamKey(item.key)
    const previous = seen.get(normalized)
    if (previous !== undefined) {
      throw new Error(`参数环境变量冲突: ${previous} 与 ${item.key}`)
    }
    seen.set(normalized, item.key)
  }
}
