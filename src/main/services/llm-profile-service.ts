import { net } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  LlmProfile,
  LlmProfileListResult,
  LlmProfileView,
  LlmTestResult,
  LlmUpsertProfileInput
} from '../../shared/llm-types'
import { DEFAULT_LLM_MAX_OUTPUT_TOKENS, DEFAULT_LLM_TIMEOUT_SECONDS } from '../../shared/llm-types'
import { scriptStore } from './script-store'
import { createLlmClient } from './llm-client'
import { createLlmCredentialStore, type LlmCredentialStore } from './llm-credential-store'

export class LlmProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmProfileError'
  }
}

export interface LlmProfileService {
  list: () => LlmProfileListResult
  upsert: (input: LlmUpsertProfileInput) => LlmProfileView
  remove: (profileId: string) => boolean
  setActive: (profileId: string | null) => LlmProfileListResult
  setAllowBuild: (value: boolean) => LlmProfileListResult
  resolve: (profileId?: string) => { profile: LlmProfile; apiKey: string }
  test: (profileId: string) => Promise<LlmTestResult>
}

function readProfiles(): LlmProfile[] {
  const raw = scriptStore.getConfig().llm?.profiles
  return Array.isArray(raw) ? raw.filter((item): item is LlmProfile => Boolean(item?.id)) : []
}

function normalizeProfile(input: LlmUpsertProfileInput['profile']): LlmProfile {
  const now = new Date().toISOString()
  const name = input.name?.trim()
  if (!name) throw new LlmProfileError('请填写配置名称')
  const baseUrl = input.baseUrl?.trim()
  if (!baseUrl) throw new LlmProfileError('请填写接口地址')
  if (!/^https?:\/\//i.test(baseUrl)) throw new LlmProfileError('接口地址必须以 http:// 或 https:// 开头')
  const model = input.model?.trim()
  if (!model) throw new LlmProfileError('请填写模型名称')

  return {
    id: input.id?.trim() || randomUUID(),
    name,
    kind: 'openai-compatible',
    baseUrl,
    model,
    temperature: typeof input.temperature === 'number' ? input.temperature : 0.2,
    maxOutputTokens:
      typeof input.maxOutputTokens === 'number' && input.maxOutputTokens > 0
        ? Math.floor(input.maxOutputTokens)
        : DEFAULT_LLM_MAX_OUTPUT_TOKENS,
    timeoutSeconds:
      typeof input.timeoutSeconds === 'number' && input.timeoutSeconds > 0
        ? Math.floor(input.timeoutSeconds)
        : DEFAULT_LLM_TIMEOUT_SECONDS,
    extraHeaders: input.extraHeaders?.trim() || undefined,
    createdAt: input.createdAt ?? now,
    updatedAt: now
  }
}

export function createLlmProfileService(deps?: { credentials?: LlmCredentialStore }): LlmProfileService {
  const credentials = deps?.credentials ?? createLlmCredentialStore()
  const client = createLlmClient({ request: (url, init) => net.fetch(url, init) })

  function list(): LlmProfileListResult {
    const profiles = readProfiles()
    const activeProfileId = scriptStore.getConfig().llm?.activeProfileId ?? null
    return {
      profiles: profiles.map((profile) => ({ ...profile, hasApiKey: credentials.has(profile.id) })),
      activeProfileId: profiles.some((profile) => profile.id === activeProfileId)
        ? activeProfileId
        : (profiles[0]?.id ?? null),
      credentialPersistent: credentials.isPersistent(),
      allowBuild: scriptStore.getConfig().llm?.allowBuild === true
    }
  }

  function writeProfiles(profiles: LlmProfile[], activeProfileId?: string | null): void {
    const current = scriptStore.getConfig().llm ?? {}
    const nextActive =
      activeProfileId !== undefined
        ? activeProfileId
        : profiles.some((profile) => profile.id === current.activeProfileId)
          ? current.activeProfileId
          : (profiles[0]?.id ?? null)
    scriptStore.setConfig({
      llm: {
        ...current,
        profiles,
        activeProfileId: nextActive ?? undefined
      }
    })
  }

  return {
    list,

    upsert(input: LlmUpsertProfileInput): LlmProfileView {
      const profile = normalizeProfile(input.profile)
      const profiles = readProfiles()
      const index = profiles.findIndex((item) => item.id === profile.id)
      if (index >= 0) {
        profiles[index] = { ...profile, createdAt: profiles[index].createdAt }
      } else {
        profiles.push(profile)
      }
      writeProfiles(profiles, index >= 0 ? undefined : profile.id)

      if (input.apiKey !== undefined) {
        const key = input.apiKey.trim()
        if (key) credentials.save(profile.id, key)
        else credentials.clear(profile.id)
      }

      return { ...profile, hasApiKey: credentials.has(profile.id) }
    },

    remove(profileId: string): boolean {
      const profiles = readProfiles()
      const next = profiles.filter((profile) => profile.id !== profileId)
      if (next.length === profiles.length) return false
      credentials.clear(profileId)
      writeProfiles(next)
      return true
    },

    setActive(profileId: string | null): LlmProfileListResult {
      writeProfiles(readProfiles(), profileId)
      return list()
    },

    setAllowBuild(value: boolean): LlmProfileListResult {
      const current = scriptStore.getConfig().llm ?? {}
      scriptStore.setConfig({ llm: { ...current, allowBuild: value === true } })
      return list()
    },

    resolve(profileId?: string): { profile: LlmProfile; apiKey: string } {
      const profiles = readProfiles()
      if (profiles.length === 0) throw new LlmProfileError('还没有配置任何 LLM，请先在设置 → 模型 中添加')

      const targetId = profileId?.trim() || scriptStore.getConfig().llm?.activeProfileId || ''
      const profile = profiles.find((item) => item.id === targetId) ?? profiles[0]
      const apiKey = credentials.load(profile.id)
      if (!apiKey) throw new LlmProfileError(`配置「${profile.name}」还没有填写 API Key`)

      return { profile, apiKey }
    },

    async test(profileId: string): Promise<LlmTestResult> {
      const profiles = readProfiles()
      const profile = profiles.find((item) => item.id === profileId)
      if (!profile) return { ok: false, message: '配置不存在' }
      const apiKey = credentials.load(profile.id)
      if (!apiKey) return { ok: false, message: '该配置还没有填写 API Key' }
      return client.testConnection(profile, apiKey)
    }
  }
}

let instance: LlmProfileService | null = null

export function getLlmProfileService(): LlmProfileService {
  if (!instance) instance = createLlmProfileService()
  return instance
}
