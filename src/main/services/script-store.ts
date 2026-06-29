import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { UTF8 } from '../../shared/encoding'
import { randomUUID } from 'crypto'
import { defaultSchemaValue } from '../../shared/schema-values'
import { validateSchemaValues } from '../../shared/schema-validation'
import type { AppConfig, CategoryDefinition, CronConfig, EnvironmentProfile, ScriptMeta } from '../../shared/types/script'
import {
  createStoredCategory,
  mergeCategoryDefinitions,
  type CategoryOverride,
  type StoredCategory
} from './category-service'

export interface ScriptPreference {
  starred?: boolean
  archived?: boolean
  recentRunAt?: string
  schedule?: CronConfig
  defaultEnvId?: string
  /** 脚本在各环境下的 env 专属配置值 */
  configByEnv?: Record<string, Record<string, string>>
  /** 脚本在各环境下上次保存的运行参数 */
  paramsByEnv?: Record<string, Record<string, string>>
  /** @deprecated 旧版全局参数，读取时会迁移到 paramsByEnv */
  savedParams?: Record<string, string>
}

interface PersistedData {
  scripts: ScriptMeta[]
  environments: EnvironmentProfile[]
  categories: StoredCategory[]
  categoryOverrides: CategoryOverride[]
  config: AppConfig
  preferences: Record<string, ScriptPreference>
}

const DEFAULT_CONFIG: AppConfig = {
  logLevel: 'INFO'
}

const DEFAULT_ENV: EnvironmentProfile = {
  id: 'default',
  name: '默认环境',
  description: '未指定时的默认环境变量集',
  variables: {},
  isDefault: true
}

export class ScriptStore {
  private dataPath = ''
  private data: PersistedData = {
    scripts: [],
    environments: [{ ...DEFAULT_ENV }],
    categories: [],
    categoryOverrides: [],
    config: { ...DEFAULT_CONFIG },
    preferences: {}
  }
  private initialized = false

  private ensureInitialized(): void {
    if (this.initialized) return
    const userData = app.getPath('userData')
    if (!existsSync(userData)) {
      mkdirSync(userData, { recursive: true })
    }
    const newPath = join(userData, 'autoforge-data.json')
    const legacyPath = join(userData, 'script-box-data.json')
    this.dataPath = existsSync(newPath) ? newPath : legacyPath
    this.data = this.load()
    this.initialized = true
  }

  private load(): PersistedData {
    if (!existsSync(this.dataPath)) {
      return {
        scripts: [],
        environments: [{ ...DEFAULT_ENV }],
        categories: [],
        categoryOverrides: [],
        config: { ...DEFAULT_CONFIG },
        preferences: {}
      }
    }
    try {
      const raw = readFileSync(this.dataPath, UTF8)
      const parsed = JSON.parse(raw) as Partial<PersistedData> & {
        importedScripts?: ScriptMeta[]
      }
      // 迁移旧版 importedScripts → scripts
      const scripts = parsed.scripts ?? parsed.importedScripts ?? []
      return {
        scripts,
        environments: parsed.environments?.length ? parsed.environments : [{ ...DEFAULT_ENV }],
        categories: parsed.categories ?? [],
        categoryOverrides: parsed.categoryOverrides ?? [],
        config: { ...DEFAULT_CONFIG, ...parsed.config },
        preferences: parsed.preferences ?? {}
      }
    } catch {
      return {
        scripts: [],
        environments: [{ ...DEFAULT_ENV }],
        categories: [],
        categoryOverrides: [],
        config: { ...DEFAULT_CONFIG },
        preferences: {}
      }
    }
  }

