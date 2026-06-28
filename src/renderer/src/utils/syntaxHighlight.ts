function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const JS_KEYWORDS =
  /\b(async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield)\b/g

const JS_BOOLEANS = /\b(true|false|null|undefined)\b/g

const JS_NUMBERS = /\b(\d+\.?\d*)\b/g

function wrap(className: string, text: string): string {
  return `<span class="${className}">${text}</span>`
}

export function highlightJavaScript(code: string): string {
  const placeholders: string[] = []
  let escaped = escapeHtml(code)

  escaped = escaped.replace(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)/g, (m) => {
    placeholders.push(wrap('sb-hl-string', m))
    return `\x00S${placeholders.length - 1}\x00`
  })

  escaped = escaped.replace(/(\/\*(?:[^*]|\*(?!\/))*\*\/)/g, (m) => {
    placeholders.push(wrap('sb-hl-comment', m))
    return `\x00S${placeholders.length - 1}\x00`
  })

  escaped = escaped.replace(/(\/\/[^\n]*)/g, (m) => {
    placeholders.push(wrap('sb-hl-comment', m))
    return `\x00S${placeholders.length - 1}\x00`
  })

  escaped = escaped.replace(JS_KEYWORDS, (m) => wrap('sb-hl-keyword', m))
  escaped = escaped.replace(JS_BOOLEANS, (m) => wrap('sb-hl-boolean', m))
  escaped = escaped.replace(JS_NUMBERS, (m) => wrap('sb-hl-number', m))
  escaped = escaped.replace(/\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, (_, name) => wrap('sb-hl-fn', name))

  return escaped.replace(/\x00S(\d+)\x00/g, (_, i) => placeholders[Number(i)])
}

export function highlightJson(code: string): string {
  const placeholders: string[] = []
  let escaped = escapeHtml(code)

  escaped = escaped.replace(/("(?:\\.|[^"\\])*")(\s*:)/g, (_, key, colon) => {
    placeholders.push(wrap('sb-hl-key', key))
    return `\x00S${placeholders.length - 1}\x00${colon}`
  })

  escaped = escaped.replace(/("(?:\\.|[^"\\])*")/g, (m) => {
    placeholders.push(wrap('sb-hl-string', m))
    return `\x00S${placeholders.length - 1}\x00`
  })

  escaped = escaped.replace(/\b(true|false|null)\b/g, (m) => wrap('sb-hl-boolean', m))
  escaped = escaped.replace(/\b(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, (m) => wrap('sb-hl-number', m))

  return escaped.replace(/\x00S(\d+)\x00/g, (_, i) => placeholders[Number(i)])
}

export function highlightCode(code: string, language: 'javascript' | 'json'): string {
  if (language === 'json') return highlightJson(code)
  return highlightJavaScript(code)
}
