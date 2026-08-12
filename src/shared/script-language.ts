/** 脚本运行时类型 */
export type ScriptLanguage = 'javascript' | 'python' | 'executable'

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'])
const PY_EXTENSIONS = new Set(['.py'])

export function resolveScriptLanguage(
  manifestLanguage?: ScriptLanguage | string,
  entry?: string
): ScriptLanguage {
  if (
    manifestLanguage === 'python' ||
    manifestLanguage === 'javascript' ||
    manifestLanguage === 'executable'
  ) {
    return manifestLanguage
  }
  return inferScriptLanguageFromExtension(entry) ?? 'javascript'
}

export function inferScriptLanguageFromExtension(
  entry?: string
): 'javascript' | 'python' | undefined {
  if (entry) {
    const dot = entry.lastIndexOf('.')
    if (dot >= 0) {
      const ext = entry.slice(dot).toLowerCase()
      if (PY_EXTENSIONS.has(ext)) return 'python'
      if (JS_EXTENSIONS.has(ext)) return 'javascript'
    }
  }
  return undefined
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
  if (language === 'executable') {
    return {
      label: 'EXE',
      className: 'text-emerald-400/90 border-emerald-500/25 bg-emerald-500/10'
    }
  }
  return {
    label: 'JS',
    className: 'text-amber-400/90 border-amber-500/25 bg-amber-500/10'
  }
}

export function scriptLanguageTitle(language: ScriptLanguage): string {
  if (language === 'python') return 'Python 脚本'
  if (language === 'executable') return '可执行程序'
  return 'JavaScript 脚本'
}
