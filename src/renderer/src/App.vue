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
import BatchRunPanel from './components/BatchRunPanel.vue'
import RunResultModal from './components/RunResultModal.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmDialogHost from './components/ConfirmDialogHost.vue'
import PromptDialogHost from './components/PromptDialogHost.vue'
import ScratchpadPanel from './components/ScratchpadPanel.vue'
import ExecutableEntryPickerModal from './components/ExecutableEntryPickerModal.vue'
import HubPluginCenterPanel from './components/HubPluginCenterPanel.vue'
import WorkspaceShell from './components/WorkspaceShell.vue'
import WorkspaceNavigation from './components/WorkspaceNavigation.vue'
import WorkspaceContextSidebar from './components/WorkspaceContextSidebar.vue'
import AiProjectWorkspace from './components/AiProjectWorkspace.vue'
import { useWorkspaceNavigation, type WorkspaceView } from './composables/useWorkspaceNavigation'
import { askConfirm } from './composables/useConfirmDialog'
import { useScratchpad } from './composables/useScratchpad'
import { useToast } from './composables/useToast'
import { startInsertFocusTracking } from './utils/insert-focused-field'

const {
  scripts,
  filteredScripts,
  pagedScripts,
  listPage,
  listTotalPages,
  listPageSize,
  stats,
  navItems,
  categories,
  categoryDefinitions,
  searchQuery,
  activeCategoryKey,
  breadcrumb,
  listFilter,
  hasActiveListFilter,
  sortBy,
  sortOrder,
  showCategoryManager,
  executablePickerOpen,
  executableCandidates,
  refresh,
  importScript,
  importFromPath,
  resolveExecutableEntry,
  deleteScript,
  toggleStar,
  toggleArchive,
  setNavFilter,
  setCategoryFilter,
  setListFilter,
  resetListFilter,
  setSortBy,
  setSortOrder,
  setListPage,
  openCategoryManager,
  closeCategoryManager,
  openSettings,
  openDevGuide,
  closeDevGuide,
  openExecutionHistory,
  closeExecutionHistory,
  closeSettings
} = useScriptStore()

const { pushToast } = useToast()

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
const showBatchRun = ref(false)
const batchScriptId = ref<string | null>(null)
type DetailPanelTab = 'detail' | 'params' | 'edit' | 'log' | 'config' | 'history' | 'docs'
const detailInitialTab = ref<DetailPanelTab>('detail')
const detailTabRequest = ref(0)
const environmentRevision = ref(0)
const logConsoleMode = ref<LogConsoleDisplayMode>('hidden')
const logConsoleActiveSessionId = ref<string | undefined>()
const trackedSessionIds = ref<string[]>([])
const terminalDetached = ref(false)
const dropImporting = ref(false)
const workspaceNavigation = useWorkspaceNavigation()
const previousWorkspaceView = ref<WorkspaceView>('projects')
const workspaceTitles: Record<WorkspaceView, string> = {
  projects: '项目',
  scripts: '脚本',
  history: '运行历史',
  hub: 'Autoforge Hub',
  guide: '开发指南',
  settings: '设置'
}
const workspaceBreadcrumb = computed(() => workspaceNavigation.state.view === 'scripts'
  ? breadcrumb.value
  : workspaceTitles[workspaceNavigation.state.view])

function navigateWorkspace(view: WorkspaceView): void {
  const currentView = workspaceNavigation.state.view
  const modalViews: WorkspaceView[] = ['history', 'hub', 'guide', 'settings']
  if (modalViews.includes(view)) {
    if (!modalViews.includes(currentView)) previousWorkspaceView.value = currentView
    workspaceNavigation.navigate(view)
    if (view === 'settings') openSettings()
    if (view === 'guide') openDevGuide()
    if (view === 'history') openExecutionHistory()
    return
  }
  closeSettings()
  closeDevGuide()
  closeExecutionHistory()
  workspaceNavigation.navigate(view)
}

function closeWorkspaceSettings(): void {
  closeSettings()
  if (workspaceNavigation.state.view === 'settings') workspaceNavigation.navigate(previousWorkspaceView.value)
}

function closeWorkspaceGuide(): void {
  closeDevGuide()
  if (workspaceNavigation.state.view === 'guide') workspaceNavigation.navigate(previousWorkspaceView.value)
}

