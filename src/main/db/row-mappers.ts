import type { AppConfig, CronConfig, EnvironmentProfile, ExecutionRecord, ScriptMeta } from '../../shared/types/script'
import { resolveScriptLanguage } from '../../shared/script-language'
import type { CategoryOverride, StoredCategory } from '../services/category-service'
import type { ScriptPreference } from '../../shared/types/script'

/** 序列化 JSON 字段，undefined 返回 null */
export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

/** 反序列化 JSON 字段 */
export function fromJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function boolToInt(value: boolean | undefined): number {
  return value ? 1 : 0
}

export function intToBool(value: number | null | undefined): boolean {
  return value === 1
}

export interface ScriptRow {
  id: string
  name: string
  description: string
  workspace_path: string
  category: string
  category_label: string
  category_color: string
  icon: string
  icon_color: string
  icon_bg: string
  icon_border: string
  version: string
  entry: string
  imported_at: string | null
  env_schema: string
  param_schema: string
  dependencies: string | null
  browser: string | null
  starred: number | null
  archived: number | null
  recent_run_at: string | null
  schedule: string | null
  default_env_id: string | null
  config_by_env: string | null
  params_by_env: string | null
  saved_params: string | null
}

export interface ScriptPreferenceRow {
  script_id: string
  starred: number
  archived: number
  recent_run_at: string | null
  schedule: string | null
  default_env_id: string | null
  config_by_env: string
  params_by_env: string
  saved_params: string | null
}

export interface EnvironmentRow {
  id: string
  name: string
  description: string | null
  variables: string
  is_default: number
}

export interface ExecutionRow {
  id: string
  script_id: string
  script_name: string
  status: string
  env_id: string | null
  trigger: string
  started_at: string
  finished_at: string | null
  exit_code: number | null
  error_message: string | null
  duration_ms: number | null
  result: string | null
}

/** JOIN 查询行 → 脚本基础元数据（不含 preference 合并） */
export function rowToScriptBase(row: ScriptRow): ScriptMeta {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    workspacePath: row.workspace_path,
    category: row.category,
    categoryLabel: row.category_label,
    categoryColor: row.category_color,
    icon: row.icon as ScriptMeta['icon'],
    iconColor: row.icon_color,
    iconBg: row.icon_bg,
    iconBorder: row.icon_border,
    version: row.version,
    importedAt: row.imported_at ?? undefined,
    entry: row.entry,
    language: resolveScriptLanguage(undefined, row.entry),
    envSchema: fromJson(row.env_schema, []),
    paramSchema: fromJson(row.param_schema, []),
    dependencies: fromJson(row.dependencies, undefined),
    browser: fromJson(row.browser, undefined),
    starred: intToBool(row.starred ?? 0),
    archived: intToBool(row.archived ?? 0),
    recentRunAt: row.recent_run_at ?? undefined,
    schedule: fromJson<CronConfig | undefined>(row.schedule, undefined),
    defaultEnvId: row.default_env_id ?? undefined,
    configByEnv: fromJson(row.config_by_env, {}),
    paramsByEnv: fromJson(row.params_by_env, {}),
    savedParams: fromJson(row.saved_params, undefined)
  }
}

export function rowToPreference(row: ScriptPreferenceRow): ScriptPreference {
  return {
    starred: intToBool(row.starred),
    archived: intToBool(row.archived),
    recentRunAt: row.recent_run_at ?? undefined,
    schedule: fromJson<CronConfig | undefined>(row.schedule, undefined),
    defaultEnvId: row.default_env_id ?? undefined,
    configByEnv: fromJson(row.config_by_env, {}),
    paramsByEnv: fromJson(row.params_by_env, {}),
    savedParams: fromJson(row.saved_params, undefined)
  }
}

