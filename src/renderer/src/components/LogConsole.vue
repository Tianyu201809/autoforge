<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ChevronDown,
  ChevronUp,
  Eraser,
  ExternalLink,
  ListX,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Terminal,
  X
} from 'lucide-vue-next'
import type { LogLine, SessionStatus } from '../../../shared/types/script'
import type { ScriptRunProgress } from '../../../shared/script-progress'
import { formatScriptRunProgressSummary, isControlLogMessage } from '../../../shared/script-progress'
import ScriptRunProgressPanel from './ScriptRunProgressPanel.vue'

export type LogConsoleDisplayMode = 'hidden' | 'normal'

export interface LogConsoleSession {
  sessionId: string
  scriptName: string
  logs: LogLine[]
  status?: SessionStatus
  runProgress?: ScriptRunProgress
}

const props = withDefaults(
  defineProps<{
    logs?: LogLine[]
    sessions?: LogConsoleSession[]
    title?: string
    embedded?: boolean
    standalone?: boolean
    sessionId?: string
    runProgress?: ScriptRunProgress
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
  closeAll: []
  popout: []
}>()

const displayMode = defineModel<LogConsoleDisplayMode>('displayMode', { default: 'hidden' })
const activeSessionId = defineModel<string | undefined>('activeSessionId')

const PANEL_HEIGHT_KEY = 'autoforge-terminal-height'
const SIDEBAR_WIDTH_KEY = 'autoforge-terminal-sidebar-width'
const DEFAULT_PANEL_HEIGHT = 208
const DEFAULT_SIDEBAR_WIDTH = 176
const MIN_PANEL_HEIGHT = 112
const MIN_SIDEBAR_WIDTH = 120
const MIN_LOG_WIDTH = 200
const MIN_MAIN_HEIGHT = 200
const MIN_SCRIPT_VIEW_HEIGHT = 64
const PANEL_HEADER_HEIGHT = 36
const RESIZE_HANDLE_HEIGHT = 5
const SIDEBAR_RESIZE_HANDLE_WIDTH = 5

const fontSize = ref(11)
const logBodyRef = ref<HTMLDivElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const terminalBodyRef = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const panelHeight = ref(DEFAULT_PANEL_HEIGHT)
const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH)
const resizing = ref(false)
const resizingSidebar = ref(false)
const parentHeight = ref(0)
const mainChromeHeight = ref(MIN_MAIN_HEIGHT)

let layoutObserver: ResizeObserver | undefined

const isVisible = computed(() => props.standalone || displayMode.value === 'normal')
const isExpanded = computed(() => !props.standalone && displayMode.value === 'normal')
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
  if (runningCount.value > 0) return `执行日志 · ${runningCount.value} 个运行中`
  return `执行日志 · ${props.sessions!.length} 个会话`
})

function formatLogTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function logLevelClass(level: string): string {
  if (level === 'WARN') return 'terminal-log-level-warn'
  if (level === 'ERROR') return 'terminal-log-level-error'
  return 'terminal-log-level-info'
}

function logMessageClass(message: string): string {
  return isControlLogMessage(message) ? 'terminal-log-progress' : 'terminal-log-message'
}

const activeRunProgress = computed(
  () => activeSession.value?.runProgress ?? props.runProgress
)

const activeProgressSummary = computed(() => formatScriptRunProgressSummary(activeRunProgress.value))

function sessionStatusIconClass(status?: SessionStatus): string {
  if (status === 'running') return 'terminal-status-running'
  if (status === 'error') return 'terminal-log-level-error'
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
  displayMode.value = displayMode.value === 'hidden' ? 'normal' : 'hidden'
}

function expand(): void {
  displayMode.value = 'normal'
}

function hide(): void {
  displayMode.value = 'hidden'
}

function measureMainChrome(mainEl: HTMLElement): number {
  const children = Array.from(mainEl.children) as HTMLElement[]
  if (children.length <= 1) return MIN_MAIN_HEIGHT
  const fixedChrome = children.slice(0, -1).reduce((sum, el) => sum + el.offsetHeight, 0)
  return fixedChrome + MIN_SCRIPT_VIEW_HEIGHT
}

