import { existsSync } from 'fs'
import { isAttachmentParamEmpty, parseParamAttachments } from './param-attachments'
import { parseCheckboxValue } from './param-choices'
import type { SchemaValueField } from './schema-values'

/** 校验合并后的 env / params 值是否符合 schema（主进程使用） */
export function validateSchemaValues(
  fields: SchemaValueField[],
  values: Record<string, string>,
  options: { subject: string; tab: string }
): string | null {
  for (const def of fields) {
    const raw = values[def.key]
    if (def.type === 'attachment') {
      const items = parseParamAttachments(raw)
      if (def.required && isAttachmentParamEmpty(raw)) {
        return `缺少必填附件: ${def.label}（${def.key}），请在脚本「${options.tab}」Tab 中上传`
      }
      for (const item of items) {
        if (!existsSync(item.path)) {
          return `附件不存在或已失效: ${item.name}（${def.key}），请重新上传`
        }
      }
      continue
    }
    if (def.type === 'checkbox') {
      if (def.required && parseCheckboxValue(raw).length === 0) {
        return `缺少必填${options.subject}: ${def.label}（${def.key}），请在脚本「${options.tab}」Tab 中至少勾选一项`
      }
      continue
    }
    if (def.required && !raw?.trim()) {
      return `缺少必填${options.subject}: ${def.label}（${def.key}），请在脚本「${options.tab}」Tab 中填写`
    }
  }
  return null
}
