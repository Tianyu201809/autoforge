/** run() 返回值中表示产物目录的字段，按优先级排列 */
export const RUN_RESULT_OUTPUT_DIR_KEYS = [
  'outputDir',
  'outputPath',
  'artifactDir',
  'artifactsDir',
  'exportDir',
  'savedTo'
] as const

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 从 run() 返回值中提取产物目录路径 */
export function extractRunResultOutputDir(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const obj = result as Record<string, unknown>
  for (const key of RUN_RESULT_OUTPUT_DIR_KEYS) {
    const value = obj[key]
    if (isNonEmptyString(value)) return value.trim()
  }
  return null
}

/** 将 run() 返回值格式化为可展示的文本 */
export function formatRunResult(result: unknown): string {
  if (result === undefined || result === null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}
