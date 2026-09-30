<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Star,
  Trash2,
  XCircle
} from 'lucide-vue-next'
import type { LlmProfileListResult, LlmTestResult } from '../../../shared/llm-types'
import { DEFAULT_LLM_MAX_OUTPUT_TOKENS, DEFAULT_LLM_TIMEOUT_SECONDS } from '../../../shared/llm-types'
import { askConfirm } from '../composables/useConfirmDialog'
import { useToast } from '../composables/useToast'

const { pushToast } = useToast()

interface ProfileDraft {
  id: string
  name: string
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxOutputTokens: number
  timeoutSeconds: number
  extraHeaders: string
  keyAlreadySet: boolean
  clearKey: boolean
  isNew: boolean
}

const PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
  { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
]

const state = ref<LlmProfileListResult | null>(null)
const loading = ref(false)
const saving = ref(false)
const draft = ref<ProfileDraft | null>(null)
const testingId = ref<string | null>(null)
const testResults = ref<Record<string, LlmTestResult>>({})
const showAdvanced = ref(false)

function emptyDraft(): ProfileDraft {
  return {
    id: '',
    name: '',
    baseUrl: '',
    model: '',
    apiKey: '',
    temperature: 0.2,
    maxOutputTokens: DEFAULT_LLM_MAX_OUTPUT_TOKENS,
    timeoutSeconds: DEFAULT_LLM_TIMEOUT_SECONDS,
    extraHeaders: '',
    keyAlreadySet: false,
    clearKey: false,
    isNew: true
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    state.value = await window.autoforge.llm.listProfiles()
  } catch (error) {
    pushToast({
      type: 'error',
      title: '读取失败',
      message: error instanceof Error ? error.message : '无法读取模型配置'
    })
  } finally {
    loading.value = false
  }
}

function startCreate(): void {
  draft.value = emptyDraft()
  showAdvanced.value = false
}

function startEdit(profileId: string): void {
  const profile = state.value?.profiles.find((item) => item.id === profileId)
  if (!profile) return
  draft.value = {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: '',
    temperature: profile.temperature ?? 0.2,
    maxOutputTokens: profile.maxOutputTokens ?? DEFAULT_LLM_MAX_OUTPUT_TOKENS,
    timeoutSeconds: profile.timeoutSeconds ?? DEFAULT_LLM_TIMEOUT_SECONDS,
    extraHeaders: profile.extraHeaders ?? '',
    keyAlreadySet: profile.hasApiKey,
    clearKey: false,
    isNew: false
  }
  showAdvanced.value = Boolean(profile.extraHeaders)
}

function applyPreset(preset: (typeof PRESETS)[number]): void {
  if (!draft.value) return
  draft.value.baseUrl = preset.baseUrl
  draft.value.model = preset.model
  if (!draft.value.name.trim()) draft.value.name = preset.label
}

function cancelEdit(): void {
  draft.value = null
}

async function save(): Promise<void> {
  const current = draft.value
  if (!current || saving.value) return
  if (!current.name.trim()) {
    pushToast({ type: 'error', title: '无法保存', message: '请填写配置名称' })
    return
  }
  if (!current.baseUrl.trim() || !current.model.trim()) {
    pushToast({ type: 'error', title: '无法保存', message: '请填写接口地址与模型名称' })
    return
  }
  if (current.isNew && !current.apiKey.trim()) {
    pushToast({ type: 'error', title: '无法保存', message: '新建配置需要填写 API Key' })
    return
  }

  saving.value = true
  try {
    const apiKey = current.clearKey ? '' : current.apiKey.trim() ? current.apiKey.trim() : undefined
    await window.autoforge.llm.upsertProfile({
      profile: {
        id: current.id,
        name: current.name.trim(),
        kind: 'openai-compatible',
        baseUrl: current.baseUrl.trim(),
        model: current.model.trim(),
        temperature: current.temperature,
        maxOutputTokens: current.maxOutputTokens,
        timeoutSeconds: current.timeoutSeconds,
        extraHeaders: current.extraHeaders.trim() || undefined
      },
      apiKey
    })
    draft.value = null
    await load()
    pushToast({ type: 'success', title: '已保存', message: `模型配置「${current.name.trim()}」已保存` })
  } catch (error) {
    pushToast({
      type: 'error',
      title: '保存失败',
      message: error instanceof Error ? error.message : '无法保存模型配置'
    })
  } finally {
    saving.value = false
  }
}