function closeWorkspaceHistory(): void {
  closeExecutionHistory()
  if (workspaceNavigation.state.view === 'history') workspaceNavigation.navigate(previousWorkspaceView.value)
}

function closeWorkspaceHub(): void {
  if (workspaceNavigation.state.view === 'hub') workspaceNavigation.navigate(previousWorkspaceView.value)
}

function resizeWorkspace(widths: Parameters<typeof workspaceNavigation.setWidths>[0]): void {
  workspaceNavigation.setWidths(widths)
}

const selectedScript = computed(
  () => filteredScripts.value.find((s) => s.id === selectedScriptId.value) ?? null
)

const batchScript = computed(
  () =>
    filteredScripts.value.find((s) => s.id === batchScriptId.value) ??
    scripts.value.find((s) => s.id === batchScriptId.value) ??
    null
)

function openBatchRun(scriptId: string): void {
  batchScriptId.value = scriptId
  showBatchRun.value = true
}

function closeBatchRun(): void {
  showBatchRun.value = false
  batchScriptId.value = null
}

function onBatchStarted(sessionIds: string[]): void {
  for (const id of sessionIds) trackSession(id)
  openLogConsoleNormal()
}

function scriptNameForSession(sessionId: string): string {
  const session = runner.sessions.value.find((s) => s.id === sessionId)
  if (!session) return sessionId.slice(0, 8)
  if (session.instanceName?.trim()) return session.instanceName.trim()
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

function navigateDetailTab(tab: DetailPanelTab): void {
  detailInitialTab.value = tab
  detailTabRequest.value += 1
}

function markEnvironmentsChanged(): void {
  environmentRevision.value += 1
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
  workspaceNavigation.navigate('scripts')
  selectedScriptId.value = script.id
  workspaceNavigation.setActiveScript(script.id)
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
  workspaceNavigation.navigate('scripts')
  const script = filteredScripts.value.find((s) => s.id === scriptId)
  if (script?.language !== 'executable') {
    const confirmed = await askConfirm({
      title: '运行脚本',
      message: `确定运行「${script?.name ?? '此脚本'}」？`,
      confirmLabel: '运行'
    })
    if (!confirmed) return
  }

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

async function handleDroppedImport(sourcePath: string): Promise<void> {
  workspaceNavigation.navigate('scripts')
  const categoryKey = activeCategoryKey.value
  dropImporting.value = true
  try {
    const imported = await importFromPath(sourcePath, {
      categoryKey: categoryKey ?? 'local',
      onBeforeExecutableSelection: () => {
        dropImporting.value = false
      }
    })
    if (!imported) return

    setNavFilter('all')
    searchQuery.value = ''
    if (categoryKey) {
      setListFilter({
        status: 'all',
        categoryKey,
        starredOnly: false,
        scheduledOnly: false
      })
    } else {
      resetListFilter()
    }

    const importedIndex = filteredScripts.value.findIndex((script) => script.id === imported.id)
    if (importedIndex >= 0) {
      setListPage(Math.floor(importedIndex / listPageSize.value) + 1)
    }
    selectScript(imported)
  } finally {
    dropImporting.value = false
  }
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

function handleDeleteLogs(sessionId: string, logId: string): void {
  runner.removeLogs(sessionId, [logId])
}

function handleDeleteManyLogs(sessionId: string, logIds: string[]): void {
  runner.removeLogs(sessionId, logIds)
}

async function handleDelete(scriptId: string): Promise<void> {
  const confirmed = await askConfirm({
    title: '删除脚本',
    message: '确定删除此脚本？删除后工作区文件将被永久移除，此操作不可撤销。',
    confirmLabel: '删除',
    variant: 'danger'
  })
  if (!confirmed) return
  const ok = await deleteScript(scriptId)
  if (!ok) return
  if (selectedScriptId.value === scriptId) {
    selectedScriptId.value = null
  }
  detailVisible.value = false
}

async function handleOpenDir(script: ScriptItem): Promise<void> {
  await window.autoforge.system.openPath(script.workspacePath)
}

function onExampleImported(): void {
  closeDevGuide()
  workspaceNavigation.navigate('scripts')
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
let unsubHubInstalled: (() => void) | undefined
let stopFocusTracking: (() => void) | undefined
let offWindowMode: (() => void) | undefined

const { dismiss: dismissScratchpad } = useScratchpad()

onMounted(() => {
  stopFocusTracking = startInsertFocusTracking()
  if (workspaceNavigation.state.view === 'settings') openSettings()
  if (workspaceNavigation.state.view === 'guide') openDevGuide()
  if (workspaceNavigation.state.view === 'history') openExecutionHistory()
  offWindowMode = window.api.onModeChange((mode) => {
    if (!mode.visible) dismissScratchpad()
  })
  document.addEventListener('visibilitychange', onDocumentVisibilityChange)

  unsubTerminalClosed = window.autoforge.terminal.onClosed(() => {
    terminalDetached.value = false
    if (trackedSessionIds.value.length) {
      logConsoleMode.value = 'normal'
    }
  })
  void window.autoforge.terminal.isOpen().then((open) => {
    terminalDetached.value = open
  })

  unsubHubInstalled = window.autoforge.onHubScriptInstalled(async ({ scriptId, name, status }) => {
    workspaceNavigation.navigate('scripts')
    await refresh()
    const script = scripts.value.find((s) => s.id === scriptId)
    if (script) {
      selectScript(script, 'detail')
    } else {
      selectedScriptId.value = scriptId
      navigateDetailTab('detail')
      detailVisible.value = true
    }
    pushToast({
      type: 'success',
      title: status === 'updated' ? 'Hub 脚本已更新' : '已从 Hub 添加',
      message: name || (status === 'updated' ? '脚本已更新' : '脚本已导入')
    })
  })
})

function onDocumentVisibilityChange(): void {
  if (document.hidden) dismissScratchpad()
}

onUnmounted(() => {
  unsubTerminalClosed?.()
  unsubHubInstalled?.()
  stopFocusTracking?.()
  offWindowMode?.()
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
})
</script>

<template>
  <div v-file-path-drop class="flex flex-col h-full">
    <TitleBar :breadcrumb="workspaceBreadcrumb" />
    <WorkspaceShell
      class="flex-1 min-h-0"
      :layout="workspaceNavigation.state"
      @resize="resizeWorkspace"
      @close-inspector="workspaceNavigation.toggleInspector()"
    >
      <template #navigation>
        <WorkspaceNavigation
          :view="workspaceNavigation.state.view"
          :collapsed="workspaceNavigation.state.navCollapsed"
          @navigate="navigateWorkspace"
          @toggle-collapsed="workspaceNavigation.toggleNav()"
          @toggle-context="workspaceNavigation.toggleContext()"
        />
      </template>
      <template v-if="workspaceNavigation.state.view === 'scripts'" #context>
        <WorkspaceContextSidebar
          :collapsed="workspaceNavigation.state.contextCollapsed"
          :width="workspaceNavigation.state.contextWidth"
          @toggle="workspaceNavigation.toggleContext()"
        >
          <template #title>{{ workspaceTitles[workspaceNavigation.state.view] }}</template>
          <Sidebar
            v-if="workspaceNavigation.state.view === 'scripts'"
            :nav-items="navItems"
            :categories="categories"
            :active-category-key="listFilter.categoryKey"
            v-model:search-query="searchQuery"
            @navigate="(filter) => { workspaceNavigation.navigate('scripts'); setNavFilter(filter) }"
            @category="setCategoryFilter"
            @manage-categories="openCategoryManager"
            @import="importScript"
            @categories-changed="refresh()"
          />
        </WorkspaceContextSidebar>
      </template>

      <KeepAlive>
        <AiProjectWorkspace
          v-if="workspaceNavigation.state.view === 'projects'"
          :inspector-open="workspaceNavigation.state.inspectorOpen"
          :inspector-width="workspaceNavigation.state.inspectorWidth"
          :active-project-id="workspaceNavigation.state.activeProjectId"
          @toggle-inspector="workspaceNavigation.toggleInspector()"
          @resize-inspector="workspaceNavigation.setWidths({ inspectorWidth: $event })"
          @active-project-change="workspaceNavigation.setActiveProject"
        />
      </KeepAlive>
      <div v-if="workspaceNavigation.state.view === 'scripts'" class="flex flex-1 min-h-0 min-w-0 overflow-x-auto">
        <div class="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
          <MainContent
            :scripts="pagedScripts"
            :total-scripts="filteredScripts.length"
            :list-page="listPage"
            :list-total-pages="listTotalPages"
            :title="breadcrumb"
            :selected-id="selectedScriptId ?? undefined"
            :list-filter="listFilter"
            :has-active-list-filter="hasActiveListFilter"
            :category-definitions="categoryDefinitions"
            :sort-by="sortBy"
            :sort-order="sortOrder"
            :drop-importing="dropImporting"
            @select="selectScript($event)"
            @import="importScript"
            @import-path="handleDroppedImport"
            @start="(id) => void handleStart(id)"
            @stop="(id) => runner.stop(id).then(() => refresh())"
            @restart="(id) => runner.restart(id).then(() => refresh())"
            @batch-run="openBatchRun"
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
            @update:sort-order="setSortOrder"
            @update:list-page="setListPage"
          />
          <LogConsole
            v-if="!terminalDetached"
            v-model:display-mode="logConsoleMode"
            v-model:active-session-id="logConsoleActiveSessionId"
            :sessions="logConsoleSessions"
            @clear="handleClearLogs"
            @delete="handleDeleteLogs"
            @delete-many="handleDeleteManyLogs"
            @close="handleCloseTerminal"
            @close-all="handleCloseAllTerminals"
            @stop="(id) => runner.stop(id).then(() => refresh())"
            @popout="handlePopoutTerminal"
          />
          <div v-else class="flex-shrink-0 border-t sb-border-subtle sb-bg-panel flex items-center justify-between px-3 h-9">
            <span class="text-[12px] sb-text-muted">执行日志已在独立窗口中运行</span>
            <button type="button" class="text-[12px] sb-text-primary" @click="handleDockTerminal">收回主窗口</button>
          </div>
        </div>
        <DetailPanel
          v-if="detailVisible && selectedScript"
          :script="selectedScript"
          :runner="runner"
          :initial-tab="detailInitialTab"
          :tab-request="detailTabRequest"
          :environment-revision="environmentRevision"
          :category-definitions="categoryDefinitions"
          @close="detailVisible = false"
          @refresh="refresh()"
          @delete="handleDelete(selectedScript.id)"
          @keep-script="selectedScriptId = $event"
          @view-log="openLogConsoleNormal()"
          @navigate-tab="navigateDetailTab"
          @open-batch="openBatchRun(selectedScript.id)"
        />
      </div>
      <ExecutionHistoryPanel
        v-else-if="workspaceNavigation.state.view === 'history'"
        :open="true"
        :inline="true"
        @close="closeWorkspaceHistory"
      />
      <HubPluginCenterPanel
        v-else-if="workspaceNavigation.state.view === 'hub'"
        :open="true"
        :inline="true"
        @close="closeWorkspaceHub"
      />
      <DevGuidePanel
        v-else-if="workspaceNavigation.state.view === 'guide'"
        :open="true"
        :inline="true"
        @close="closeWorkspaceGuide"
        @imported="onExampleImported"
      />
      <SettingsPanel
        v-else-if="workspaceNavigation.state.view === 'settings'"
        :open="true"
        :inline="true"
        @close="closeWorkspaceSettings"
        @environments-changed="markEnvironmentsChanged"
      />
    </WorkspaceShell>

    <CategoryManagerModal
      :open="showCategoryManager"
      :categories="categoryDefinitions"
      @close="closeCategoryManager"
      @refresh="refresh()"
    />
    <BatchRunPanel
      :open="showBatchRun"
      :script="batchScript"
      :runner="runner"
      @close="closeBatchRun"
      @refresh="refresh()"
      @started="onBatchStarted"
    />
    <StatusBar :running-count="stats.running" />
    <RunResultModal
      :open="runResultModalOpen"
      :script="runResultModalScript"
      :session="runResultModalSession"
      @close="closeRunResultModal"
    />
    <ExecutableEntryPickerModal
      :open="executablePickerOpen"
      :candidates="executableCandidates"
      @confirm="resolveExecutableEntry($event)"
      @cancel="resolveExecutableEntry(null)"
    />
    <ToastHost />
    <ConfirmDialogHost />
    <PromptDialogHost />
    <ScratchpadPanel />
  </div>
</template>

<style scoped>
.workspace-view-placeholder {
  display: grid;
  flex: 1;
  min-width: 0;
  min-height: 0;
  place-items: center;
  background: var(--sb-bg-base);
}

.workspace-view-placeholder h1 {
  color: var(--sb-text-primary);
  font-size: 22px;
  font-weight: 600;
}

</style>
