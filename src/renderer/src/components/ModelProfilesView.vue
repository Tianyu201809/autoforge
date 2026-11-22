<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { ref } from 'vue'
import { Check, CircleAlert, CircleCheck, LoaderCircle, Plus, Save, Trash2, X } from 'lucide-vue-next'
import { useModelProfiles } from '../composables/useModelProfiles'

const props = defineProps<{ active: boolean }>()
const state = useModelProfiles()
const formOpen = ref(false)

const providers = [
  { id: 'openai-compatible', name: 'OpenAI 兼容' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'gemini', name: 'Gemini' }
] as const

const headerRows = () => state.headersDraft.value

function applyPreset(id: string): void {
  const preset = state.presets.value.find((item) => item.id === id)
  state.profileDraft.presetId = id || undefined
  if (preset) {
    state.profileDraft.provider = 'openai-compatible'
    state.profileDraft.baseUrl = preset.baseUrl
    state.profileDraft.model = preset.defaultModel
    if (!state.profileDraft.name.trim()) state.profileDraft.name = preset.label
  }
}

function startNewProfile(): void {
  state.beginCreate()
  state.addHeader()
  formOpen.value = true
}

function editProfile(profile: typeof state.profiles.value[number]): void {
  state.beginEdit(profile)
  formOpen.value = true
}

function closeForm(): void {
  state.beginCreate()
  formOpen.value = false
}

function handleRemoveHeader(index: number): void {
  state.removeHeader(index)
}

onMounted(() => {
  if (props.active) void state.load()
})
watch(() => props.active, (active) => {
  if (active && !state.profiles.value.length) void state.load()
})
</script>

