import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, lstatSync, realpathSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import type { AiProjectAttachment, AiAttachmentPreview } from '../../../shared/ai-workspace-types'

export const ATTACHMENT_LIMITS = { count: 8, imageBytes: 5 * 1024 * 1024, textBytes: 128 * 1024, totalBytes: 20 * 1024 * 1024, requestBytes: 28 * 1024 * 1024 } as const
const textExtensions = new Set('.txt .md .markdown .json .js .mjs .cjs .ts .tsx .jsx .vue .html .css .scss .py .go .rs .java .kt .swift .sh .sql .yaml .yml .toml .xml .csv .log .ini .conf'.split(' '))
const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
function id(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('附件 ID 无效')
  return value
}
function readRegular(file: string, limit: number): Buffer {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(file).toLowerCase() !== resolve(file).toLowerCase()) throw new Error('不支持符号链接或非普通文件')
  if (!stat.size || stat.size > limit) throw new Error('附件为空或超过大小限制')
  const bytes = readFileSync(file)
  if (bytes.length > limit) throw new Error('附件超过大小限制')
  return bytes
}
function validate(bytes: Buffer, extension: string): { kind: 'text' | 'image'; mimeType: string; text?: string } {
  const mimeType = imageTypes[extension]
  if (mimeType) {
    const matches = extension === '.png' ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : extension === '.jpg' || extension === '.jpeg' ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : extension === '.gif' ? /^GIF8[79]a/.test(bytes.subarray(0,6).toString('ascii'))
      : bytes.length >= 12 && bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP'
    if (!matches) throw new Error('图片内容与扩展名不匹配')
    return { kind: 'image', mimeType }
  }
  if (!textExtensions.has(extension)) throw new Error('仅支持 PNG、JPEG、WebP、GIF 图片和 UTF-8 文本/代码文件')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new Error('附件不是有效的 UTF-8 文本')
  return { kind: 'text', mimeType: 'text/plain', text }
}

export function createProjectAttachmentStore(rootPath: string) {
  const root = resolve(rootPath)
  mkdirSync(root, { recursive: true })
  function directory(projectId: string): string {
    id(projectId)
    const dir = join(root, hash(projectId))
    if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || realpathSync(dir).toLowerCase() !== dir.toLowerCase())) throw new Error('附件目录无效')
    return dir
  }
  function stage(projectId: string, paths: string[]): AiProjectAttachment[] {
    if (!Array.isArray(paths) || paths.length > ATTACHMENT_LIMITS.count) throw new Error('每条消息最多添加 8 个附件')
    const dir = directory(projectId)
    const validated = paths.map(file => {
      const extension = extname(file).toLowerCase()
      const bytes = readRegular(file, imageTypes[extension] ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.textBytes)
      const value = validate(bytes, extension)
      const metadata: AiProjectAttachment = { id: randomUUID(), name: basename(file), kind: value.kind, mimeType: value.mimeType, size: bytes.length }
      return { bytes, metadata }
    })
    if (validated.reduce((sum, item) => sum + item.bytes.length, 0) > ATTACHMENT_LIMITS.totalBytes) throw new Error('附件总大小超过 20 MB')
    mkdirSync(dir, { recursive: true })
    try {
      for (const item of validated) {
        writeFileSync(join(dir, `${item.metadata.id}.data`), item.bytes, { flag: 'wx', mode: 0o600 })
        writeFileSync(join(dir, `${item.metadata.id}.json`), JSON.stringify({ ...item.metadata, sha256: hash(item.bytes) }), { flag: 'wx', mode: 0o600 })
      }
    } catch (error) {
      for (const item of validated) remove(projectId, item.metadata.id)
      throw error
    }
    return validated.map(item => item.metadata)
  }
  function read(projectId: string, attachmentId: string): { metadata: AiProjectAttachment; bytes: Buffer; text?: string } {
    const dir = directory(projectId)
    const key = id(attachmentId)
    const record = JSON.parse(readRegular(join(dir, `${key}.json`), 2048).toString('utf8'))
    const bytes = readRegular(join(dir, `${key}.data`), record.kind === 'image' ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.textBytes)
    if (record.id !== key || hash(bytes) !== record.sha256) throw new Error('附件内容已损坏，请重新添加')
    const value = validate(bytes, extname(record.name).toLowerCase())
    const metadata: AiProjectAttachment = { id: key, name: record.name, kind: value.kind, mimeType: value.mimeType, size: bytes.length }
    return { metadata, bytes, text: value.text }
  }
  function preview(projectId: string, attachmentId: string): AiAttachmentPreview {
    const { metadata, bytes, text } = read(projectId, attachmentId)
    return { metadata, ...(metadata.kind === 'image' ? { dataUrl: `data:${metadata.mimeType};base64,${bytes.toString('base64')}` } : { text: text!.slice(0, 4000) }) }
  }
  function remove(projectId: string, attachmentId: string): void {
    const dir = directory(projectId)
    const key = id(attachmentId)
    for (const suffix of ['data', 'json']) rmSync(join(dir, `${key}.${suffix}`), { force: true })
  }
  function removeProject(projectId: string): void { rmSync(directory(projectId), { recursive: true, force: true }) }
  function prune(projectId: string, retained: Set<string>): void {
    const dir = directory(projectId)
    if (!existsSync(dir)) return
    for (const file of readdirSync(dir)) {
      const key = file.replace(/\.(json|data)$/, '')
      if (key !== file && !retained.has(key)) remove(projectId, key)
    }
  }
  return { stage, read, preview, remove, removeProject, prune }
}
