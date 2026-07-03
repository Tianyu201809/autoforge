<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  Search,
  Square,
  Timer,
  X,
  Zap
} from 'lucide-vue-next'
import type { ExecutionDaySummary, ExecutionRecord, SessionStatus } from '../../../shared/types/script'
import { matchPinyinQuery } from '../utils/pinyin-match'

const emit = defineEmits<{ close: [] }>()

const DAYS_STORAGE_KEY = 'executionHistoryDays'

function readStoredDays(): 7 | 30 | 90 {
  const stored = Number(localStorage.getItem(DAYS_STORAGE_KEY))
  if (stored === 7 || stored === 30 || stored === 90) return stored
  return 30
}

const loading = ref(true)
const days = ref<7 | 30 | 90>(readStoredDays())
const searchQuery = ref('')
const summaries = ref<ExecutionDaySummary[]>([])
const todayCount = ref(0)

let unsubSession: (() => void) | undefined

async function loadHistory(): Promise<void> {
  loading.value = true
  try {
    const [data, count] = await Promise.all([
      window.autoforge.history.query({ days: days.value }),
      window.autoforge.history.todayCount()
    ])
    summaries.value = data
    todayCount.value = count
  } finally {
    loading.value = false
  }
}

function setDays(option: 7 | 30 | 90): void {
  days.value = option
  localStorage.setItem(DAYS_STORAGE_KEY, String(option))
  void loadHistory()
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

const filteredSummaries = computed(() => {
  const q = searchQuery.value.trim()
  if (!q) return summaries.value

  return summaries.value
    .map((day) => {
      const records = day.records.filter((r) => matchPinyinQuery(r.scriptName, q))
      return {
        date: day.date,
        total: records.length,
        success: records.filter((r) => r.status === 'success').length,
        error: records.filter((r) => r.status === 'error').length,
        stopped: records.filter((r) => r.status === 'stopped').length,
        running: records.filter((r) => r.status === 'running').length,
        records
      }
    })
    .filter((day) => day.records.length > 0)
})

const totalInRange = computed(() =>
  filteredSummaries.value.reduce((sum, day) => sum + day.records.length, 0)
)

const hasSearchQuery = computed(() => searchQuery.value.trim().length > 0)

function formatDateLabel(dateKey: string): string {
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`

  if (dateKey === todayKey) return '今天'
  if (dateKey === yesterdayKey) return '昨天'
  const [y, m, d] = dateKey.split('-')
  return `${y}年${Number(m)}月${Number(d)}日`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
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

function triggerLabel(trigger: ExecutionRecord['trigger']): string {
  return trigger === 'scheduled' ? '定时' : '手动'
}
</script>

<template>
  <main class="flex-1 flex flex-col min-w-0 sb-bg-base overflow-hidden">
    <div class="flex items-center justify-between px-6 py-4 border-b sb-border-subtle flex-shrink-0">
      <div>
        <h1 class="text-xl font-semibold sb-text-primary">执行历史</h1>
        <p class="text-[13px] sb-text-muted mt-0.5">按天查看脚本运行记录，保留最近 90 天</p>
      </div>
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-secondary sb-bg-hover"
        @click="emit('close')"
      >
        <X class="w-4 h-4" :stroke-width="1.5" />
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-3 px-6 py-3 border-b sb-border-subtle flex-shrink-0">
      <div class="flex items-center gap-2 px-3 py-2 rounded-lg border sb-border sb-bg-surface">
        <Zap class="w-3.5 h-3.5 text-amber-400" :stroke-width="1.5" />
        <span class="text-[12px] sb-text-muted">今日执行</span>
        <span class="text-[15px] font-medium sb-text-primary tabular-nums">{{ todayCount }}</span>
      </div>
      <div class="flex items-center gap-2 px-3 py-2 rounded-lg border sb-border sb-bg-surface">
        <History class="w-3.5 h-3.5 sb-text-muted" :stroke-width="1.5" />
        <span class="text-[12px] sb-text-muted">范围内共</span>
        <span class="text-[15px] font-medium sb-text-primary tabular-nums">{{ totalInRange }}</span>
        <span class="text-[12px] sb-text-muted">次</span>
      </div>

      <div class="flex items-center gap-1 ml-auto">
        <button
          v-for="option in [7, 30, 90] as const"
          :key="option"
          type="button"
          class="h-7 px-2.5 rounded-md text-[12px] transition-colors"
          :class="
            days === option
              ? 'sb-bg-inset sb-text-primary font-medium'
              : 'sb-text-muted hover:sb-text-secondary sb-bg-hover'
          "
          @click="setDays(option)"
        >
          {{ option }} 天
        </button>
      </div>

      <div class="relative w-full sm:w-56">
        <Search
          class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sb-text-faint pointer-events-none"
          :stroke-width="1.5"
        />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索脚本名称"
          class="w-full h-8 pl-8 pr-3 text-[13px] sb-input border rounded-lg placeholder:sb-text-faint outline-none focus:sb-input"
        />
      </div>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center sb-text-muted text-sm">加载中…</div>

    <div
      v-else-if="!filteredSummaries.length"
      class="flex-1 flex flex-col items-center justify-center gap-2 sb-text-muted"
    >
      <History class="w-10 h-10 sb-text-faint" :stroke-width="1" />
      <p class="text-sm">{{ hasSearchQuery ? '未找到匹配的脚本记录' : '暂无执行记录' }}</p>
      <p class="text-[12px] sb-text-faint">
        {{ hasSearchQuery ? '请尝试其他关键词或拼音首字母' : '运行脚本后将在此留下每日执行痕迹' }}
      </p>
    </div>

    <div v-else class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
      <section v-for="day in filteredSummaries" :key="day.date">
        <div class="flex items-center gap-3 mb-3 pb-2 border-b sb-border-subtle">
          <h2 class="text-[14px] font-semibold sb-text-primary">{{ formatDateLabel(day.date) }}</h2>
          <span class="text-[11px] sb-text-muted tabular-nums">{{ day.date }}</span>
          <div class="flex items-center gap-2 ml-auto text-[11px]">
            <span class="sb-text-muted">{{ day.total }} 次</span>
            <span v-if="day.success" class="text-emerald-400">{{ day.success }} 成功</span>
            <span v-if="day.error" class="text-red-400">{{ day.error }} 失败</span>
            <span v-if="day.stopped" class="sb-text-muted">{{ day.stopped }} 停止</span>
            <span v-if="day.running" class="text-amber-400">{{ day.running }} 运行中</span>
          </div>
        </div>

        <div class="rounded-lg border sb-border overflow-hidden divide-y sb-border-subtle">
          <div
            v-for="record in day.records"
            :key="record.id"
            class="flex items-start gap-3 px-4 py-3 sb-bg-surface hover:sb-bg-hover transition-colors"
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
                <span class="text-[13px] font-medium sb-text-primary truncate">{{ record.scriptName }}</span>
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
                <span
                  class="inline-flex items-center gap-1 text-[11px] sb-text-muted px-1.5 py-0.5 rounded sb-bg-inset"
                >
                  <Timer v-if="record.trigger === 'scheduled'" class="w-3 h-3" :stroke-width="1.5" />
                  {{ triggerLabel(record.trigger) }}
                </span>
              </div>
              <p v-if="record.errorMessage" class="mt-1 text-[12px] text-red-400/90 line-clamp-2">
                {{ record.errorMessage }}
              </p>
              <div class="mt-1 flex items-center gap-3 text-[11px] sb-text-muted tabular-nums">
                <span>{{ formatTime(record.startedAt) }}</span>
                <span v-if="record.finishedAt">→ {{ formatTime(record.finishedAt) }}</span>
                <span v-if="record.durationMs != null">耗时 {{ formatDuration(record.durationMs) }}</span>
                <span v-if="record.exitCode != null && record.status !== 'success'">
                  exit {{ record.exitCode }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