<template>
  <section class="model-profiles">
    <header class="model-profiles-header">
      <div>
        <h2>模型</h2>
        <p>管理提供商、模型和连接凭据。</p>
      </div>
      <button type="button" class="model-primary-button" @click="startNewProfile">
        <Plus :size="15" /> 新建配置
      </button>
    </header>

    <p v-if="!state.credentialPersistent.value" class="model-notice">
      <CircleAlert :size="16" /> 系统安全存储不可用，模型凭据仅保存在当前会话。
    </p>
    <p v-if="state.error.value" class="model-error" role="alert">{{ state.error.value }}</p>

    <div class="model-profile-layout">
      <div class="model-profile-list" aria-label="模型配置列表">
        <p v-if="state.loading.value" class="model-muted">正在读取配置…</p>
        <p v-else-if="!state.profiles.value.length" class="model-muted">尚无模型配置</p>
        <article
          v-for="profile in state.profiles.value"
          :key="profile.id"
          class="model-profile-row"
          :class="{ 'model-profile-row--active': state.editingProfileId.value === profile.id }"
        >
          <button type="button" class="model-profile-select" @click="editProfile(profile)">
            <span class="model-profile-name">{{ profile.name }}</span>
            <span class="model-muted">{{ profile.model }}</span>
            <span v-if="profile.hasCredentials" class="model-key-state"><Check :size="12" />{{ profile.hasApiKey ? '已配置密钥' : '已配置请求头' }}</span>
          </button>
          <div class="model-profile-actions">
            <button
              type="button"
              :aria-label="state.activeProfileId.value === profile.id ? '当前活动模型' : `设为活动模型 ${profile.name}`"
              :title="state.activeProfileId.value === profile.id ? '当前活动模型' : '设为活动模型'"
              :disabled="state.activeProfileId.value === profile.id"
              @click="state.setActive(profile.id)"
            >
              <CircleCheck v-if="state.activeProfileId.value === profile.id" :size="16" />
              <span v-else class="model-active-empty" />
            </button>
            <button type="button" :aria-label="`删除 ${profile.name}`" @click="state.deleteProfile(profile.id)">
              <Trash2 :size="15" />
            </button>
          </div>
        </article>
      </div>

      <form v-if="formOpen || !state.profiles.value.length" class="model-profile-form" @submit.prevent="state.saveProfile()">
        <template>
          <div class="model-form-heading">
            <h3>{{ state.editingProfileId.value ? '编辑配置' : '新建配置' }}</h3>
            <button type="button" aria-label="关闭编辑" title="关闭编辑" @click="closeForm()">
              <X :size="16" />
            </button>
          </div>

          <label>配置名称<input v-model="state.profileDraft.name" required maxlength="80" placeholder="例如：DeepSeek 工作模型"></label>
          <label>提供商
            <select v-model="state.profileDraft.provider" @change="state.profileDraft.presetId = undefined">
              <option v-for="provider in providers" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
            </select>
          </label>
          <label v-if="state.profileDraft.provider === 'openai-compatible'">兼容服务
            <select :value="state.profileDraft.presetId ?? ''" @change="applyPreset(($event.target as HTMLSelectElement).value)">
              <option value="">自定义服务</option>
              <option v-for="preset in state.presets.value" :key="preset.id" :value="preset.id">{{ preset.label }}</option>
            </select>
          </label>
          <label>API 地址<input v-model="state.profileDraft.baseUrl" required type="url" placeholder="https://api.example.com/v1"></label>
          <label>模型 ID<input v-model="state.profileDraft.model" required placeholder="模型名称"></label>
          <label>请求超时（秒）<input v-model.number="state.profileDraft.timeoutSeconds" type="number" min="1" max="600"></label>

          <label>API 密钥
            <input
              v-model="state.apiKeyDraft.value"
              type="password"
              autocomplete="new-password"
              placeholder="保存后不会再次显示"
            >
          </label>
          <div class="model-header-section">
            <div class="model-header-heading">
              <span>额外请求头</span>
              <button type="button" class="model-text-button" @click="state.addHeader()">添加请求头</button>
            </div>
            <div v-for="(header, index) in headerRows()" :key="index" class="model-header-row">
              <input v-model="header.name" aria-label="请求头名称" :readonly="header.existing" placeholder="X-Workspace">
              <input v-model="header.value" aria-label="请求头值" type="password" autocomplete="new-password" placeholder="仅写入，不会读取">
              <button type="button" :disabled="header.existing" :aria-label="`移除请求头 ${header.name || index + 1}`" @click="handleRemoveHeader(index)">
                <X :size="14" />
              </button>
            </div>
          </div>

          <div v-if="state.testResult.value" class="model-test-result" :class="state.testResult.value.ok ? 'is-success' : 'is-error'" role="status">
            <CircleCheck v-if="state.testResult.value.ok" :size="15" />
            <CircleAlert v-else :size="15" />
            <span>{{ state.testResult.value.message }}</span>
            <span v-if="state.testResult.value.latencyMs !== undefined">{{ state.testResult.value.latencyMs }} ms</span>
          </div>

          <div class="model-form-actions">
            <button
              v-if="state.editingProfileId.value && state.profiles.value.find((profile) => profile.id === state.editingProfileId.value)?.hasCredentials"
              type="button"
              class="model-secondary-button"
              @click="state.clearCredentials(state.editingProfileId.value!)"
            >清除密钥</button>
            <button
              v-if="state.editingProfileId.value"
              type="button"
              class="model-secondary-button"
              :disabled="state.testingProfileId.value === state.editingProfileId.value"
              @click="state.testProfile(state.editingProfileId.value!)"
            >
              <LoaderCircle v-if="state.testingProfileId.value === state.editingProfileId.value" class="model-spin" :size="14" />
              测试连接
            </button>
            <button type="submit" class="model-primary-button" :disabled="state.saving.value">
              <LoaderCircle v-if="state.saving.value" class="model-spin" :size="14" />
              <Save v-else :size="14" /> 保存
            </button>
          </div>
        </template>
      </form>
      <div v-else class="model-form-empty">选择一个模型配置，或新建配置。</div>
    </div>
  </section>
</template>