function measureLayout(): void {
  if (!props.standalone) {
    const parent = panelRef.value?.parentElement
    if (parent) {
      parentHeight.value = parent.clientHeight
      const mainEl = parent.firstElementChild
      if (mainEl instanceof HTMLElement) {
        mainChromeHeight.value = Math.max(MIN_MAIN_HEIGHT, measureMainChrome(mainEl))
      }
      panelHeight.value = clampPanelHeight(panelHeight.value)
    }
  }
  sidebarWidth.value = clampSidebarWidth(sidebarWidth.value)
}

function getMaxSidebarWidth(): number {
  const body = terminalBodyRef.value
  if (!body) return 320
  return Math.max(MIN_SIDEBAR_WIDTH, body.clientWidth - MIN_LOG_WIDTH - SIDEBAR_RESIZE_HANDLE_WIDTH)
}

function clampSidebarWidth(width: number): number {
  return Math.min(getMaxSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, width))
}

function loadSidebarWidth(): void {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  sidebarWidth.value = clampSidebarWidth(
    Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_SIDEBAR_WIDTH
  )
}

function persistSidebarWidth(): void {
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value))
}

function resetSidebarWidth(): void {
  sidebarWidth.value = clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
  persistSidebarWidth()
}

function onSidebarResizeStart(e: MouseEvent): void {
  if (!isMulti.value || !isVisible.value) return
  e.preventDefault()
  resizingSidebar.value = true
  const startX = e.clientX
  const startWidth = sidebarWidth.value

  const onMove = (ev: MouseEvent): void => {
    sidebarWidth.value = clampSidebarWidth(startWidth + (startX - ev.clientX))
  }

  const onUp = (): void => {
    resizingSidebar.value = false
    persistSidebarWidth()
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function getMaxPanelHeight(): number {
  const available =
    parentHeight.value || panelRef.value?.parentElement?.clientHeight || Math.floor(window.innerHeight * 0.55)
  const chrome = PANEL_HEADER_HEIGHT + (isExpanded.value ? RESIZE_HANDLE_HEIGHT : 0)
  return Math.max(MIN_PANEL_HEIGHT, available - mainChromeHeight.value - chrome)
}

function clampPanelHeight(height: number): number {
  return Math.min(getMaxPanelHeight(), Math.max(MIN_PANEL_HEIGHT, height))
}

function loadPanelHeight(): void {
  const stored = Number(localStorage.getItem(PANEL_HEIGHT_KEY))
  panelHeight.value = clampPanelHeight(
    Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_PANEL_HEIGHT
  )
}

function persistPanelHeight(): void {
  localStorage.setItem(PANEL_HEIGHT_KEY, String(panelHeight.value))
}

function resetPanelHeight(): void {
  panelHeight.value = clampPanelHeight(DEFAULT_PANEL_HEIGHT)
  persistPanelHeight()
}

function onPanelResizeStart(e: MouseEvent): void {
  if (props.standalone || !isExpanded.value) return
  e.preventDefault()
  resizing.value = true
  const startY = e.clientY
  const startHeight = panelHeight.value

  const onMove = (ev: MouseEvent): void => {
    panelHeight.value = clampPanelHeight(startHeight + (startY - ev.clientY))
  }

  const onUp = (): void => {
    resizing.value = false
    persistPanelHeight()
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onWindowResize(): void {
  measureLayout()
}

const effectiveBodyHeight = computed(() => clampPanelHeight(panelHeight.value))

const panelSectionStyle = computed(() => {
  if (props.standalone) return {}
  if (!isExpanded.value) {
    return { height: `${PANEL_HEADER_HEIGHT}px` }
  }
  const body = effectiveBodyHeight.value
  return { height: `${body + PANEL_HEADER_HEIGHT + RESIZE_HANDLE_HEIGHT}px` }
})

const panelBodyStyle = computed(() => {
  if (props.standalone || !isExpanded.value) return {}
  return { flex: '1 1 0', minHeight: '0' }
})

function clearLogs(sessionId?: string): void {
  emit('clear', sessionId ?? activeSessionId.value)
}

function closeSession(sessionId: string, e: Event): void {
  e.stopPropagation()
  emit('close', sessionId)
}

function closeAllSessions(): void {
  emit('closeAll')
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
    if (!props.standalone) {
      void nextTick(() => measureLayout())
    }
  }
)

watch(activeSessionId, () => {
  autoScroll.value = true
  void scrollToBottom()
})

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  void nextTick(() => {
    loadSidebarWidth()
    if (!props.standalone) {
      loadPanelHeight()
    }
    layoutObserver = new ResizeObserver(() => measureLayout())
    const body = terminalBodyRef.value
    if (body) layoutObserver.observe(body)
    if (!props.standalone) {
      const parent = panelRef.value?.parentElement
      if (parent) {
        layoutObserver!.observe(parent)
        const mainEl = parent.firstElementChild
        if (mainEl) layoutObserver!.observe(mainEl)
        measureLayout()
      }
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  layoutObserver?.disconnect()
})
</script>

<template>
  <!-- 嵌入式（详情面板内） -->
  <div v-if="embedded" class="flex flex-col min-h-0">
    <div class="flex items-center justify-between mb-2">
      <span class="sb-field-label">{{ title }}</span>
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
    <ScriptRunProgressPanel v-if="activeRunProgress" :progress="activeRunProgress" compact />
    <div
      ref="logBodyRef"
      class="log-console-selectable rounded-lg border sb-border-subtle sb-bg-log p-3 font-mono leading-relaxed space-y-1 flex-1 overflow-y-auto min-h-[120px]"
      :style="{ fontSize: `${fontSize}px` }"
      @scroll="onScroll"
    >
      <p v-if="!displayLogs.length" class="sb-text-faint">暂无日志</p>
      <p v-for="(log, i) in displayLogs" :key="`${log.ts}-${i}`">
        <span class="sb-text-faint">{{ formatLogTime(log.ts) }}</span>
        <span class="ml-1" :class="logLevelClass(log.level)">{{ log.level }}</span>
        <span class="sb-text-muted ml-1" :class="logMessageClass(log.message)">{{ log.message }}</span>
      </p>
    </div>
  </div>

  <!-- 底部终端面板（VS Code 风格） -->
  <section
    v-else
    ref="panelRef"
    class="terminal-panel relative z-[1] flex-shrink-0 flex flex-col min-h-0 overflow-hidden"
    :class="[standalone && 'flex-1 min-h-0 border-t-0 shadow-none', (resizing || resizingSidebar) && 'select-none']"
    :style="panelSectionStyle"
  >
    <!-- 顶栏：紧贴主内容区下方，拉高时不被遮挡 -->
    <header v-if="!standalone" class="terminal-header relative z-[2] flex items-center justify-between px-2 h-9 flex-shrink-0 gap-2">
      <div class="flex items-center min-w-0">
        <button type="button" class="flex items-center gap-1.5 px-2 h-7 rounded text-[12px] font-medium terminal-tab-active" @click="toggleVisible">
          <Terminal class="w-3.5 h-3.5" :stroke-width="1.5" />
          <span>执行日志</span>
          <span v-if="runningCount" class="text-[10px] terminal-status-running tabular-nums">({{ runningCount }})</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-1 px-2 h-7 rounded text-[12px] sb-text-muted hover:sb-text-secondary transition-colors ml-1"
          @click="toggleVisible"
        >
          <component :is="isExpanded ? ChevronDown : ChevronUp" class="w-3.5 h-3.5" :stroke-width="1.5" />
        </button>
        <span v-if="isExpanded && activeSession" class="terminal-header-subtitle ml-2 text-[11px] truncate hidden md:inline">
          {{ activeProgressSummary || activeSession.scriptName }}
        </span>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <template v-if="isExpanded">
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="缩小" @click="zoomOut">
            <Minus class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <span class="text-[10px] sb-text-faint w-7 text-center tabular-nums">{{ fontSize }}px</span>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="放大" @click="zoomIn">
            <Plus class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="清除当前终端" @click="clearLogs()">
            <Eraser class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <button
            v-if="isMulti && (sessions?.length ?? 0) > 0"
            type="button"
            class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:text-red-400 sb-bg-hover transition-colors"
            title="关闭全部终端"
            @click="closeAllSessions"
          >
            <ListX class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="弹出独立窗口" @click="emit('popout')">
            <ExternalLink class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="收起" @click="hide">
            <Minimize2 class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
        </template>
        <button v-else type="button" class="w-7 h-7 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover" title="展开" @click="expand">
          <Maximize2 class="w-3.5 h-3.5" :stroke-width="1.5" />
        </button>
      </div>
    </header>

    <div
      v-if="!standalone && isExpanded"
      class="terminal-resize-handle relative z-[2]"
      title="拖拽调节高度，双击恢复默认"
      @mousedown="onPanelResizeStart"
      @dblclick="resetPanelHeight"
    />

    <!-- 主体：日志区 + 右侧终端列表 -->
    <div
      v-show="isExpanded || standalone"
      ref="terminalBodyRef"
      class="terminal-body flex min-h-0 flex-1 overflow-hidden border-t border-transparent"
      :class="standalone ? 'border-t-0' : ''"
      :style="panelBodyStyle"
    >
      <!-- 日志输出 -->
      <div class="flex flex-col flex-1 min-w-0 min-h-0">
        <ScriptRunProgressPanel v-if="activeRunProgress" :progress="activeRunProgress" />
        <div
          ref="logBodyRef"
          class="terminal-log flex-1 min-w-0 min-h-0 font-mono leading-relaxed overflow-y-auto px-4 py-2"
          :style="{ fontSize: `${fontSize}px` }"
          @scroll="onScroll"
        >
          <p v-if="!activeLogs.length" class="terminal-log-message py-2 opacity-70">
            {{ activeSession ? '等待输出…' : '暂无日志，运行脚本后将在此显示输出' }}
          </p>
          <p v-for="(log, i) in activeLogs" :key="`${activeSessionId}-${log.ts}-${i}`" class="py-0.5 whitespace-pre-wrap break-all">
            <span class="terminal-log-time">{{ formatLogTime(log.ts) }}</span>
            <span class="ml-1.5" :class="logLevelClass(log.level)">{{ log.level }}</span>
            <span class="ml-1.5" :class="logMessageClass(log.message)">{{ log.message }}</span>
          </p>
        </div>
      </div>

      <!-- 右侧终端列表（VS Code 风格） -->
      <div v-if="isMulti" class="flex flex-shrink-0 min-h-0 self-stretch">
        <div
          class="terminal-sidebar-resize-handle"
          title="拖拽调节宽度，双击恢复默认"
          @mousedown="onSidebarResizeStart"
          @dblclick="resetSidebarWidth"
        />
        <aside
          class="terminal-sidebar flex flex-col min-h-0 overflow-hidden"
          :style="{ width: `${sidebarWidth}px` }"
        >
        <div class="flex items-center justify-between px-2 py-1.5 border-b border-[var(--sb-border-subtle)] flex-shrink-0">
          <span class="text-[10px] sb-text-faint uppercase tracking-wider">会话</span>
          <button
            type="button"
            class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] sb-text-muted hover:text-red-400 hover:sb-bg-hover transition-colors"
            title="关闭全部终端"
            @click="closeAllSessions"
          >
            <ListX class="w-3 h-3" :stroke-width="1.5" />
            <span>全部关闭</span>
          </button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
        <div
          v-for="session in sessions"
          :key="session.sessionId"
          class="terminal-item group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer border-l-2 transition-colors"
          :class="session.sessionId === activeSessionId
            ? 'is-active border-[var(--sb-accent-solid)]'
            : 'border-transparent'"
          @click="selectSession(session.sessionId)"
        >
          <Terminal class="w-3.5 h-3.5 flex-shrink-0" :class="sessionStatusIconClass(session.status)" :stroke-width="1.5" />
          <span class="flex-1 min-w-0 text-[11px] truncate" :class="session.sessionId === activeSessionId ? 'sb-text-primary' : 'sb-text-muted'">
            {{ session.scriptName }}
          </span>
          <Loader2
            v-if="session.status === 'running'"
            class="w-3 h-3 terminal-status-running animate-spin flex-shrink-0"
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
        </div>
        </aside>
      </div>
    </div>
  </section>
</template>
