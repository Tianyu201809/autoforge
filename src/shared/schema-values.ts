import type { ParamValueType } from './script-contract'

/** env / params schema 共用的值字段定义 */
export interface SchemaValueField {
  key: string
  label: string
  required?: boolean
  type?: ParamValueType
}

/** 按类型返回 schema 默认值字符串 */
export function defaultSchemaValue(def: SchemaValueField & { default?: string }): string {
  if (def.type === 'attachment' || def.type === 'checkbox') return def.default ?? '[]'
  if (def.type === 'boolean') return def.default ?? 'false'
  return def.default ?? ''
}
