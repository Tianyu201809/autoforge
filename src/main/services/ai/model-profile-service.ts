import type {
  LlmProfile,
  LlmProfileListResult,
  LlmProfileView,
  LlmProviderKind,
  LlmTestResult
} from '../../../shared/ai-types'
import {
  normalizeLlmProfile,
  toLlmProfileView,
  type ModelCredentials,
  type LlmProviderAdapter,
  type LlmProfileInput
} from './provider-contract'
import { LlmProviderError } from './provider-contract'

export interface ModelProfileState {
  profiles: LlmProfile[]
  activeProfileId?: string
}

export interface ModelCredentialStore {
  get(profileId: string): ModelCredentials | null
  set(profileId: string, credentials: ModelCredentials): void
  delete(profileId: string): void
  isPersistent(): boolean
}

export interface ModelProfileServiceOptions {
  load(): ModelProfileState
  save(state: ModelProfileState): void
  credentials: ModelCredentialStore
  providers: Record<LlmProviderKind, LlmProviderAdapter>
  now?: () => string
}

export interface ResolvedModelProvider {
  profile: LlmProfile
  credentials: ModelCredentials
  adapter: LlmProviderAdapter
}

export function createModelProfileService(options: ModelProfileServiceOptions) {
  const now = options.now ?? (() => new Date().toISOString())

  function load(): ModelProfileState {
    const state = options.load()
    return {
      profiles: Array.isArray(state.profiles) ? state.profiles : [],
      activeProfileId: state.activeProfileId
    }
  }

  function listProfiles(): LlmProfileListResult {
    const state = load()
    const profiles = state.profiles.map((profile) => toLlmProfileView(profile, options.credentials.get(profile.id) ?? undefined))
    const activeProfileId = profiles.some((profile) => profile.id === state.activeProfileId)
      ? state.activeProfileId!
      : profiles[0]?.id ?? null
    return { profiles, activeProfileId, credentialPersistent: options.credentials.isPersistent() }
  }

  function upsertProfile(input: { profile: LlmProfileInput }): LlmProfileView {
    const state = load()
    const previous = state.profiles.find((profile) => profile.id === input.profile.id)
    const profile = normalizeLlmProfile(input.profile, now(), previous)
    const profiles = previous
      ? state.profiles.map((item) => item.id === profile.id ? profile : item)
      : [...state.profiles, profile]
    options.save({ ...state, profiles, activeProfileId: state.activeProfileId ?? profile.id })
    return toLlmProfileView(profile, options.credentials.get(profile.id) ?? undefined)
  }

  function deleteProfile(id: string): boolean {
    const state = load()
    const profiles = state.profiles.filter((profile) => profile.id !== id)
    if (profiles.length === state.profiles.length) return false
    options.credentials.delete(id)
    options.save({
      profiles,
      activeProfileId: state.activeProfileId === id ? profiles[0]?.id : state.activeProfileId
    })
    return true
  }

  function setActiveProfile(id: string): LlmProfileListResult {
    const state = load()
    if (!state.profiles.some((profile) => profile.id === id)) {
      throw new LlmProviderError('模型配置不存在', 'config', false)
    }
    options.save({ ...state, activeProfileId: id })
    return listProfiles()
  }

  function setCredentials(profileId: string, credentials: ModelCredentials): LlmProfileView {
    const profile = load().profiles.find((item) => item.id === profileId)
    if (!profile) throw new LlmProviderError('模型配置不存在', 'config', false)
    const existing = options.credentials.get(profileId)
    options.credentials.set(profileId, {
      apiKey: credentials.apiKey ?? existing?.apiKey,
      extraHeaders: { ...existing?.extraHeaders, ...credentials.extraHeaders }
    })
    return toLlmProfileView(profile, options.credentials.get(profileId) ?? undefined)
  }

  function clearCredentials(profileId: string): LlmProfileView {
    const profile = load().profiles.find((item) => item.id === profileId)
    if (!profile) throw new LlmProviderError('模型配置不存在', 'config', false)
    options.credentials.delete(profileId)
    return toLlmProfileView(profile)
  }

  function resolveProvider(profileId: string): ResolvedModelProvider {
    const profile = load().profiles.find((item) => item.id === profileId)
    if (!profile) throw new LlmProviderError('模型配置不存在', 'config', false)
    const credentials = options.credentials.get(profileId)
    if (!credentials || (!credentials.apiKey && Object.keys(credentials.extraHeaders).length === 0)) {
      throw new LlmProviderError('请先配置模型凭据', 'config', false)
    }
    const adapter = options.providers[profile.provider]
    if (!adapter) throw new LlmProviderError('模型供应商不可用', 'config', false)
    return { profile, credentials, adapter }
  }

  async function testProfile(profileId: string): Promise<LlmTestResult> {
    const resolved = resolveProvider(profileId)
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), resolved.profile.timeoutSeconds * 1000)
    try {
      let completed = false
      for await (const event of resolved.adapter.stream({
        ...resolved,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        tools: [],
        signal: controller.signal
      })) {
        if (event.type === 'complete') completed = true
      }
      if (!completed) return { ok: false, message: '模型未完成连接测试' }
      return { ok: true, message: '连接成功', latencyMs: Date.now() - startedAt }
    } catch (error) {
      const message = error instanceof LlmProviderError && error.code === 'timeout'
        ? '模型连接超时'
        : '模型连接失败，请检查配置后重试'
      return { ok: false, message, latencyMs: Date.now() - startedAt }
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    listProfiles,
    upsertProfile,
    deleteProfile,
    setActiveProfile,
    setCredentials,
    clearCredentials,
    resolveProvider,
    testProfile
  }
}
