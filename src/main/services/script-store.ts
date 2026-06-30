import { randomUUID } from 'crypto'
import { defaultSchemaValue } from '../../shared/schema-values'
import { validateSchemaValues } from '../../shared/schema-validation'
import type {
  AppConfig,
  CategoryDefinition,
  EnvironmentProfile,
  ScriptMeta,
  ScriptPreference
} from '../../shared/types/script'
import {
  createStoredCategory,
  mergeCategoryDefinitions,
  type CategoryOverride,
  type StoredCategory
} from './category-service'
import { getDb } from '../db/database'
import { createRepositories, type Repositories } from '../db/repositories'

export type { ScriptPreference } from '../../shared/types/script'

export class ScriptStore {
  private repos: Repositories | null = null

  private ensureInitialized(): Repositories {
    if (this.repos) return this.repos
    this.repos = createRepositories(getDb())
    return this.repos
  }

  getScripts(): ScriptMeta[] {
    const repos = this.ensureInitialized()
    return repos.scripts.listAll().map((s) => this.applyPreference(s))
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
    const repos = this.ensureInitialized()
    const pref = repos.scripts.getPreference(script.id)
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
    const repos = this.ensureInitialized()
    repos.scripts.insert(meta)
    const script = repos.scripts.getById(meta.id)!
    return this.applyPreference(script)
  }

  updateScript(id: string, patch: Partial<ScriptMeta>): ScriptMeta | null {
    const repos = this.ensureInitialized()
    const ok = repos.scripts.updateMeta(id, patch)
    if (!ok) return null
    const script = repos.scripts.getById(id)
    return script ? this.applyPreference(script) : null
  }

  deleteScript(id: string): boolean {
    const repos = this.ensureInitialized()
    return repos.scripts.delete(id)
  }

  getScriptById(id: string): ScriptMeta | undefined {
    const repos = this.ensureInitialized()
    const script = repos.scripts.getById(id)
    return script ? this.applyPreference(script) : undefined
  }

  getEnvironments(): EnvironmentProfile[] {
    return this.ensureInitialized().environments.listAll()
  }

  getEnvironment(id: string): EnvironmentProfile | undefined {
    return this.ensureInitialized().environments.getById(id)
  }

  getDefaultEnvironment(): EnvironmentProfile {
    return this.ensureInitialized().environments.getDefault()
  }

  resolveEnvForScript(script: ScriptMeta, envId?: string): Record<string, string> {
    const resolvedEnvId = envId ?? script.defaultEnvId ?? this.getDefaultEnvironment().id
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

  setScriptEnvConfig(scriptId: string, envId: string, values: Record<string, string>): ScriptMeta | null {
    const repos = this.ensureInitialized()
    const script = repos.scripts.getById(scriptId)
    if (!script) return null

    const pref = repos.scripts.getPreference(scriptId)
    const configByEnv = { ...(pref.configByEnv ?? {}) }
    configByEnv[envId] = { ...(configByEnv[envId] ?? {}), ...values }
    repos.scripts.mergePreference(scriptId, { configByEnv })
    return this.applyPreference(script)
  }

  validateEnvForScript(script: ScriptMeta, env: Record<string, string>): string | null {
    return validateSchemaValues(script.envSchema, env, { subject: '环境变量', tab: '配置' })
  }

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
    const repos = this.ensureInitialized()
    const script = repos.scripts.getById(scriptId)
    if (!script) return null

    const pref = repos.scripts.getPreference(scriptId)
    const paramsByEnv = { ...(pref.paramsByEnv ?? {}) }
    paramsByEnv[envId] = { ...values }
    repos.scripts.mergePreference(scriptId, { paramsByEnv })
    return this.applyPreference(script)
  }

  validateParamsForScript(script: ScriptMeta, params: Record<string, string>): string | null {
    return validateSchemaValues(script.paramSchema, params, { subject: '运行参数', tab: '详情' })
  }

  addEnvironment(profile: Omit<EnvironmentProfile, 'id'>): EnvironmentProfile {
    const repos = this.ensureInitialized()
    const env: EnvironmentProfile = { ...profile, id: randomUUID() }
    if (env.isDefault) {
      for (const e of repos.environments.listAll()) {
        if (e.isDefault) repos.environments.update(e.id, { isDefault: false })
      }
    }
    repos.environments.insert(env)
    return env
  }

  updateEnvironment(id: string, patch: Partial<EnvironmentProfile>): EnvironmentProfile | null {
    return this.ensureInitialized().environments.update(id, patch)
  }

  deleteEnvironment(id: string): boolean {
    return this.ensureInitialized().environments.delete(id)
  }

  getConfig(): AppConfig {
    return this.ensureInitialized().config.getConfig()
  }

  setConfig(config: Partial<AppConfig>): AppConfig {
    return this.ensureInitialized().config.setConfig(config)
  }

  getPreference(id: string): ScriptPreference {
    return this.ensureInitialized().scripts.getPreference(id)
  }

  setPreference(id: string, patch: ScriptPreference): void {
    this.ensureInitialized().scripts.mergePreference(id, patch)
  }

  getCategoryDefinitions(): CategoryDefinition[] {
    const repos = this.ensureInitialized()
    return mergeCategoryDefinitions(repos.categories.listCategories(), repos.categories.listOverrides())
  }

  getStoredCategories(): StoredCategory[] {
    return this.ensureInitialized().categories.listCategories()
  }

  addCategory(label: string, colorPreset: string): CategoryDefinition {
    const repos = this.ensureInitialized()
    const stored = createStoredCategory(label, colorPreset)
    repos.categories.insertCategory(stored)
    return mergeCategoryDefinitions(repos.categories.listCategories(), repos.categories.listOverrides()).find(
      (c) => c.id === stored.id
    )!
  }

  updateCategory(id: string, patch: { label?: string; colorPreset?: string }): CategoryDefinition | null {
    const repos = this.ensureInitialized()

    if (id.startsWith('builtin:')) {
      const key = id.slice('builtin:'.length)
      const overrides = repos.categories.listOverrides()
      const index = overrides.findIndex((o) => o.key === key)
      const current = index >= 0 ? overrides[index] : { key }
      const next: CategoryOverride = {
        key,
        label: patch.label?.trim() || current.label,
        colorPreset: patch.colorPreset ?? current.colorPreset
      }
      repos.categories.upsertOverride(next)
      return mergeCategoryDefinitions(repos.categories.listCategories(), repos.categories.listOverrides()).find(
        (c) => c.id === id
      ) ?? null
    }

    const updated = repos.categories.updateCategory(id, patch)
    if (!updated) return null
    return mergeCategoryDefinitions(repos.categories.listCategories(), repos.categories.listOverrides()).find(
      (c) => c.id === id
    ) ?? null
  }

  deleteCategory(id: string): { ok: true; key: string } | { ok: false; error: string } {
    const repos = this.ensureInitialized()
    if (id.startsWith('builtin:')) {
      return { ok: false, error: '内置分类不可删除' }
    }
    const removed = repos.categories.deleteCategory(id)
    if (!removed) return { ok: false, error: '分类不存在' }
    return { ok: true, key: removed.key }
  }

  countScriptsByCategory(key: string): number {
    return this.ensureInitialized().scripts.countByCategory(key)
  }
}

export const scriptStore = new ScriptStore()
