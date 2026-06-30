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
