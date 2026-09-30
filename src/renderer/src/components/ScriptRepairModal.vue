<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { AlertTriangle, Loader2, RefreshCw, Sparkles, Terminal, Wrench } from 'lucide-vue-next'
import type { LogLine, ScriptItem } from '../../../shared/types/script'
import type {
  LlmConversionLogLine,
  LlmConversionProgress,
  LlmProfileView,
  ScriptRepairResult
} from '../../../shared/llm-types'
import AppFeatureModal from './AppFeatureModal.vue'
import { useToast } from '../composables/useToast'

const props = defineProps<{
  open: boolean
  script: ScriptItem
  /** 最近一次运行的日志（由详情面板提供，主进程不持久化日志） */
  logs: LogLine[]
  lastError?: string
}>()

const emit = defineEmits<{ close: []; repaired: [] }>()

const { pushToast } = useToast()

const profiles = ref<LlmProfileView[]>([])
const selectedProfileId = ref('')
const instruction = ref('')
const repairing = ref(false)
const progress = ref<LlmConversionProgress | null>(null)
const repairLogs = ref<LlmConversionLogLine[]>([])
const result = ref<ScriptRepairResult | null>(null)
const error = ref<string | null>(null)

const selectedProfile = computed(
  () => profiles.value.find((profile) => profile.id === selectedProfileId.value) ?? null
)

const canRepair = computed(
  () => !repairing.value && Boolean(selectedProfileId.value) && Boolean(selectedProfile.value?.hasApiKey)
)

const logTail = computed(() =>
  props.logs
    .slice(-18)
    .map((line) => line.message)
    .filter((message) => message.trim())
)

const phaseLabel = computed(() => {
  const phase = progress.value?.phase
  if (phase === 'preparing') return '准备上下文'
  if (phase === 'generating') return '模型生成中'
  if (phase === 'validating') return '校验中'
  if (phase === 'writing') return '写回中'
  if (phase === 'complete') return '完成'
  return '处理中'
})

function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const marker = raw.lastIndexOf('Error: ')
  return marker >= 0 ? raw.slice(marker + 7) : raw
}

function logTone(level: 'INFO' | 'WARN' | 'ERROR'): string {
  if (level === 'ERROR') return 'text-rose-500'
  if (level === 'WARN') return 'text-amber-600'
  return 'sb-text-secondary'
}

async function loadProfiles(): Promise<void> {
  try {
    const list = await window.autoforge.llm.listProfiles()
    profiles.value = list.profiles
    if (!selectedProfileId.value) {
      selectedProfileId.value = list.activeProfileId ?? list.profiles[0]?.id ?? ''
    }
  } catch {
    profiles.value = []
  }
}

async function startRepair(): Promise<void> {
  if (!canRepair.value) return
  repairing.value = true
  error.value = null
  result.value = null
  repairLogs.value = []
  try {
    const repaired = await window.autoforge.llm.repairScript({
      scriptId: props.script.id,
      profileId: selectedProfileId.value,
      instruction: instruction.value.trim() || undefined,
      logs: props.logs.map((line) => line.message).filter((message) => message.trim())
    })
    result.value = repaired
    pushToast({
      type: 'success',
      title: '修复已应用',
      message: `改动 ${repaired.changedFiles.length} 个文件，请重新运行验证`
    })
    emit('repaired')
  } catch (err) {
    error.value = describeError(err)
  } finally {
    repairing.value = false
  }
}

function onClose(): void {
  if (repairing.value) return
  emit('close')
}

let unsubscribeProgress: (() => void) | undefined
let unsubscribeLog: (() => void) | undefined

onMounted(() => {
  void loadProfiles()
  unsubscribeProgress = window.autoforge.llm.onRepairProgress((payload) => {
    if (payload.taskId !== props.script.id) return
    progress.value = payload
  })
  unsubscribeLog = window.autoforge.llm.onRepairLog((line) => {
    if (line.taskId !== props.script.id) return
    const next = [...repairLogs.value, line]
    repairLogs.value = next.length > 200 ? next.slice(-200) : next
  })
})

onUnmounted(() => {
  unsubscribeProgress?.()
  unsubscribeLog?.()
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    void loadProfiles()
    if (!repairing.value) {
      error.value = null
      result.value = null
      repairLogs.value = []
      progress.value = null
    }
  }
)
</script>

