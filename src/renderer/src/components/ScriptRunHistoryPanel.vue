<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  Square,
  Timer
} from 'lucide-vue-next'
import type { ExecutionRecord, ExecutionTrigger, RunSession, ScriptItem, SessionStatus } from '../../../shared/types/script'
import RunResultModal from './RunResultModal.vue'

const props = defineProps<{
  scriptId: string
  script: ScriptItem
}>()

const PAGE_SIZE = 20
const DAYS_STORAGE_KEY = 'scriptRunHistoryDays'

function readStoredDays(): 7 | 30 | 90 {
  const stored = Number(localStorage.getItem(DAYS_STORAGE_KEY))
  if (stored === 7 || stored === 30 || stored === 90) return stored
  return 30
}

const loading = ref(true)
const loadingMore = ref(false)
const days = ref<7 | 30 | 90>(readStoredDays())
const statusFilter = ref<SessionStatus | 'all'>('all')
const triggerFilter = ref<ExecutionTrigger | 'all'>('all')
const records = ref<ExecutionRecord[]>([])
const total = ref(0)
const hasMore = ref(false)
const listRef = ref<HTMLElement | null>(null)
const resultModalOpen = ref(false)
const resultModalSession = ref<RunSession | null>(null)
const openingRecord = ref(false)

let unsubSession: (() => void) | undefined

