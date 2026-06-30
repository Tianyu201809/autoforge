import type { EnvVarDefinition } from './script-contract'
import { defaultSchemaValue } from './schema-values'

export type EnvValueSource = 'script' | 'global' | 'default' | 'empty'

/** 脚本 configByEnv 中是否显式保存了非空值 */
export function isExplicitEnvConfigValue(value: string | undefined): boolean {
  return value !== undefined && value !== ''
}

/** 与运行时 resolveEnvForScript 一致的字段级合并顺序 */
export function resolveEnvFieldValue(
  key: string,
  def: EnvVarDefinition,
  scriptConfig: Record<string, string> | undefined,
  profileVariables: Record<string, string> | undefined
): { value: string; source: EnvValueSource } {
  const scriptVal = scriptConfig?.[key]
  if (isExplicitEnvConfigValue(scriptVal)) {
    return { value: scriptVal!, source: 'script' }
  }
  const globalVal = profileVariables?.[key]
  if (isExplicitEnvConfigValue(globalVal)) {
    return { value: globalVal!, source: 'global' }
  }
  const defaultVal = defaultSchemaValue(def)
  if (defaultVal) {
    return { value: defaultVal, source: 'default' }
  }
  return { value: scriptVal ?? globalVal ?? '', source: 'empty' }
}

export interface GlobalEnvReferenceItem {
  key: string
  label: string
  secret?: boolean
  globalValue: string
  /** 当前表单值已与全局值一致 */
  matched: boolean
  /** 脚本已显式保存且与全局不同 */
  overridden: boolean
}

export function listGlobalEnvReferences(
  schema: EnvVarDefinition[],
  profileVariables: Record<string, string> | undefined,
  scriptConfig: Record<string, string> | undefined,
  currentValues: Record<string, string>
): GlobalEnvReferenceItem[] {
  if (!profileVariables) return []
  const items: GlobalEnvReferenceItem[] = []
  for (const def of schema) {
    const globalValue = profileVariables[def.key]
    if (!isExplicitEnvConfigValue(globalValue)) continue
    const scriptVal = scriptConfig?.[def.key]
    const current = currentValues[def.key] ?? ''
    const overridden = isExplicitEnvConfigValue(scriptVal) && scriptVal !== globalValue
    items.push({
      key: def.key,
      label: def.label,
      secret: def.secret,
      globalValue,
      matched: current === globalValue,
      overridden
    })
  }
  return items
}

export function listUnmappedGlobalEnvKeys(
  schema: EnvVarDefinition[],
  profileVariables: Record<string, string> | undefined
): Array<{ key: string; value: string }> {
  if (!profileVariables) return []
  const schemaKeys = new Set(schema.map((def) => def.key))
  return Object.entries(profileVariables)
    .filter(([key, value]) => isExplicitEnvConfigValue(value) && !schemaKeys.has(key))
    .map(([key, value]) => ({ key, value }))
}

export function formatEnvPreview(value: string, secret?: boolean, maxLen = 28): string {
  if (!value) return '(空)'
  if (secret) return '••••••'
  if (value.length <= maxLen) return value
  return `${value.slice(0, maxLen)}…`
}