async function remove(profileId: string, name: string): Promise<void> {
  const confirmed = await askConfirm({
    title: '删除模型配置',
    message: `确定删除「${name}」？已保存的 API Key 会一并清除。`,
    confirmLabel: '删除',
    variant: 'danger'
  })
  if (!confirmed) return
  const ok = await window.autoforge.llm.deleteProfile(profileId)
  if (!ok) {
    pushToast({ type: 'error', title: '删除失败', message: '配置不存在' })
    return
  }
  await load()
  pushToast({ type: 'success', title: '已删除', message: `配置「${name}」已删除` })
}

async function setActive(profileId: string): Promise<void> {
  state.value = await window.autoforge.llm.setActiveProfile(profileId)
}

async function test(profileId: string): Promise<void> {
  testingId.value = profileId
  try {
    const result = await window.autoforge.llm.testProfile(profileId)
    testResults.value = { ...testResults.value, [profileId]: result }
  } catch (error) {
    testResults.value = {
      ...testResults.value,
      [profileId]: { ok: false, message: error instanceof Error ? error.message : '测试失败' }
    }
  } finally {
    testingId.value = null
  }
}

async function onAllowBuildChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const next = input.checked

  if (next) {
    const confirmed = await askConfirm({
      title: '允许执行构建命令',
      message:
        '开启后，应用内 LLM 转换可以在仓库目录中执行依赖安装与构建命令。这会运行仓库作者编写的脚本（例如 npm 的 postinstall），存在执行恶意代码的风险。请仅对可信仓库开启。',
      confirmLabel: '我了解风险，开启',
      variant: 'danger'
    })
    if (!confirmed) {
      // 原生 checkbox 在点击时已切换视觉状态；取消后 allowBuild 未变化，
      // Vue 不会重渲染，必须显式把 DOM 回滚，否则会停留在勾选态
      input.checked = false
      return
    }
  }

  try {
    state.value = await window.autoforge.llm.setAllowBuild(next)
    input.checked = state.value.allowBuild
  } catch (error) {
    input.checked = state.value?.allowBuild ?? false
    pushToast({
      type: 'error',
      title: '保存失败',
      message: error instanceof Error ? error.message : '无法更新构建授权'
    })
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="settings-section space-y-3">
    <div class="settings-section-heading">
      <div>
        <p class="settings-eyebrow">应用内转换引擎</p>
        <h2 class="settings-section-title">模型配置</h2>
      </div>
      <span class="settings-section-index">01</span>
    </div>

    <p class="text-[11px] sb-text-faint leading-relaxed">
      配置 OpenAI 兼容接口后，「从仓库导入」可以使用应用内 LLM 引擎自动生成脚本包，
      无需外部 Agent。可以配置多个，使用时切换。API Key 使用系统加密存储，不会写入数据库。
    </p>

    <div v-if="state && !state.credentialPersistent" class="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
      <AlertTriangle class="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" :stroke-width="1.5" />
      <p class="text-[11px] text-amber-600 leading-relaxed">
        当前系统不支持加密存储，API Key 只保存在内存中，应用重启后需要重新填写。
      </p>
    </div>

    <div class="flex items-center justify-between gap-3">
      <span class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">配置列表</span>
      <button
        type="button"
        class="flex items-center gap-1 text-[12px] sb-text-muted hover:sb-text-primary transition-colors"
        @click="startCreate"
      >
        <Plus class="w-3.5 h-3.5" :stroke-width="1.5" />
        新增配置
      </button>
    </div>

    <div v-if="loading && !state" class="py-6 text-center text-[12px] sb-text-faint">正在读取…</div>

    <div v-else-if="state && state.profiles.length === 0 && !draft" class="py-6 text-center space-y-1">
      <Cpu class="w-5 h-5 mx-auto sb-text-faint" :stroke-width="1.5" />
      <p class="text-[12px] sb-text-muted">还没有配置模型</p>
      <p class="text-[11px] sb-text-faint">添加后即可在「从仓库导入」里使用应用内 LLM 转换</p>
    </div>

    <div v-else-if="state" class="space-y-2">
      <div
        v-for="profile in state.profiles"
        :key="profile.id"
        class="rounded-lg border sb-border sb-bg-surface px-3.5 py-3 space-y-2"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="text-[13px] sb-text-primary truncate">{{ profile.name }}</p>
              <span
                v-if="state.activeProfileId === profile.id"
                class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600"
              >默认</span>
              <span
                v-if="!profile.hasApiKey"
                class="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500"
              >缺少 Key</span>
            </div>
            <p class="text-[11px] sb-text-faint mt-0.5 font-mono truncate">{{ profile.model }}</p>
            <p class="text-[11px] sb-text-faint font-mono truncate">{{ profile.baseUrl }}</p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              class="flex items-center gap-1 text-[11px] sb-text-muted hover:sb-text-primary transition-colors disabled:opacity-40"
              :disabled="testingId === profile.id || !profile.hasApiKey"
              :title="profile.hasApiKey ? '测试连接' : '请先填写 API Key'"
              @click="test(profile.id)"
            >
              <Loader2 v-if="testingId === profile.id" class="w-3.5 h-3.5 animate-spin" :stroke-width="1.5" />
              <Plug v-else class="w-3.5 h-3.5" :stroke-width="1.5" />
              测试
            </button>
            <button
              v-if="state.activeProfileId !== profile.id"
              type="button"
              class="flex items-center gap-1 text-[11px] sb-text-muted hover:sb-text-primary transition-colors"
              title="设为默认"
              @click="setActive(profile.id)"
            >
              <Star class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
            <button
              type="button"
              class="sb-text-faint hover:sb-text-primary transition-colors"
              title="编辑"
              @click="startEdit(profile.id)"
            >
              <Pencil class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
            <button
              type="button"
              class="sb-text-faint hover:text-rose-500 transition-colors"
              title="删除"
              @click="remove(profile.id, profile.name)"
            >
              <Trash2 class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
          </div>
        </div>

        <div
          v-if="testResults[profile.id]"
          class="flex items-start gap-1.5 pt-1.5 border-t sb-border-subtle"
        >
          <CheckCircle2
            v-if="testResults[profile.id].ok"
            class="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0"
            :stroke-width="1.5"
          />
          <XCircle v-else class="w-3.5 h-3.5 text-rose-500 mt-0.5 flex-shrink-0" :stroke-width="1.5" />
          <p
            class="text-[11px] leading-relaxed break-words"
            :class="testResults[profile.id].ok ? 'text-emerald-600' : 'text-rose-500'"
          >
            {{ testResults[profile.id].message }}
            <span v-if="testResults[profile.id].latencyMs" class="sb-text-faint">
              （{{ Math.round(testResults[profile.id].latencyMs! / 100) / 10 }}s）
            </span>
          </p>
        </div>
      </div>
    </div>

    <div v-if="draft" class="rounded-lg border sb-border sb-bg-inset px-3.5 py-3 space-y-3">
      <p class="text-[12px] font-medium sb-text-primary">
        {{ draft.isNew ? '新增配置' : '编辑配置' }}
      </p>

      <div v-if="draft.isNew" class="flex flex-wrap gap-1.5">
        <button
          v-for="preset in PRESETS"
          :key="preset.label"
          type="button"
          class="text-[11px] px-2 py-1 rounded border sb-border sb-text-muted hover:sb-text-primary transition-colors"
          @click="applyPreset(preset)"
        >
          {{ preset.label }}
        </button>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <label class="text-[11px] sb-text-faint">配置名称</label>
          <input v-model="draft.name" type="text" class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none" placeholder="如 DeepSeek 生产" />
        </div>
        <div class="space-y-1.5">
          <label class="text-[11px] sb-text-faint">模型名称</label>
          <input v-model="draft.model" type="text" class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none font-mono" placeholder="deepseek-chat" />
        </div>
      </div>

      <div class="space-y-1.5">
        <label class="text-[11px] sb-text-faint">接口地址（OpenAI 兼容，通常以 /v1 结尾）</label>
        <input v-model="draft.baseUrl" type="text" class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none font-mono" placeholder="https://api.deepseek.com/v1" />
      </div>

      <div class="space-y-1.5">
        <label class="text-[11px] sb-text-faint">
          API Key
          <span v-if="draft.keyAlreadySet && !draft.clearKey" class="sb-text-muted">（已保存，留空表示不修改）</span>
        </label>
        <input
          v-model="draft.apiKey"
          type="password"
          class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none font-mono"
          :placeholder="draft.keyAlreadySet ? '••••••••（留空保持不变）' : 'sk-...'"
          :disabled="draft.clearKey"
        />
        <button
          v-if="draft.keyAlreadySet"
          type="button"
          class="text-[11px] sb-text-muted hover:sb-text-primary transition-colors"
          @click="draft.clearKey = !draft.clearKey"
        >
          {{ draft.clearKey ? '取消清除' : '清除已保存的 Key' }}
        </button>
      </div>

      <button
        type="button"
        class="text-[11px] sb-text-muted hover:sb-text-primary transition-colors"
        @click="showAdvanced = !showAdvanced"
      >
        {{ showAdvanced ? '收起高级选项' : '高级选项（超时 / 采样 / 自定义请求头）' }}
      </button>

      <div v-if="showAdvanced" class="grid grid-cols-3 gap-3">
        <div class="space-y-1.5">
          <label class="text-[11px] sb-text-faint">无输出超时（秒）</label>
          <input v-model.number="draft.timeoutSeconds" type="number" min="10" class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none" />
        </div>
        <div class="space-y-1.5">
          <label class="text-[11px] sb-text-faint">最大输出 tokens</label>
          <input v-model.number="draft.maxOutputTokens" type="number" min="256" class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none" />
        </div>
        <div class="space-y-1.5">
          <label class="text-[11px] sb-text-faint">temperature</label>
          <input v-model.number="draft.temperature" type="number" min="0" max="2" step="0.1" class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none" />
        </div>
        <div class="col-span-3 space-y-1.5">
          <label class="text-[11px] sb-text-faint">自定义请求头（JSON 对象，可留空）</label>
          <input v-model="draft.extraHeaders" type="text" class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none font-mono" placeholder='{"X-Gateway-Key":"..."}' />
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-1">
        <button type="button" class="text-[12px] sb-text-muted hover:sb-text-primary transition-colors" @click="cancelEdit">
          取消
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 h-7 px-3 rounded-lg sb-btn-accent text-[12px] font-medium transition-colors disabled:opacity-40"
          :disabled="saving"
          @click="save"
        >
          <Loader2 v-if="saving" class="w-3.5 h-3.5 animate-spin" :stroke-width="1.5" />
          保存
        </button>
      </div>
    </div>
  </section>

  <section class="settings-section space-y-3">
    <div class="settings-section-heading">
      <div>
        <p class="settings-eyebrow">安全边界</p>
        <h2 class="settings-section-title">构建授权</h2>
      </div>
      <span class="settings-section-index">02</span>
    </div>

    <div class="rounded-lg border sb-border sb-bg-surface px-4 py-3 space-y-2">
      <label class="flex items-start justify-between gap-4 cursor-pointer">
        <span class="min-w-0">
          <span class="block text-[13px] sb-text-secondary">允许在转换工作区执行构建命令</span>
          <span class="block text-[11px] sb-text-faint mt-0.5 leading-relaxed">
            仓库需要构建时（如 TypeScript、Vite），LLM 会给出构建命令。开启后应用可在
            <code class="font-mono">repo/</code> 目录中执行依赖安装与构建。
          </span>
        </span>
        <input
          type="checkbox"
          class="mt-0.5 flex-shrink-0"
          :checked="state?.allowBuild ?? false"
          @change="onAllowBuildChange"
        />
      </label>

      <div class="flex items-start gap-2 pt-1 border-t sb-border-subtle">
        <AlertTriangle class="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" :stroke-width="1.5" />
        <p class="text-[11px] text-amber-600 leading-relaxed">
          执行构建等于运行仓库作者编写的代码（npm 的 postinstall 等）。请只对可信仓库开启，
          并且每次转换时仍需单独确认。
        </p>
      </div>
    </div>
  </section>
</template>