async function loadHistory(reset = true): Promise<void> {
  if (reset) {
    loading.value = true
    records.value = []
  } else {
    loadingMore.value = true
  }

  try {
    const page = await window.autoforge.history.queryPage({
      scriptId: props.scriptId,
      days: days.value,
      status: statusFilter.value,
      trigger: triggerFilter.value,
      offset: reset ? 0 : records.value.length,
      limit: PAGE_SIZE
    })

    if (reset) {
      records.value = page.records
    } else {
      records.value = [...records.value, ...page.records]
    }
    total.value = page.total
    hasMore.value = page.hasMore
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function setDays(option: 7 | 30 | 90): void {
  days.value = option
  localStorage.setItem(DAYS_STORAGE_KEY, String(option))
  void loadHistory(true)
}

function onListScroll(): void {
  const el = listRef.value
  if (!el || loading.value || loadingMore.value || !hasMore.value) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    void loadHistory(false)
  }
}

onMounted(() => {
  void loadHistory(true)
  unsubSession = window.autoforge.runner.onSession(() => {
    void loadHistory(true)
  })
})

onUnmounted(() => {
  unsubSession?.()
})

watch(
  () => props.scriptId,
  () => {
    void loadHistory(true)
  }
)

watch([statusFilter, triggerFilter], () => {
  void loadHistory(true)
})

const statusMeta: Record<
  SessionStatus,
  { label: string; icon: typeof CheckCircle2; class: string; dot: string }
> = {
  success: {
    label: '成功',
    icon: CheckCircle2,
    class: 'text-emerald-400',
    dot: 'bg-emerald-500'
  },
  error: {
    label: '失败',
    icon: AlertCircle,
    class: 'text-red-400',
    dot: 'bg-red-500'
  },
  stopped: {
    label: '已停止',
    icon: Square,
    class: 'sb-text-muted',
    dot: 'bg-zinc-500'
  },
  running: {
    label: '运行中',
    icon: Loader2,
    class: 'text-amber-400',
    dot: 'bg-amber-500'
  }
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  return rem ? `${mins}m ${rem}s` : `${mins}m`
}

function triggerLabel(trigger: ExecutionTrigger): string {
  return trigger === 'scheduled' ? '定时' : '手动'
}

function recordToRunSession(record: ExecutionRecord): RunSession {
  let result = record.result
  if (result === undefined && record.errorMessage) {
    result = { error: record.errorMessage }
  }
  return {
    id: record.id,
    scriptId: record.scriptId,
    status: record.status,
    envId: record.envId,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    exitCode: record.exitCode,
    result
  }
}

function isRecordClickable(record: ExecutionRecord): boolean {
  return record.status !== 'running'
}

async function openRecordResult(record: ExecutionRecord): Promise<void> {
  if (!isRecordClickable(record) || openingRecord.value) return
  openingRecord.value = true
  try {
    const live = await window.autoforge.runner.getSession(record.id)
    resultModalSession.value = live ?? recordToRunSession(record)
    resultModalOpen.value = true
  } finally {
    openingRecord.value = false
  }
}

function closeResultModal(): void {
  resultModalOpen.value = false
  resultModalSession.value = null
}

const loadedSummary = computed(() => `已加载 ${records.value.length} / ${total.value} 条`)
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0">
    <div class="flex-shrink-0 px-4 py-3 border-b sb-border-subtle space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="sb-field-label">时间范围</span>
        <button
          v-for="option in [7, 30, 90] as const"
          :key="option"
          type="button"
          class="h-6 px-2 rounded-md text-[11px] transition-colors"
          :class="
            days === option
              ? 'sb-bg-inset sb-text-primary font-medium'
              : 'sb-text-muted hover:sb-text-secondary sb-bg-hover'
          "
          @click="setDays(option)"
        >
          {{ option }} 天
        </button>
        <span class="ml-auto text-[11px] sb-text-muted tabular-nums">
          共 {{ total }} 条
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-1.5">
          <span class="sb-field-label normal-case tracking-normal">状态</span>
          <button
            v-for="opt in ([['all', '全部'], ['success', '成功'], ['error', '失败'], ['stopped', '停止'], ['running', '运行中']] as const)"
            :key="opt[0]"
            type="button"
            class="h-6 px-2 rounded-md text-[11px] border transition-colors"
            :class="
              statusFilter === opt[0]
                ? 'sb-bg-inset sb-text-primary border-[var(--sb-accent-solid)]'
                : 'sb-border-subtle sb-text-muted hover:sb-text-secondary'
            "
            @click="statusFilter = opt[0]"
          >
            {{ opt[1] }}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="sb-field-label normal-case tracking-normal">触发</span>
          <button
            v-for="opt in ([['all', '全部'], ['manual', '手动'], ['scheduled', '定时']] as const)"
            :key="opt[0]"
            type="button"
            class="h-6 px-2 rounded-md text-[11px] border transition-colors"
            :class="
              triggerFilter === opt[0]
                ? 'sb-bg-inset sb-text-primary border-[var(--sb-accent-solid)]'
                : 'sb-border-subtle sb-text-muted hover:sb-text-secondary'
            "
            @click="triggerFilter = opt[0]"
          >
            {{ opt[1] }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center sb-text-muted text-sm">加载中…</div>

    <div
      v-else-if="!records.length"
      class="flex-1 flex flex-col items-center justify-center gap-2 sb-text-muted px-4"
    >
      <History class="w-8 h-8 sb-text-faint" :stroke-width="1" />
      <p class="text-sm">暂无运行记录</p>
      <p class="text-[12px] sb-text-faint text-center">运行脚本后将在此记录执行历史</p>
    </div>

    <div
      v-else
      ref="listRef"
      class="flex-1 overflow-y-auto min-h-0"
      @scroll="onListScroll"
    >
      <div class="divide-y sb-border-subtle">
        <button
          v-for="record in records"
          :key="record.id"
          type="button"
          class="w-full text-left flex items-start gap-3 px-4 py-3 sb-bg-surface transition-colors"
          :class="
            isRecordClickable(record)
              ? 'hover:sb-bg-hover cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--sb-accent-solid)]'
              : 'cursor-default opacity-80'
          "
          :disabled="!isRecordClickable(record) || openingRecord"
          @click="openRecordResult(record)"
        >
          <span
            class="mt-1.5 w-2 h-2 rounded-full shrink-0"
            :class="[
              statusMeta[record.status].dot,
              record.status === 'running' ? 'animate-pulse' : ''
            ]"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded sb-bg-inset"
                :class="statusMeta[record.status].class"
              >
                <component
                  :is="statusMeta[record.status].icon"
                  class="w-3 h-3"
                  :class="record.status === 'running' ? 'animate-spin' : ''"
                  :stroke-width="1.5"
                />
                {{ statusMeta[record.status].label }}
              </span>
              <span class="inline-flex items-center gap-1 text-[11px] sb-text-muted px-1.5 py-0.5 rounded sb-bg-inset">
                <Timer v-if="record.trigger === 'scheduled'" class="w-3 h-3" :stroke-width="1.5" />
                {{ triggerLabel(record.trigger) }}
              </span>
            </div>
            <p v-if="record.errorMessage" class="mt-1 text-[12px] text-red-400/90 line-clamp-2">
              {{ record.errorMessage }}
            </p>
            <div class="mt-1 flex items-center gap-3 text-[11px] sb-text-muted tabular-nums flex-wrap">
              <span>{{ formatDateTime(record.startedAt) }}</span>
              <span v-if="record.durationMs != null">耗时 {{ formatDuration(record.durationMs) }}</span>
              <span v-if="record.exitCode != null && record.status !== 'success'">exit {{ record.exitCode }}</span>
            </div>
          </div>
        </button>
      </div>

      <div
        v-if="loadingMore"
        class="flex items-center justify-center gap-2 py-3 text-[12px] sb-text-muted"
      >
        <Loader2 class="w-3.5 h-3.5 animate-spin" :stroke-width="1.5" />
        加载更多…
      </div>
      <div
        v-else-if="hasMore"
        class="py-3 text-center text-[11px] sb-text-faint"
      >
        向下滚动加载更多
      </div>
      <div
        v-else-if="records.length > PAGE_SIZE"
        class="py-3 text-center text-[11px] sb-text-muted"
      >
        {{ loadedSummary }}
      </div>
    </div>

    <RunResultModal
      :open="resultModalOpen"
      :script="script"
      :session="resultModalSession"
      @close="closeResultModal"
    />
  </div>
</template>
