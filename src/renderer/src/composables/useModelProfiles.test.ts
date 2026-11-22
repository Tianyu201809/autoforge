import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope } from 'vue'
import type { LlmProfile, LlmProfileListResult, LlmProfileView, LlmProviderPreset, LlmTestResult } from '../../../shared/ai-types'
import { useModelProfiles } from './useModelProfiles'

function createHarness() {
  const profiles: LlmProfileView[] = []
  const calls: Array<{ method: string; value?: unknown }> = []
  const presets: LlmProviderPreset[] = [
    { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' }
  ]
  let activeProfileId: string | null = null
  let testResult: LlmTestResult = { ok: true, message: '连接成功', latencyMs: 18 }
  const listResult = (): LlmProfileListResult => ({ profiles: [...profiles], activeProfileId, credentialPersistent: true })
  const api = {
    listProfiles: async () => listResult(),
    listPresets: async () => presets,
    upsertProfile: async ({ profile }: { profile: Omit<LlmProfile, 'createdAt' | 'updatedAt'> }) => {
      calls.push({ method: 'upsertProfile', value: profile })
      const saved: LlmProfileView = { ...profile, createdAt: 'created', updatedAt: 'updated', hasApiKey: false, hasCredentials: false }
      const index = profiles.findIndex((item) => item.id === saved.id)
      if (index === -1) profiles.push(saved)
      else profiles[index] = saved
      activeProfileId ??= saved.id
      return saved
    },
    setCredentials: async (id: string, credentials: { apiKey?: string; extraHeaders: Record<string, string> }) => {
      calls.push({ method: 'setCredentials', value: credentials })
      const profile = profiles.find((item) => item.id === id)!
      profile.hasApiKey = Boolean(credentials.apiKey)
      profile.hasCredentials = Boolean(credentials.apiKey || Object.keys(credentials.extraHeaders).length)
      return profile
    },
    clearCredentials: async (id: string) => {
      const profile = profiles.find((item) => item.id === id)!
      profile.hasApiKey = false
      return profile
    },
    setActiveProfile: async (id: string) => { activeProfileId = id; return listResult() },
    deleteProfile: async (id: string) => { profiles.splice(profiles.findIndex((item) => item.id === id), 1); return true },
    testProfile: async () => testResult
  }
  return { api, calls, profiles, presets, setTestResult: (next: LlmTestResult) => { testResult = next } }
}

test('loads provider profiles and presets into the model settings state', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useModelProfiles(harness.api, () => 'profile-1'))!

  await state.load()

  assert.equal(state.presets.value[0]?.id, 'deepseek')
  assert.equal(state.profiles.value.length, 0)
  assert.equal(state.credentialPersistent.value, true)
  scope.stop()
})

test('clears the write-only API key draft after credentials are saved', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useModelProfiles(harness.api, () => 'profile-1'))!
  state.beginCreate()
  state.profileDraft.name = 'DeepSeek'
  state.profileDraft.provider = 'openai-compatible'
  state.profileDraft.baseUrl = 'https://api.deepseek.com/v1'
  state.profileDraft.model = 'deepseek-chat'
  state.profileDraft.presetId = 'deepseek'
  state.apiKeyDraft.value = 'secret-key'

  await state.saveProfile()

  assert.equal(state.apiKeyDraft.value, '')
  assert.equal(harness.calls.some((call) => call.method === 'setCredentials'), true)
  assert.equal(JSON.stringify(state.profiles.value).includes('secret-key'), false)
  scope.stop()
})

test('exposes the connection test result for the selected profile', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useModelProfiles(harness.api, () => 'profile-1'))!
  await state.load()
  state.beginCreate()
  state.profileDraft.name = 'Test model'
  state.profileDraft.provider = 'openai'
  state.profileDraft.baseUrl = 'https://api.openai.com/v1'
  state.profileDraft.model = 'gpt-4.1-mini'
  await state.saveProfile()

  harness.setTestResult({ ok: false, message: '模型连接失败，请检查配置后重试' })
  await state.testProfile(state.profiles.value[0]!.id)

  assert.equal(state.testResult.value?.ok, false)
  assert.equal(state.testingProfileId.value, null)
  scope.stop()
})

test('persists edits to an OpenAI-compatible endpoint and model ID', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useModelProfiles(harness.api, () => 'profile-1'))!
  state.beginCreate()
  state.profileDraft.name = 'Custom compatible'
  state.profileDraft.provider = 'openai-compatible'
  state.profileDraft.baseUrl = 'https://example.test/api/v1'
  state.profileDraft.model = 'custom-model-7b'

  await state.saveProfile()

  const savedProfile = harness.calls.find((call) => call.method === 'upsertProfile')?.value as LlmProfile
  assert.equal(savedProfile.baseUrl, 'https://example.test/api/v1')
  assert.equal(savedProfile.model, 'custom-model-7b')
  scope.stop()
})
