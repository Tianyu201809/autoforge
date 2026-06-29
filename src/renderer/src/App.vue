<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ScriptItem } from '../../shared/types/script'
import { useScriptStore } from './composables/useScriptStore'
import { useScriptRunner } from './composables/useScriptRunner'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import MainContent from './components/MainContent.vue'
import DetailPanel from './components/DetailPanel.vue'
import LogConsole from './components/LogConsole.vue'
import type { LogConsoleDisplayMode, LogConsoleSession } from './components/LogConsole.vue'
import StatusBar from './components/StatusBar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import DevGuidePanel from './components/DevGuidePanel.vue'
import ExecutionHistoryPanel from './components/ExecutionHistoryPanel.vue'
import CategoryManagerModal from './components/CategoryManagerModal.vue'
import RunResultModal from './components/RunResultModal.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmDialogHost from './components/ConfirmDialogHost.vue'
import PromptDialogHost from './components/PromptDialogHost.vue'
import { askConfirm } from './composables/useConfirmDialog'

const {
  filteredScripts,
  stats,
  navItems,
  categories,
  categoryDefinitions,
  searchQuery,
  breadcrumb,
  listFilter,
  hasActiveListFilter,
  sortBy,
  showSettings,
  showDevGuide,
  showExecutionHistory,
  showCategoryManager,
  refresh,
  importScript,
  deleteScript,
  toggleStar,
  toggleArchive,
  setNavFilter,
  setCategoryFilter,
  setListFilter,
  resetListFilter,
  setSortBy,
  openCategoryManager,
  closeCategoryManager,
  openSettings,
  openDevGuide,
  closeDevGuide,
  openExecutionHistory,
  closeExecutionHistory,
  closeSettings
} = useScriptStore()

const runner = useScriptRunner(
  () => {
    void refresh()
  },
  (scriptId) => filteredScripts.value.find((s) => s.id === scriptId)?.name,
  (scriptId, sessionId) => openRunResultModal(scriptId, sessionId)
)

const runResultModalOpen = ref(false)
const runResultModalScriptId = ref<string | null>(null)
const runResultModalSessionId = ref<string | null>(null)

const runResultModalScript = computed(
  () => filteredScripts.value.find((s) => s.id === runResultModalScriptId.value) ?? null
)

const runResultModalSession = computed(() => {
  const sessionId = runResultModalSessionId.value
  if (sessionId) {
    return runner.sessions.value.find((s) => s.id === sessionId) ?? null
  }
  const scriptId = runResultModalScriptId.value
  if (!scriptId) return null
  return runner.lastSuccessSessionForScript(scriptId) ?? null
})

const selectedScriptId = ref<string | null>(null)
const detailVisible = ref(true)
const detailInitialTab = ref<'detail' | 'params' | 'edit' | 'log' | 'config' | 'history'>('detail')
const detailTabRequest = ref(0)
const logConsoleMode = ref<LogConsoleDisplayMode>('hidden')
const logConsoleActiveSessionId = ref<string | undefined>()
const trackedSessionIds = ref<string[]>([])
const terminalDetached = ref(false)

const selectedScript = computed(
  () => filteredScripts.value.find((s) => s.id === selectedScriptId.value) ?? null
)

function scriptNameForSession(sessionId: string): string {
  const session = runner.sessions.value.find((s) => s.id === sessionId)
  if (!session) return sessionId.slice(0, 8)
  return filteredScripts.value.find((s) => s.id === session.scriptId)?.name ?? session.scriptId
}

function openLogConsoleNormal(): void {
  logConsoleMode.value = 'normal'
}

function trackSession(sessionId: string): void {
  if (!trackedSessionIds.value.includes(sessionId)) {
    trackedSessionIds.value = [...trackedSessionIds.value, sessionId]
  }
}

const logConsoleSessions = computed<LogConsoleSession[]>(() =>
  trackedSessionIds.value
    .map((sessionId) => {
      const session = runner.sessions.value.find((s) => s.id === sessionId)
      return {
        sessionId,
        scriptName: scriptNameForSession(sessionId),
        logs: runner.logsForSession(sessionId),
        status: session?.status,
        runProgress: session?.runProgress
      }
    })
    .sort((a, b) => {
      const rank = (status?: string) => (status === 'running' ? 0 : 1)
      return rank(a.status) - rank(b.status)
    })
)