  private save(): void {
    const userData = app.getPath('userData')
    this.dataPath = join(userData, 'autoforge-data.json')
    writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), UTF8)
  }

  getScripts(): ScriptMeta[] {
    this.ensureInitialized()
    return this.data.scripts.map((s) => this.applyPreference(s))
  }

  private mergeParamsByEnv(pref: ScriptPreference, script: ScriptMeta): Record<string, Record<string, string>> {
    const byEnv = { ...(pref.paramsByEnv ?? script.paramsByEnv ?? {}) }
    const legacy = pref.savedParams ?? script.savedParams
    if (legacy && Object.keys(legacy).length > 0) {
      const envId = pref.defaultEnvId ?? script.defaultEnvId ?? this.getDefaultEnvironment().id
      if (!byEnv[envId] || Object.keys(byEnv[envId]).length === 0) {
        byEnv[envId] = { ...legacy }
      }
    }
    return byEnv
  }

  private applyPreference(script: ScriptMeta): ScriptMeta {
    const pref = this.data.preferences[script.id] ?? {}
    return {
      ...script,
      starred: pref.starred ?? script.starred ?? false,
      archived: pref.archived ?? script.archived ?? false,
      recentRunAt: pref.recentRunAt ?? script.recentRunAt,
      schedule: pref.schedule ?? script.schedule,
      defaultEnvId: pref.defaultEnvId ?? script.defaultEnvId,
      configByEnv: pref.configByEnv ?? script.configByEnv ?? {},
      paramsByEnv: this.mergeParamsByEnv(pref, script),
      paramSchema: script.paramSchema ?? []
    }
  }

  addScript(meta: Omit<ScriptMeta, 'starred' | 'archived'>): ScriptMeta {
    this.ensureInitialized()
    const script: ScriptMeta = { ...meta, starred: false, archived: false }
    this.data.scripts.push(script)
    this.save()
    return script
  }

  updateScript(id: string, patch: Partial<ScriptMeta>): ScriptMeta | null {
    this.ensureInitialized()
    const index = this.data.scripts.findIndex((s) => s.id === id)
    if (index === -1) return null

    const { starred, archived, recentRunAt, schedule, defaultEnvId, configByEnv, paramsByEnv, savedParams, ...metaPatch } =
      patch
    this.data.scripts[index] = { ...this.data.scripts[index], ...metaPatch }

    const prefPatch: ScriptPreference = {}
    if (starred !== undefined) prefPatch.starred = starred
    if (archived !== undefined) prefPatch.archived = archived
    if (recentRunAt !== undefined) prefPatch.recentRunAt = recentRunAt
    if (schedule !== undefined) prefPatch.schedule = schedule
    if (defaultEnvId !== undefined) prefPatch.defaultEnvId = defaultEnvId
    if (configByEnv !== undefined) prefPatch.configByEnv = configByEnv
    if (paramsByEnv !== undefined) prefPatch.paramsByEnv = paramsByEnv
    if (savedParams !== undefined) prefPatch.savedParams = savedParams
    if (Object.keys(prefPatch).length) {
      this.data.preferences[id] = { ...this.data.preferences[id], ...prefPatch }
    }

    this.save()
    return this.applyPreference(this.data.scripts[index])
  }

  deleteScript(id: string): boolean {
    this.ensureInitialized()
    const before = this.data.scripts.length
    this.data.scripts = this.data.scripts.filter((s) => s.id !== id)
    delete this.data.preferences[id]
    if (this.data.scripts.length === before) return false
    this.save()
    return true
  }

  getScriptById(id: string): ScriptMeta | undefined {
    return this.getScripts().find((s) => s.id === id)
  }

  getEnvironments(): EnvironmentProfile[] {
    this.ensureInitialized()
    return this.data.environments
  }

  getEnvironment(id: string): EnvironmentProfile | undefined {
    return this.getEnvironments().find((e) => e.id === id)
  }

  getDefaultEnvironment(): EnvironmentProfile {
    const envs = this.getEnvironments()
    return envs.find((e) => e.isDefault) ?? envs[0] ?? { ...DEFAULT_ENV }
  }

  /** 合并：schema 默认值 → 全局 Profile 共享变量 → 脚本专属配置（优先级最高） */
  resolveEnvForScript(script: ScriptMeta, envId?: string): Record<string, string> {
    const resolvedEnvId =
      envId ?? script.defaultEnvId ?? this.getDefaultEnvironment().id

    const profile = this.getEnvironment(resolvedEnvId)

    const resolved: Record<string, string> = {}
    for (const def of script.envSchema) {
      const defaultVal = defaultSchemaValue(def)
      if (defaultVal) resolved[def.key] = defaultVal
    }
    if (profile?.variables) {
      for (const [key, value] of Object.entries(profile.variables)) {
        if (value !== undefined && value !== '') resolved[key] = value
      }
    }
    const scriptConfig = script.configByEnv?.[resolvedEnvId] ?? {}
    for (const [key, value] of Object.entries(scriptConfig)) {
      if (value !== undefined && value !== '') resolved[key] = value
    }
    return resolved
  }

  /** 保存脚本在指定环境下的配置项 */
  setScriptEnvConfig(scriptId: string, envId: string, values: Record<string, string>): ScriptMeta | null {
    this.ensureInitialized()
    const script = this.data.scripts.find((s) => s.id === scriptId)
    if (!script) return null

    const pref = this.data.preferences[scriptId] ?? {}
    const configByEnv = { ...(pref.configByEnv ?? {}) }
    configByEnv[envId] = { ...(configByEnv[envId] ?? {}), ...values }
    this.data.preferences[scriptId] = { ...pref, configByEnv }
    this.save()
    return this.applyPreference(script)
  }

  validateEnvForScript(script: ScriptMeta, env: Record<string, string>): string | null {
    return validateSchemaValues(script.envSchema, env, { subject: '环境变量', tab: '配置' })
  }

  /** 合并：schema 默认值 → 该环境下上次保存值 → 本次运行传入（优先级最高） */
  resolveParamsForScript(
    script: ScriptMeta,
    envId?: string,
    overrides?: Record<string, string>
  ): Record<string, string> {
    const resolvedEnvId = envId ?? script.defaultEnvId ?? this.getDefaultEnvironment().id
    const resolved: Record<string, string> = {}
    for (const def of script.paramSchema) {
      const defaultVal = defaultSchemaValue(def)
      if (defaultVal) resolved[def.key] = defaultVal
    }
    const saved = script.paramsByEnv?.[resolvedEnvId] ?? {}
    for (const [key, value] of Object.entries(saved)) {
      if (value !== undefined && value !== '') resolved[key] = value
    }
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) resolved[key] = value
      }
    }
    return resolved
  }

  setScriptParams(scriptId: string, envId: string, values: Record<string, string>): ScriptMeta | null {
    this.ensureInitialized()
    const script = this.data.scripts.find((s) => s.id === scriptId)
    if (!script) return null

    const pref = this.data.preferences[scriptId] ?? {}
    const paramsByEnv = { ...(pref.paramsByEnv ?? {}) }
    paramsByEnv[envId] = { ...values }
    this.data.preferences[scriptId] = { ...pref, paramsByEnv }
    this.save()
    return this.applyPreference(script)
  }

  validateParamsForScript(script: ScriptMeta, params: Record<string, string>): string | null {
    return validateSchemaValues(script.paramSchema, params, { subject: '运行参数', tab: '详情' })
  }

  addEnvironment(profile: Omit<EnvironmentProfile, 'id'>): EnvironmentProfile {
    this.ensureInitialized()
    const env: EnvironmentProfile = { ...profile, id: randomUUID() }
    if (env.isDefault) {
      this.data.environments = this.data.environments.map((e) => ({ ...e, isDefault: false }))
    }
    this.data.environments.push(env)
    this.save()
    return env
  }

  updateEnvironment(id: string, patch: Partial<EnvironmentProfile>): EnvironmentProfile | null {
    this.ensureInitialized()
    const index = this.data.environments.findIndex((e) => e.id === id)
    if (index === -1) return null
    if (patch.isDefault) {
      this.data.environments = this.data.environments.map((e) => ({ ...e, isDefault: e.id === id }))
    }
    this.data.environments[index] = { ...this.data.environments[index], ...patch }
    this.save()
    return this.data.environments[index]
  }

  deleteEnvironment(id: string): boolean {
    this.ensureInitialized()
    if (this.data.environments.length <= 1) return false
    const target = this.data.environments.find((e) => e.id === id)
    if (!target) return false
    this.data.environments = this.data.environments.filter((e) => e.id !== id)
    if (target.isDefault && this.data.environments.length) {
      this.data.environments[0].isDefault = true
    }
    this.save()
    return true
  }

  getConfig(): AppConfig {
    this.ensureInitialized()
    return this.data.config
  }

  setConfig(config: Partial<AppConfig>): AppConfig {
    this.ensureInitialized()
    this.data.config = {
      ...this.data.config,
      ...config,
      browser: { ...this.data.config.browser, ...config.browser },
      window: { ...this.data.config.window, ...config.window }
    }
    this.save()
    return this.data.config
  }

  getPreference(id: string): ScriptPreference {
    this.ensureInitialized()
    return this.data.preferences[id] ?? {}
  }

  setPreference(id: string, patch: ScriptPreference): void {
    this.ensureInitialized()
    this.data.preferences[id] = { ...this.data.preferences[id], ...patch }
    this.save()
  }

  getCategoryDefinitions(): CategoryDefinition[] {
    this.ensureInitialized()
    return mergeCategoryDefinitions(this.data.categories, this.data.categoryOverrides)
  }

  getStoredCategories(): StoredCategory[] {
    this.ensureInitialized()
    return [...this.data.categories]
  }

  addCategory(label: string, colorPreset: string): CategoryDefinition {
    this.ensureInitialized()
    const stored = createStoredCategory(label, colorPreset)
    this.data.categories.push(stored)
    this.save()
    return mergeCategoryDefinitions(this.data.categories, this.data.categoryOverrides).find(
      (c) => c.id === stored.id
    )!
  }

  updateCategory(
    id: string,
    patch: { label?: string; colorPreset?: string }
  ): CategoryDefinition | null {
    this.ensureInitialized()

    if (id.startsWith('builtin:')) {
      const key = id.slice('builtin:'.length)
      const index = this.data.categoryOverrides.findIndex((o) => o.key === key)
      const current = index >= 0 ? this.data.categoryOverrides[index] : { key }
      const next: CategoryOverride = {
        key,
        label: patch.label?.trim() || current.label,
        colorPreset: patch.colorPreset ?? current.colorPreset
      }
      if (index >= 0) this.data.categoryOverrides[index] = next
      else this.data.categoryOverrides.push(next)
      this.save()
      return mergeCategoryDefinitions(this.data.categories, this.data.categoryOverrides).find(
        (c) => c.id === id
      ) ?? null
    }

    const index = this.data.categories.findIndex((c) => c.id === id)
    if (index === -1) return null
    const current = this.data.categories[index]
    this.data.categories[index] = {
      ...current,
      label: patch.label?.trim() || current.label,
      colorPreset: patch.colorPreset ?? current.colorPreset
    }
    this.save()
    return mergeCategoryDefinitions(this.data.categories, this.data.categoryOverrides).find(
      (c) => c.id === id
    ) ?? null
  }

  deleteCategory(id: string): { ok: true; key: string } | { ok: false; error: string } {
    this.ensureInitialized()
    if (id.startsWith('builtin:')) {
      return { ok: false, error: '内置分类不可删除' }
    }
    const index = this.data.categories.findIndex((c) => c.id === id)
    if (index === -1) return { ok: false, error: '分类不存在' }
    const { key } = this.data.categories[index]
    this.data.categories.splice(index, 1)
    this.save()
    return { ok: true, key }
  }

  countScriptsByCategory(key: string): number {
    this.ensureInitialized()
    return this.data.scripts.filter((s) => s.category === key).length
  }
}

export const scriptStore = new ScriptStore()
