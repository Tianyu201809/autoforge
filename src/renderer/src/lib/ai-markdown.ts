import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false
})
markdown.validateLink = isSafeLink

markdown.renderer.rules.image = () => ''

function isSafeLink(raw: string): boolean {
  const value = raw.trim()
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function renderAiMarkdown(source: string): string {
  const rendered = markdown.render(source)
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: [
      'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
    ],
    ALLOWED_ATTR: ['href', 'class'],
    ALLOW_DATA_ATTR: false
  })
}
