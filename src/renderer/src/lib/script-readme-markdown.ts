import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false
})

const PURIFY = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'rel']
}

export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** 将 README 相对图片路径规范为包根相对 posix；非法或逃逸返回 null */
export function resolveReadmeRelativePath(src: string): string | null {
  const raw = src.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('data:')) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return null
  return normalized
}

export function renderScriptReadmeMarkdown(source: string): string {
  const rendered = md.render(source)
  const clean = DOMPurify.sanitize(rendered, PURIFY)
  return rewriteAnchorTargets(clean)
}

function rewriteAnchorTargets(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const a of Array.from(doc.body.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') || ''
    if (href.startsWith('#')) continue
    if (!isSafeHttpUrl(href)) {
      a.removeAttribute('href')
      continue
    }
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }
  return doc.body.innerHTML
}

export function collectRelativeImageSrcs(html: string): string[] {
  if (typeof DOMParser === 'undefined') return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: string[] = []
  const seen = new Set<string>()
  for (const img of Array.from(doc.body.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src') || ''
    const rel = resolveReadmeRelativePath(src)
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    out.push(rel)
  }
  return out
}

export function applyImageDataUrls(html: string, dataUrls: Record<string, string>): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const img of Array.from(doc.body.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src') || ''
    const rel = resolveReadmeRelativePath(src)
    if (!rel) continue
    const dataUrl = dataUrls[rel]
    if (dataUrl) img.setAttribute('src', dataUrl)
  }
  return doc.body.innerHTML
}
