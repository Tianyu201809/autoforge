<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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

const PAGE_SIZE = 15

const loading = ref(true)
const days = ref(30)
const statusFilter = ref<SessionStatus | 'all'>('all')
const triggerFilter = ref<ExecutionTrigger | 'all'>('all')
const page = ref(1)
const records = ref<ExecutionRecord[]>([])
const resultModalOpen = ref(false)
const resultModalSession = ref<RunSession | null>(null)
const openingRecord = ref(false)

let unsubSession: (() => void) | undefined

async function loadHistory(): Promise<void> {
  loading.value = true
  try {
    const summaries = await window.autoforge.history.query({
      scriptId: props.scriptId,
      days: days.value
    })
    records.value = summaries.flatMap((day) => day.records)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadHistory()
  unsubSession = window.autoforge.runner.onSession(() => {
    void loadHistory()
  })
})

onUnmounted(() => {
  unsubSession?.()
})

watch(
  () => props.scriptId,
  () => {
    page.value = 1
    void loadHistory()
  }
)

watch([days, statusFilter, triggerFilter], () => {
  page.value = 1
})

const filteredRecords = computed(() => {
  let list = records.value
  if (statusFilter.value !== 'all') {
    list = list.filter((r) => r.status === statusFilter.value)
  }
  if (triggerFilter.value !== 'all') {
    list = list.filter((r) => r.trigger === triggerFilter.value)
  }
  return list
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredRecords.value.length / PAGE_SIZE)))

const pagedRecords = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filteredRecords.value.slice(start, start + PAGE_SIZE)
})

watch(totalPages, (max) => {
  if (page.value > max) page.value = max
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
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0">
    <div class="flex-shrink-0 px-4 py-3 border-b sb-border-subtle space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] sb-text-faint uppercase tracking-wider">时间范围</span>
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
          @click="days = option; loadHistory()"
        >
          {{ option }} 天
        </button>
        <span class="ml-auto text-[11px] sb-text-muted tabular-nums">
          共 {{ filteredRecords.length }} 条
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-1.5">
          <span class="text-[11px] sb-text-faint">状态</span>
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
          <span class="text-[11px] sb-text-faint">触发</span>
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
      v-else-if="!filteredRecords.length"
      class="flex-1 flex flex-col items-center justify-center gap-2 sb-text-muted px-4"
    >
      <History class="w-8 h-8 sb-text-faint" :stroke-width="1" />
      <p class="text-sm">暂无运行记录</p>
      <p class="text-[12px] sb-text-faint text-center">运行脚本后将在此记录执行历史</p>
    </div>

    <div v-else class="flex-1 overflow-y-auto min-h-0">
      <div class="divide-y sb-border-subtle">
        <button
          v-for="record in pagedRecords"
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
    </div>

    <RunResultModal
      :open="resultModalOpen"
      :script="script"
      :session="resultModalSession"
      @close="closeResultModal"
    />

    <div
      v-if="!loading && filteredRecords.length > PAGE_SIZE"
      class="flex-shrink-0 flex items-center justify-between px-4 py-2 border-t sb-border-subtle"
    >
      <button
        type="button"
        class="flex items-center gap-0.5 h-7 px-2 rounded-md text-[11px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-40"
        :disabled="page <= 1"
        @click="page--"
      >
        <ChevronLeft class="w-3.5 h-3.5" :stroke-width="1.5" />
        上一页
      </button>
      <span class="text-[11px] sb-text-muted tabular-nums">{{ page }} / {{ totalPages }}</span>
      <button
        type="button"
        class="flex items-center gap-0.5 h-7 px-2 rounded-md text-[11px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-40"
        :disabled="page >= totalPages"
        @click="page++"
      >
        下一页
        <ChevronRight class="w-3.5 h-3.5" :stroke-width="1.5" />
      </button>
    </div>
  </div>
</template>