watch(
  filteredScripts,
  (list) => {
    if (!list.length) {
      selectedScriptId.value = null
      return
    }
    if (!selectedScriptId.value || !list.find((s) => s.id === selectedScriptId.value)) {
      selectedScriptId.value = list[0].id
    }
  },
  { immediate: true }
)

watch(
  () => runner.sessions.value,
  (sessions) => {
    for (const session of sessions) {
      if (session.status === 'running') {
        trackSession(session.id)
      }
    }
  },
  { deep: true, immediate: true }
)

watch(
  () => runner.activeSession.value,
  (session) => {
    if (session) {
      trackSession(session.id)
      logConsoleActiveSessionId.value = session.id
      openLogConsoleNormal()
    }
  }
)

function navigateDetailTab(tab: 'detail' | 'params' | 'edit' | 'log' | 'config' | 'history'): void {
  detailInitialTab.value = tab
  detailTabRequest.value += 1
}

function openRunResultModal(scriptId: string, sessionId?: string): void {
  runResultModalScriptId.value = scriptId
  runResultModalSessionId.value =
    sessionId ?? runner.lastSuccessSessionForScript(scriptId)?.id ?? null
  runResultModalOpen.value = true
}

function closeRunResultModal(): void {
  runResultModalOpen.value = false
  runResultModalScriptId.value = null
  runResultModalSessionId.value = null
}

function selectScript(script: ScriptItem, tab: 'detail' | 'params' | 'edit' | 'log' | 'config' = 'detail'): void {
  selectedScriptId.value = script.id
  navigateDetailTab(tab)
  detailVisible.value = true
}

function viewRunResult(scriptId: string, sessionId?: string): void {
  openRunResultModal(scriptId, sessionId)
}

function viewScriptLog(script: ScriptItem): void {
  selectedScriptId.value = script.id
  navigateDetailTab('log')
  detailVisible.value = true
  const sessionId = script.activeSessionId ?? runner.sessions.value.find((s) => s.scriptId === script.id)?.id
  if (sessionId) {
    trackSession(sessionId)
    logConsoleActiveSessionId.value = sessionId
  }
  openLogConsoleNormal()
}

async function handleStart(scriptId: string): Promise<void> {
  selectedScriptId.value = scriptId
  navigateDetailTab('params')
  detailVisible.value = true
  const session = await runner.start(scriptId)
  if (session) {
    trackSession(session.id)
    logConsoleActiveSessionId.value = session.id
    openLogConsoleNormal()
  }
  await refresh()
}

function handleCloseTerminal(sessionId: string): void {
  trackedSessionIds.value = trackedSessionIds.value.filter((id) => id !== sessionId)
  runner.clearLogs(sessionId)
  if (!trackedSessionIds.value.length) {
    logConsoleActiveSessionId.value = undefined
    logConsoleMode.value = 'hidden'
  }
}

function handleCloseAllTerminals(): void {
  for (const id of trackedSessionIds.value) {
    runner.clearLogs(id)
  }
  trackedSessionIds.value = []
  logConsoleActiveSessionId.value = undefined
  logConsoleMode.value = 'hidden'
}

function handleClearLogs(sessionId?: string): void {
  if (sessionId) {
    runner.clearLogs(sessionId)
    return
  }
  for (const id of trackedSessionIds.value) {
    runner.clearLogs(id)
  }
}

async function handleDelete(scriptId: string): Promise<void> {
  const confirmed = await askConfirm({
    title: '删除脚本',
    message: '确定删除此脚本？删除后工作区文件将被永久移除，此操作不可撤销。',
    confirmLabel: '删除',
    variant: 'danger'
  })
  if (!confirmed) return
  await deleteScript(scriptId)
  detailVisible.value = false
}

async function handleOpenDir(script: ScriptItem): Promise<void> {
  await window.autoforge.system.openPath(script.workspacePath)
}

function onExampleImported(): void {
  closeDevGuide()
  void refresh()
}

async function handlePopoutTerminal(): Promise<void> {
  await window.autoforge.terminal.open()
  terminalDetached.value = true
  logConsoleMode.value = 'hidden'
}

async function handleDockTerminal(): Promise<void> {
  await window.autoforge.terminal.close()
  terminalDetached.value = false
  if (trackedSessionIds.value.length) {
    logConsoleMode.value = 'normal'
  }
}

let unsubTerminalClosed: (() => void) | undefined

