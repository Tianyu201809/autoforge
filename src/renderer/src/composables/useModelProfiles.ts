import { reactive, ref } from 'vue'
import type { LlmProfile, LlmProfileListResult, LlmProfileView, LlmProviderKind, LlmProviderPreset, LlmTestResult } from '../../../shared/ai-types'

type ModelProfileApi = Pick<Window['autoforge']['ai'],
  'listProfiles' | 'listPresets' | 'upsertProfile' | 'deleteProfile' | 'setActiveProfile' | 'setCredentials' | 'clearCredentials' | 'testProfile'>

interface HeaderDraft {
  name: string
  value: string
  existing: boolean
}

interface ProfileDraft {
  id: string
  name: string
  provider: LlmProviderKind
  baseUrl: string
  model: string
  timeoutSeconds: number
  presetId?: string
}

const EMPTY_DRAFT: ProfileDraft = {
  id: '', name: '', provider: 'openai-compatible', baseUrl: '', model: '', timeoutSeconds: 60
}

export function useModelProfiles(api: ModelProfileApi = window.autoforge.ai, createId: () => string = () => crypto.randomUUID()) {
  const profiles = ref<LlmProfileView[]>([])
  const presets = ref<LlmProviderPreset[]>([])
  const activeProfileId = ref<string | null>(null)
  const credentialPersistent = ref(true)
  const loading = ref(false)
  const saving = ref(false)
  const deletingProfileId = ref<string | null>(null)
  const testingProfileId = ref<string | null>(null)
  const testResult = ref<LlmTestResult | null>(null)
  const error = ref('')
  const editingProfileId = ref<string | null>(null)
  const apiKeyDraft = ref('')
  const headersDraft = ref<HeaderDraft[]>([])
  const profileDraft = reactive<ProfileDraft>({ ...EMPTY_DRAFT })

  function applyList(result: LlmProfileListResult): void {
    profiles.value = result.profiles
    activeProfileId.value = result.activeProfileId
    credentialPersistent.value = result.credentialPersistent
  }

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const [result, availablePresets] = await Promise.all([api.listProfiles(), api.listPresets()])
      applyList(result)
      presets.value = availablePresets
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法读取模型配置'
    } finally {
      loading.value = false
    }
  }

  function resetDraft(): void {
    Object.assign(profileDraft, EMPTY_DRAFT)
    editingProfileId.value = null
    apiKeyDraft.value = ''
    headersDraft.value = []
    testResult.value = null
  }

  function beginCreate(): void {
    resetDraft()
  }

  function beginEdit(profile: LlmProfileView): void {
    Object.assign(profileDraft, {
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      timeoutSeconds: profile.timeoutSeconds,
      presetId: profile.presetId
    })
    editingProfileId.value = profile.id
    apiKeyDraft.value = ''
    headersDraft.value = profile.extraHeaderNames.map((name) => ({ name, value: '', existing: true }))
    testResult.value = null
  }

  function addHeader(): void {
    headersDraft.value.push({ name: '', value: '', existing: false })
  }

  function removeHeader(index: number): void {
    if (headersDraft.value[index]?.existing) return
    headersDraft.value.splice(index, 1)
  }

  async function saveProfile(): Promise<void> {
    saving.value = true
    error.value = ''
    const headerValues = Object.fromEntries(headersDraft.value
      .filter((header) => header.name.trim() && header.value.trim())
      .map((header) => [header.name.trim(), header.value]))
    const profile: Omit<LlmProfile, 'createdAt' | 'updatedAt'> = {
      id: profileDraft.id || createId(),
      name: profileDraft.name.trim(),
      provider: profileDraft.provider,
      baseUrl: profileDraft.baseUrl.trim(),
      model: profileDraft.model.trim(),
      timeoutSeconds: Math.max(1, Math.min(600, Math.floor(profileDraft.timeoutSeconds || 60))),
      extraHeaderNames: Array.from(new Set(headersDraft.value.map((header) => header.name.trim()).filter(Boolean))),
      presetId: profileDraft.presetId || undefined
    }
    try {
      const saved = await api.upsertProfile({ profile })
      if (apiKeyDraft.value.trim() || Object.keys(headerValues).length > 0) {
        await api.setCredentials(saved.id, {
          apiKey: apiKeyDraft.value.trim() || undefined,
          extraHeaders: headerValues
        })
      }
      apiKeyDraft.value = ''
      await load()
      beginEdit(profiles.value.find((item) => item.id === saved.id) ?? saved)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法保存模型配置'
    } finally {
      saving.value = false
    }
  }

  async function setActive(id: string): Promise<void> {
    try {
      applyList(await api.setActiveProfile(id))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法切换模型'
    }
  }

  async function clearCredentials(id: string): Promise<void> {
    try {
      await api.clearCredentials(id)
      await load()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法清除模型密钥'
    }
  }

  async function deleteProfile(id: string): Promise<void> {
    deletingProfileId.value = id
    try {
      await api.deleteProfile(id)
      await load()
      if (editingProfileId.value === id) resetDraft()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法删除模型配置'
    } finally {
      deletingProfileId.value = null
    }
  }

  async function testProfile(id: string): Promise<void> {
    testingProfileId.value = id
    testResult.value = null
    try {
      testResult.value = await api.testProfile(id)
    } catch (cause) {
      testResult.value = { ok: false, message: cause instanceof Error ? cause.message : '连接测试失败' }
    } finally {
      testingProfileId.value = null
    }
  }

  return {
    profiles, presets, activeProfileId, credentialPersistent, loading, saving, deletingProfileId,
    testingProfileId, testResult, error, editingProfileId, apiKeyDraft, headersDraft, profileDraft,
    load, beginCreate, beginEdit, addHeader, removeHeader, saveProfile, setActive, clearCredentials,
    deleteProfile, testProfile
  }
}