<template>
  <AppFeatureModal :open="open" max-width="2xl" @close="onClose">
    <div class="flex items-center justify-between gap-3 px-5 py-3.5 border-b sb-border-subtle flex-shrink-0">
      <div class="flex items-center gap-2.5 min-w-0">
        <Wrench class="w-4 h-4 text-sky-500 flex-shrink-0" :stroke-width="1.5" />
        <div class="min-w-0">
          <h2 class="text-[14px] font-medium sb-text-primary">AI 修复</h2>
          <p class="text-[11px] sb-text-faint truncate">
            把失败日志与当前代码交给模型，让它给出最小改动的修复方案
          </p>
        </div>
      </div>
      <button
        type="button"
        class="text-[12px] sb-text-muted hover:sb-text-primary transition-colors disabled:opacity-40"
        :disabled="repairing"
        @click="onClose"
      >
        关闭
      </button>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
      <div
        v-if="error"
        class="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20"
      >
        <AlertTriangle class="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" :stroke-width="1.5" />
        <p class="text-[12px] text-red-500 leading-relaxed break-words flex-1">{{ error }}</p>
      </div>

      <div class="space-y-2">
        <span class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">失败上下文</span>
        <div class="px-3.5 py-3 rounded-lg border sb-border-subtle sb-bg-inset space-y-2">
          <div class="flex items-center justify-between gap-3 text-[12px]">
            <span class="sb-text-faint">脚本</span>
            <span class="sb-text-primary truncate">{{ script.name }}</span>
          </div>
          <div class="flex items-center justify-between gap-3 text-[12px]">
            <span class="sb-text-faint">入口</span>
            <span class="sb-text-primary font-mono truncate">{{ script.entry }}</span>
          </div>
          <div v-if="lastError" class="flex items-start justify-between gap-3 text-[12px]">
            <span class="sb-text-faint flex-shrink-0">最近错误</span>
            <span class="text-rose-500 text-right break-words min-w-0">{{ lastError }}</span>
          </div>
        </div>

        <div v-if="logTail.length" class="max-h-40 overflow-y-auto px-3 py-2 rounded-lg sb-bg-log border sb-border-subtle font-mono text-[11px] leading-relaxed space-y-0.5">
          <p v-for="(line, index) in logTail" :key="index" class="sb-text-secondary break-all">{{ line }}</p>
        </div>
        <p v-else class="text-[11px] sb-text-faint">
          没有可用的运行日志。请先运行一次脚本，让失败信息被记录下来。
        </p>
      </div>

      <div class="space-y-2">
        <label class="text-[11px] font-medium sb-text-faint uppercase tracking-wider" for="repair-profile">
          使用的模型
        </label>
        <select
          v-if="profiles.length"
          id="repair-profile"
          v-model="selectedProfileId"
          class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none"
          :disabled="repairing"
        >
          <option v-for="item in profiles" :key="item.id" :value="item.id">
            {{ item.name }} · {{ item.model }}{{ item.hasApiKey ? '' : '（缺少 Key）' }}
          </option>
        </select>
        <p v-else class="text-[12px] sb-text-secondary">
          还没有配置模型，请先到「设置 → 模型」添加一个 OpenAI 兼容接口配置。
        </p>
      </div>

      <div class="space-y-2">
        <label class="text-[11px] sb-text-faint" for="repair-instruction">补充要求（可选）</label>
        <textarea
          id="repair-instruction"
          v-model="instruction"
          rows="2"
          class="w-full px-2.5 py-2 text-[12px] sb-input border rounded-lg outline-none resize-none"
          placeholder="例如：不要用第三方库，改用标准库实现；或者：接口地址改成从环境变量读取"
          :disabled="repairing"
        />
      </div>

      <div v-if="repairing || repairLogs.length" class="space-y-2">
        <div class="flex items-center gap-2.5">
          <Loader2 v-if="repairing" class="w-3.5 h-3.5 text-[var(--sb-accent-solid)] animate-spin" :stroke-width="1.5" />
          <Terminal v-else class="w-3.5 h-3.5 sb-text-faint" :stroke-width="1.5" />
          <span class="text-[12px] sb-text-primary">{{ progress?.message ?? '修复日志' }}</span>
          <span class="ml-auto text-[11px] sb-text-faint">{{ phaseLabel }}</span>
        </div>
        <div class="max-h-48 overflow-y-auto px-3 py-2 rounded-lg sb-bg-log border sb-border-subtle font-mono text-[11px] leading-relaxed space-y-0.5">
          <p v-for="(line, index) in repairLogs" :key="index" :class="logTone(line.level)">{{ line.message }}</p>
        </div>
      </div>

      <div
        v-if="result"
        class="px-3.5 py-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 space-y-1.5"
      >
        <p class="text-[12px] text-emerald-600 font-medium">{{ result.summary }}</p>
        <p class="text-[11px] text-emerald-600/90 leading-relaxed">根因：{{ result.diagnosis }}</p>
        <p v-if="result.changedFiles.length" class="text-[11px] text-emerald-600/90 leading-relaxed">
          已重写：<span class="font-mono">{{ result.changedFiles.join('、') }}</span>
        </p>
        <p v-if="result.deletedFiles.length" class="text-[11px] text-emerald-600/90 leading-relaxed">
          已删除：<span class="font-mono">{{ result.deletedFiles.join('、') }}</span>
        </p>
        <p v-if="result.manifestUpdated" class="text-[11px] text-emerald-600/90">已更新 autoforge.json</p>
        <p v-if="result.notes" class="text-[11px] text-emerald-600/90 leading-relaxed">{{ result.notes }}</p>
        <p class="text-[11px] sb-text-faint pt-0.5">请回到详情面板重新运行，确认问题是否解决。</p>
      </div>
    </div>

    <div class="flex items-center justify-between gap-3 px-5 py-3 border-t sb-border-subtle flex-shrink-0">
      <span class="text-[11px] sb-text-faint">
        修复会直接改写脚本工作区文件，建议先确认改动内容
      </span>
      <button
        type="button"
        class="flex items-center gap-1.5 h-8 px-4 rounded-lg sb-btn-accent text-[12px] font-medium transition-colors disabled:opacity-40"
        :disabled="!canRepair"
        @click="startRepair"
      >
        <Loader2 v-if="repairing" class="w-3.5 h-3.5 animate-spin" :stroke-width="1.5" />
        <Sparkles v-else-if="!result" class="w-3.5 h-3.5" :stroke-width="1.5" />
        <RefreshCw v-else class="w-3.5 h-3.5" :stroke-width="1.5" />
        {{ repairing ? '修复中…' : result ? '再次修复' : '让模型修复' }}
      </button>
    </div>
  </AppFeatureModal>
</template>