onMounted(() => {
  unsubTerminalClosed = window.autoforge.terminal.onClosed(() => {
    terminalDetached.value = false
    if (trackedSessionIds.value.length) {
      logConsoleMode.value = 'normal'
    }
  })
  void window.autoforge.terminal.isOpen().then((open) => {
    terminalDetached.value = open
  })
})

onUnmounted(() => {
  unsubTerminalClosed?.()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <TitleBar :breadcrumb="breadcrumb" />
    <div class="flex flex-1 min-h-0">
      <Sidebar
        :nav-items="navItems"
        :categories="categories"
        :active-category-key="listFilter.categoryKey"
        v-model:search-query="searchQuery"
        @navigate="setNavFilter"
        @category="setCategoryFilter"
        @manage-categories="openCategoryManager"
        @import="importScript"
        @settings="openSettings"
        @dev-guide="openDevGuide"
        @execution-history="openExecutionHistory"
      />
      <CategoryManagerModal
        :open="showCategoryManager"
        :categories="categoryDefinitions"
        @close="closeCategoryManager"
        @refresh="refresh()"
      />
      <DevGuidePanel v-if="showDevGuide" @close="closeDevGuide" @imported="onExampleImported" />
      <ExecutionHistoryPanel v-else-if="showExecutionHistory" @close="closeExecutionHistory" />
      <SettingsPanel v-else-if="showSettings" @close="closeSettings" />
      <template v-else>
        <div class="flex flex-1 min-h-0 min-w-0 overflow-x-auto">
          <div class="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
            <MainContent
              :scripts="filteredScripts"
              :stats="stats"
              :title="breadcrumb"
              :selected-id="selectedScriptId ?? undefined"
              :list-filter="listFilter"
              :has-active-list-filter="hasActiveListFilter"
              :category-definitions="categoryDefinitions"
              :sort-by="sortBy"
              @select="selectScript($event)"
              @import="importScript"
              @imported="refresh()"
              @start="(id) => void handleStart(id)"
              @stop="(id) => runner.stop(id).then(() => refresh())"
              @restart="(id) => runner.restart(id).then(() => refresh())"
              @toggle-star="(id) => toggleStar(id)"
              @edit="selectScript($event, 'edit')"
              @archive="(id) => toggleArchive(id)"
              @delete="handleDelete"
              @open-dir="handleOpenDir"
              @view-log="viewScriptLog"
              @config="selectScript($event, 'config')"
              @category-changed="refresh()"
              @update:list-filter="setListFilter"
              @reset-list-filter="resetListFilter"
              @update:sort-by="setSortBy"
              @open-history="openExecutionHistory"
            />
            <LogConsole
              v-if="!terminalDetached"
              v-model:display-mode="logConsoleMode"
              v-model:active-session-id="logConsoleActiveSessionId"
              :sessions="logConsoleSessions"
              @clear="handleClearLogs"
              @close="handleCloseTerminal"
              @close-all="handleCloseAllTerminals"
              @popout="handlePopoutTerminal"
            />
            <div
              v-else
              class="flex-shrink-0 border-t sb-border-subtle sb-bg-panel flex items-center justify-between px-3 h-9"
            >
              <span class="text-[12px] sb-text-muted">终端已在独立窗口中运行</span>
              <button
                type="button"
                class="text-[12px] sb-text-primary hover:text-[var(--sb-accent-solid)] transition-colors"
                @click="handleDockTerminal"
              >
                收回主窗口
              </button>
            </div>
          </div>
          <DetailPanel
            v-if="detailVisible && selectedScript"
            :script="selectedScript"
            :runner="runner"
            :initial-tab="detailInitialTab"
            :tab-request="detailTabRequest"
            :category-definitions="categoryDefinitions"
            @close="detailVisible = false"
            @refresh="refresh()"
            @delete="handleDelete(selectedScript.id)"
            @keep-script="selectedScriptId = $event"
            @view-log="openLogConsoleNormal()"
            @navigate-tab="navigateDetailTab"
          />
        </div>
      </template>
    </div>
    <StatusBar :running-count="stats.running" />
    <RunResultModal
      :open="runResultModalOpen"
      :script="runResultModalScript"
      :session="runResultModalSession"
      @close="closeRunResultModal"
    />
    <ToastHost />
    <ConfirmDialogHost />
    <PromptDialogHost />
  </div>
</template>