export function preferenceToRow(scriptId: string, pref: ScriptPreference): ScriptPreferenceRow {
  return {
    script_id: scriptId,
    starred: boolToInt(pref.starred),
    archived: boolToInt(pref.archived),
    recent_run_at: pref.recentRunAt ?? null,
    schedule: toJson(pref.schedule),
    default_env_id: pref.defaultEnvId ?? null,
    config_by_env: JSON.stringify(pref.configByEnv ?? {}),
    params_by_env: JSON.stringify(pref.paramsByEnv ?? {}),
    saved_params: toJson(pref.savedParams)
  }
}

/** 写入 scripts 表的字段（不含 preference） */
export function scriptMetaToScriptRow(meta: Omit<ScriptMeta, 'starred' | 'archived'> | ScriptMeta): Omit<ScriptRow, keyof ScriptPreferenceRow | 'starred' | 'archived' | 'recent_run_at' | 'schedule' | 'default_env_id' | 'config_by_env' | 'params_by_env' | 'saved_params'> {
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    workspace_path: meta.workspacePath,
    category: meta.category,
    category_label: meta.categoryLabel,
    category_color: meta.categoryColor,
    icon: meta.icon,
    icon_color: meta.iconColor,
    icon_bg: meta.iconBg,
    icon_border: meta.iconBorder,
    version: meta.version,
    imported_at: meta.importedAt ?? null,
    entry: meta.entry,
    env_schema: JSON.stringify(meta.envSchema ?? []),
    param_schema: JSON.stringify(meta.paramSchema ?? []),
    dependencies: toJson(meta.dependencies),
    browser: toJson(meta.browser)
  }
}

export function extractPreferenceFromMeta(meta: Partial<ScriptMeta>): ScriptPreference {
  const pref: ScriptPreference = {}
  if (meta.starred !== undefined) pref.starred = meta.starred
  if (meta.archived !== undefined) pref.archived = meta.archived
  if (meta.recentRunAt !== undefined) pref.recentRunAt = meta.recentRunAt
  if (meta.schedule !== undefined) pref.schedule = meta.schedule
  if (meta.defaultEnvId !== undefined) pref.defaultEnvId = meta.defaultEnvId
  if (meta.configByEnv !== undefined) pref.configByEnv = meta.configByEnv
  if (meta.paramsByEnv !== undefined) pref.paramsByEnv = meta.paramsByEnv
  if (meta.savedParams !== undefined) pref.savedParams = meta.savedParams
  return pref
}

export function rowToEnvironment(row: EnvironmentRow): EnvironmentProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    variables: fromJson(row.variables, {}),
    isDefault: intToBool(row.is_default)
  }
}

export function environmentToRow(env: EnvironmentProfile): EnvironmentRow {
  return {
    id: env.id,
    name: env.name,
    description: env.description ?? null,
    variables: JSON.stringify(env.variables ?? {}),
    is_default: boolToInt(env.isDefault)
  }
}

export function rowToStoredCategory(row: { id: string; key: string; label: string; color_preset: string }): StoredCategory {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    colorPreset: row.color_preset
  }
}

export function rowToCategoryOverride(row: { key: string; label: string | null; color_preset: string | null }): CategoryOverride {
  return {
    key: row.key,
    label: row.label ?? undefined,
    colorPreset: row.color_preset ?? undefined
  }
}

export function rowToExecutionRecord(row: ExecutionRow): ExecutionRecord {
  return {
    id: row.id,
    scriptId: row.script_id,
    scriptName: row.script_name,
    status: row.status as ExecutionRecord['status'],
    envId: row.env_id ?? undefined,
    trigger: row.trigger as ExecutionRecord['trigger'],
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    exitCode: row.exit_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    result: fromJson(row.result, undefined)
  }
}

export function executionRecordToRow(record: ExecutionRecord): ExecutionRow {
  return {
    id: record.id,
    script_id: record.scriptId,
    script_name: record.scriptName,
    status: record.status,
    env_id: record.envId ?? null,
    trigger: record.trigger,
    started_at: record.startedAt,
    finished_at: record.finishedAt ?? null,
    exit_code: record.exitCode ?? null,
    error_message: record.errorMessage ?? null,
    duration_ms: record.durationMs ?? null,
    result: toJson(record.result)
  }
}