<style scoped>
.model-profiles { display: flex; flex-direction: column; gap: 16px; color: var(--sb-text-primary); }
.model-profiles-header, .model-form-heading, .model-header-heading, .model-form-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.model-profiles-header h2 { margin: 0; font-size: 18px; font-weight: 600; }
.model-profiles-header p, .model-muted { margin: 4px 0 0; color: var(--sb-text-muted); font-size: 12px; }
.model-profile-layout { display: grid; grid-template-columns: minmax(190px, 0.8fr) minmax(300px, 1.2fr); gap: 20px; align-items: start; }
.model-profile-list { display: grid; gap: 4px; min-width: 0; }
.model-profile-row { display: flex; min-width: 0; align-items: center; gap: 6px; padding: 8px; border: 1px solid transparent; border-radius: 6px; }
.model-profile-row--active { border-color: var(--sb-border-subtle); background: var(--sb-bg-panel); }
.model-profile-select { display: grid; flex: 1; min-width: 0; gap: 3px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.model-profile-name { overflow: hidden; font-size: 13px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.model-key-state { display: flex; align-items: center; gap: 3px; color: var(--sb-text-muted); font-size: 11px; }
.model-profile-actions { display: flex; align-items: center; gap: 4px; }
.model-profile-actions button, .model-form-heading button, .model-header-row button { display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 5px; background: transparent; color: var(--sb-text-muted); cursor: pointer; }
.model-profile-actions button:hover, .model-form-heading button:hover, .model-header-row button:hover { background: var(--sb-bg-hover); color: var(--sb-text-primary); }
.model-profile-actions button:disabled { color: var(--sb-accent-solid); cursor: default; }
.model-active-empty { width: 13px; height: 13px; border: 1px solid var(--sb-border-subtle); border-radius: 50%; }
.model-profile-form { display: grid; min-width: 0; gap: 12px; padding: 14px; border: 1px solid var(--sb-border-subtle); border-radius: 7px; background: var(--sb-bg-panel); }
.model-form-heading h3 { margin: 0; font-size: 14px; font-weight: 600; }
.model-profile-form > label { display: grid; gap: 5px; color: var(--sb-text-muted); font-size: 12px; }
.model-profile-form input, .model-profile-form select { width: 100%; min-width: 0; height: 34px; padding: 0 9px; border: 1px solid var(--sb-border-subtle); border-radius: 5px; background: var(--sb-bg-base); color: var(--sb-text-primary); font: inherit; font-size: 12px; }
.model-profile-form input:focus-visible, .model-profile-form select:focus-visible { outline: 2px solid var(--sb-ring); outline-offset: 1px; }
.model-header-section { display: grid; gap: 8px; }
.model-header-heading { color: var(--sb-text-muted); font-size: 12px; }
.model-text-button { padding: 3px 0; border: 0; background: none; color: var(--sb-accent-solid); font: inherit; cursor: pointer; }
.model-header-row { display: grid; grid-template-columns: minmax(90px, 1fr) minmax(100px, 1fr) 28px; gap: 6px; }
.model-header-row button:disabled { opacity: 0.45; cursor: default; }
.model-primary-button, .model-secondary-button { display: inline-flex; min-height: 32px; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; border: 1px solid var(--sb-border-subtle); border-radius: 5px; background: var(--sb-bg-elevated); color: var(--sb-text-primary); font: inherit; font-size: 12px; cursor: pointer; }
.model-primary-button { border-color: var(--sb-accent-solid); background: var(--sb-accent-solid); color: var(--sb-accent-contrast, white); }
.model-primary-button:disabled, .model-secondary-button:disabled { opacity: 0.55; cursor: wait; }
.model-form-actions { justify-content: flex-end; flex-wrap: wrap; margin-top: 2px; }
.model-notice, .model-error, .model-test-result { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.model-notice { margin: 0; color: var(--sb-text-muted); }
.model-error, .is-error { color: var(--sb-danger, #d65d5d); }
.model-test-result { min-width: 0; padding: 8px 9px; border-radius: 5px; background: var(--sb-bg-base); }
.model-test-result span:nth-child(2) { flex: 1; }
.is-success { color: var(--sb-success, #2d9864); }
.model-form-empty { padding: 24px 12px; color: var(--sb-text-muted); font-size: 13px; }
.model-spin { animation: model-spin 1s linear infinite; }
@keyframes model-spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) { .model-profile-layout { grid-template-columns: minmax(0, 1fr); } .model-profile-list { max-height: 180px; overflow: auto; } }
@media (prefers-reduced-motion: reduce) { .model-spin { animation-duration: 2s; } }
</style>
