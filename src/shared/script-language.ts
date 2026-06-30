/** 脚本运行时语言 — 为 JS / Python 执行器分流预留 */
export type ScriptLanguage = 'javascript' | 'python'

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'])
const PY_EXTENSIONS = new Set(['.py'])

export function resolveScriptLanguage(
  manifestLanguage?: ScriptLanguage | string,
  entry?: string
): ScriptLanguage {
  if (manifestLanguage === 'python' || manifestLanguage === 'javascript') {
    return manifestLanguage
  }
  if (entry) {
    const dot = entry.lastIndexOf('.')
    if (dot >= 0) {
      const ext = entry.slice(dot).toLowerCase()
      if (PY_EXTENSIONS.has(ext)) return 'python'
      if (JS_EXTENSIONS.has(ext)) return 'javascript'
    }
  }
  return 'javascript'
}

export interface ScriptLanguageBadge {
  label: string
  className: string
}

export function scriptLanguageBadge(language: ScriptLanguage): ScriptLanguageBadge {
  if (language === 'python') {
    return {
      label: 'Py',
      className: 'text-sky-400/90 border-sky-500/25 bg-sky-500/10'
    }
  }
  return {
    label: 'JS',
    className: 'text-amber-400/90 border-amber-500/25 bg-amber-500/10'
  }
}
