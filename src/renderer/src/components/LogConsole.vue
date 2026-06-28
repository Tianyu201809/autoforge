<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ChevronDown,
  ChevronUp,
  Eraser,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  PanelBottom,
  Plus,
  Terminal,
  X
} from 'lucide-vue-next'
import type { LogLine, SessionStatus } from '../../../shared/types/script'

export type LogConsoleDisplayMode = 'hidden' | 'mini' | 'normal'

export interface LogConsoleSession {
  sessionId: string
  scriptName: string
  logs: LogLine[]
  status?: SessionStatus
}

const props = withDefaults(
  defineProps<{
    logs?: LogLine[]
    sessions?: LogConsoleSession[]
    title?: string
    embedded?: boolean
    standalone?: boolean
    sessionId?: string
  }>(),
  {
    title: '运行日志',
    embedded: false,
    standalone: false
  }
)

const emit = defineEmits<{
  clear: [sessionId?: string]
  close: [sessionId: string]
  popout: []
}>()

const displayMode = defineModel<LogConsoleDisplayMode>('displayMode', { default: 'hidden' })
const activeSessionId = defineModel<string | undefined>('activeSessionId')

const fontSize = ref(11)
const logBodyRef = ref<HTMLDivElement | null>(null)
const autoScroll = ref(true)

const isVisible = computed(() => props.standalone || displayMode.value !== 'hidden')
const isMini = computed(() => !props.standalone && displayMode.value === 'mini')
const isMulti = computed(() => !props.embedded && (props.sessions?.length ?? 0) > 0)

const displayLogs = computed(() => props.logs ?? [])

const activeSession = computed(() =>
  props.sessions?.find((s) => s.sessionId === activeSessionId.value) ?? props.sessions?.[0]
)

const activeLogs = computed(() => {
  if (props.embedded || !isMulti.value) return displayLogs.value
  return activeSession.value?.logs ?? []
})

const totalLogCount = computed(() => {
  if (isMulti.value) return props.sessions!.reduce((sum, s) => sum + s.logs.length, 0)
  return displayLogs.value.length
})

const runningCount = computed(() => props.sessions?.filter((s) => s.status === 'running').length ?? 0)

const headerTitle = computed(() => {
  if (!isMulti.value) return props.title
  if (runningCount.value > 0) return `终端 · ${runningCount.value} 个运行中`
  return `终端 · ${props.sessions!.length} 个会话`
})

function formatLogTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function logLevelClass(level: string): string {
  if (level === 'WARN') return 'text-amber-400/80'
  if (level === 'ERROR') return 'text-red-400/80'
  return 'text-emerald-400/80'
}

function sessionStatusIconClass(status?: SessionStatus): string {
  if (status === 'running') return 'text-emerald-400'
  if (status === 'error') return 'text-red-400'
  if (status === 'success') return 'sb-text-muted'
  return 'sb-text-faint'
}

function selectSession(sessionId: string): void {
  activeSessionId.value = sessionId
}

function zoomIn(): void {
  fontSize.value = Math.min(fontSize.value + 1, 18)
}

function zoomOut(): void {
  fontSize.value = Math.max(fontSize.value - 1, 9)
}

function toggleVisible(): void {
  displayMode.value = displayMode.value === 'hidden' ? 'mini' : 'hidden'
}

function setMini(): void {
  displayMode.value = 'mini'
}

function setNormal(): void {
  displayMode.value = 'normal'
}

function hide(): void {
  displayMode.value = 'hidden'
}

function clearLogs(sessionId?: string): void {
  emit('clear', sessionId ?? activeSessionId.value)
}

function closeSession(sessionId: string, e: Event): void {
  e.stopPropagation()
  emit('close', sessionId)
}

async function scrollToBottom(): Promise<void> {
  if (!autoScroll.value || !logBodyRef.value) return
  await nextTick()
  logBodyRef.value.scrollTop = logBodyRef.value.scrollHeight
}

function onScroll(): void {
  if (!logBodyRef.value) return
  const { scrollTop, scrollHeight, clientHeight } = logBodyRef.value
  autoScroll.value = scrollHeight - scrollTop - clientHeight < 48
}

