/** 运行参数中的附件项 — 序列化为 JSON 存入 ctx.params[key] */

export interface ParamAttachmentItem {
  name: string
  path: string
  size?: number
}

export function parseParamAttachments(raw: string | undefined): ParamAttachmentItem[] {
  if (!raw?.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ParamAttachmentItem =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as ParamAttachmentItem).name === 'string' &&
        typeof (item as ParamAttachmentItem).path === 'string'
    )
  } catch {
    return []
  }
}

export function serializeParamAttachments(items: ParamAttachmentItem[]): string {
  return JSON.stringify(items)
}

export function isAttachmentParamEmpty(raw: string | undefined): boolean {
  return parseParamAttachments(raw).length === 0
}