function ensureActiveSession(): void {
  const sessions = props.sessions
  if (!sessions?.length) {
    activeSessionId.value = undefined
    return
  }
  const exists = sessions.some((s) => s.sessionId === activeSessionId.value)
  if (!exists) {
    activeSessionId.value =
      sessions.find((s) => s.status === 'running')?.sessionId ?? sessions[sessions.length - 1].sessionId
  }
}

watch(() => props.sessions, ensureActiveSession, { deep: true, immediate: true })

watch(
  () => props.sessions?.length,
  (len, prev) => {
    if ((len ?? 0) > (prev ?? 0)) {
      const latest = props.sessions?.[props.sessions.length - 1]
      if (latest) activeSessionId.value = latest.sessionId
    }
  }
)

watch(
  () => activeLogs.value.length,
  () => {
    void scrollToBottom()
  }
)

watch(
  () => displayMode.value,
  (mode) => {
    if (mode !== 'hidden') void scrollToBottom()
  }
)

watch(activeSessionId, () => {
  autoScroll.value = true
  void scrollToBottom()
})
</script>

<template>
  <!-- 嵌入式（详情面板内） -->
  <div v-if="embedded" class="flex flex-col min-h-0">
    <div class="flex items-center justify-between mb-2">
      <span class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">{{ title }}</span>
      <div class="flex items-center gap-0.5">
        <button type="button" class="w-6 h-6 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="缩小" @click="zoomOut">
          <Minus class="w-3 h-3" :stroke-width="1.5" />
        </button>
        <span class="text-[10px] sb-text-faint w-7 text-center tabular-nums">{{ fontSize }}px</span>
        <button type="button" class="w-6 h-6 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="放大" @click="zoomIn">
          <Plus class="w-3 h-3" :stroke-width="1.5" />
        </button>
        <button type="button" class="w-6 h-6 flex items-center justify-center rounded sb-text-muted hover:text-red-400 sb-bg-hover" title="清除" @click="clearLogs()">
          <Eraser class="w-3 h-3" :stroke-width="1.5" />
        </button>
      </div>
    </div>
    <div
      ref="logBodyRef"
      class="rounded-lg border sb-border-subtle sb-bg-log p-3 font-mono leading-relaxed space-y-1 flex-1 overflow-y-auto min-h-[120px]"
      :style="{ fontSize: `${fontSize}px` }"
      @scroll="onScroll"
    >
      <p v-if="!displayLogs.length" class="sb-text-faint">暂无日志</p>
      <p v-for="(log, i) in displayLogs" :key="`${log.ts}-${i}`">
        <span class="sb-text-faint">{{ formatLogTime(log.ts) }}</span>
        <span class="ml-1" :class="logLevelClass(log.level)">{{ log.level }}</span>
        <span class="sb-text-muted ml-1">{{ log.message }}</span>
      </p>
    </div>
  </div>

  <!-- 底部终端面板（VS Code 风格） -->
  <section v-else class="flex-shrink-0 border-t sb-border-subtle sb-bg-panel flex flex-col" :class="standalone && 'flex-1 min-h-0 border-t-0'">
    <!-- 顶栏 -->
    <header v-if="!standalone" class="flex items-center justify-between px-2 h-9 flex-shrink-0 gap-2 border-b sb-border-subtle">
      <div class="flex items-center min-w-0">
        <button type="button" class="flex items-center gap-1.5 px-2 h-7 rounded text-[12px] sb-text-primary sb-bg-inset font-medium" @click="toggleVisible">
          <Terminal class="w-3.5 h-3.5" :stroke-width="1.5" />
          <span>终端</span>
          <span v-if="runningCount" class="text-[10px] text-emerald-400 tabular-nums">({{ runningCount }})</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-1 px-2 h-7 rounded text-[12px] sb-text-muted hover:sb-text-secondary transition-colors ml-1"
          @click="toggleVisible"
        >
          <component :is="isVisible ? ChevronDown : ChevronUp" class="w-3.5 h-3.5" :stroke-width="1.5" />
        </button>
        <span v-if="isVisible && activeSession" class="ml-2 text-[11px] sb-text-faint truncate hidden md:inline">
          {{ activeSession.scriptName }}
        </span>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <template v-if="isVisible">
          <button
            v-if="!isMini"
            type="button"
            class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover"
            title="迷你模式"
            @click="setMini"
          >
            <PanelBottom class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <button v-else type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="展开" @click="setNormal">
            <Maximize2 class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <template v-if="!isMini">
            <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="缩小" @click="zoomOut">
              <Minus class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
            <span class="text-[10px] sb-text-faint w-7 text-center tabular-nums">{{ fontSize }}px</span>
            <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="放大" @click="zoomIn">
              <Plus class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
          </template>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="清除当前终端" @click="clearLogs()">
            <Eraser class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="弹出独立窗口" @click="emit('popout')">
            <ExternalLink class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="收起" @click="hide">
            <Minimize2 class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
        </template>
        <button v-else type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="展开" @click="setMini">
          <Maximize2 class="w-3.5 h-3.5" :stroke-width="1.5" />
        </button>
      </div>
    </header>

    <!-- 主体：日志区 + 右侧终端列表 -->
    <div v-show="isVisible" class="flex min-h-0 border-t sb-border-subtle" :class="standalone ? 'flex-1 h-full border-t-0' : isMini ? 'h-28' : 'h-52'">
      <!-- 日志输出 -->
      <div
        ref="logBodyRef"
        class="flex-1 min-w-0 font-mono leading-relaxed overflow-y-auto sb-bg-log px-4 py-2"
        :style="{ fontSize: `${fontSize}px` }"
        @scroll="onScroll"
      >
        <p v-if="!activeLogs.length" class="sb-text-faint py-2">
          {{ activeSession ? '等待输出…' : '暂无日志，运行脚本后将在此显示输出' }}
        </p>
        <p v-for="(log, i) in activeLogs" :key="`${activeSessionId}-${log.ts}-${i}`" class="py-0.5 whitespace-pre-wrap break-all">
          <span class="sb-text-faint">{{ formatLogTime(log.ts) }}</span>
          <span class="ml-1.5" :class="logLevelClass(log.level)">{{ log.level }}</span>
          <span class="sb-text-muted ml-1.5">{{ log.message }}</span>
        </p>
      </div>

      <!-- 右侧终端列表（VS Code 风格） -->
      <aside
        v-if="isMulti && !isMini"
        class="w-44 flex-shrink-0 border-l sb-border-subtle sb-bg-panel overflow-y-auto"
      >
        <div
          v-for="session in sessions"
          :key="session.sessionId"
          class="terminal-item group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer border-l-2 transition-colors"
          :class="session.sessionId === activeSessionId
            ? 'border-[var(--sb-accent-solid)] sb-bg-inset'
            : 'border-transparent hover:sb-bg-hover'"
          @click="selectSession(session.sessionId)"
        >
          <Terminal class="w-3.5 h-3.5 flex-shrink-0" :class="sessionStatusIconClass(session.status)" :stroke-width="1.5" />
          <span class="flex-1 min-w-0 text-[11px] truncate" :class="session.sessionId === activeSessionId ? 'sb-text-primary' : 'sb-text-muted'">
            {{ session.scriptName }}
          </span>
          <Loader2
            v-if="session.status === 'running'"
            class="w-3 h-3 text-emerald-400 animate-spin flex-shrink-0"
            :stroke-width="1.5"
          />
          <button
            type="button"
            class="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 sb-text-faint hover:text-red-400 hover:sb-bg-hover flex-shrink-0 transition-opacity"
            title="关闭终端"
            @click="closeSession(session.sessionId, $event)"
          >
            <X class="w-3 h-3" :stroke-width="1.5" />
          </button>
        </div>
      </aside>

      <!-- 迷你模式：横向 tab -->
      <div v-else-if="isMulti && isMini" class="flex-shrink-0 border-l sb-border-subtle sb-bg-panel overflow-x-auto max-w-[40%]">
        <div class="flex h-full">
          <button
            v-for="session in sessions"
            :key="session.sessionId"
            type="button"
            class="flex items-center gap-1 px-2.5 h-full text-[10px] border-l-2 flex-shrink-0 transition-colors"
            :class="session.sessionId === activeSessionId
              ? 'border-[var(--sb-accent-solid)] sb-bg-inset sb-text-primary'
              : 'border-transparent sb-text-muted hover:sb-bg-hover'"
            @click="selectSession(session.sessionId)"
          >
            <Loader2 v-if="session.status === 'running'" class="w-2.5 h-2.5 text-emerald-400 animate-spin" :stroke-width="1.5" />
            <span class="truncate max-w-[72px]">{{ session.scriptName }}</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
