<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  Loader2,
  Package,
  Play,
  Pencil,
  RotateCw,
  Save,
  Square,
  Trash2,
  X
} from 'lucide-vue-next'
import { normalizeCronExpression } from '../../../shared/cron-schedule'
import { SCRIPT_ICON_OPTIONS } from '../../../shared/script-icons'
import type { EnvironmentProfile, ScriptItem } from '../../../shared/types/script'
import type { ScriptIcon } from '../../../shared/script-contract'
import type { useScriptRunner } from '../composables/useScriptRunner'
import { resolveScriptIcon } from '../lib/script-icon-map'
import { renameScript } from '../composables/useScriptRename'
import CronScheduleBuilder from './CronScheduleBuilder.vue'
import LogConsole from './LogConsole.vue'
import RunResultViewer from './RunResultViewer.vue'
import ScriptRunHistoryPanel from './ScriptRunHistoryPanel.vue'
import ScriptRunProgressPanel from './ScriptRunProgressPanel.vue'
import { formatScriptRunProgressSummary } from '../../../shared/script-progress'
import CodeEditor from './CodeEditor.vue'
import SchemaValueField from './SchemaValueField.vue'
import ScriptWorkspaceSidebar from './ScriptWorkspaceSidebar.vue'
import { useScriptFileEditor } from '../composables/useScriptFileEditor'
import { MANIFEST_FILENAME } from '../../../shared/script-contract'
import { extractRunResultOutputDir } from '../../../shared/run-result'
import { parseParamAttachments } from '../../../shared/param-attachments'
import { defaultSchemaValue } from '../../../shared/schema-values'
import { promptUnsavedFiles } from '../utils/unsaved-files-prompt'

type DetailPanelTab = 'detail' | 'params' | 'edit' | 'log' | 'config' | 'history'

const props = defineProps<{
  script: ScriptItem
  runner: ReturnType<typeof useScriptRunner>
  initialTab?: DetailPanelTab
  tabRequest?: number
  categoryDefinitions?: import('../../../shared/types/script').CategoryDefinition[]
}>()

const PANEL_WIDTH_KEY = 'autoforge-detail-panel-width'
const RUN_SPLIT_KEY = 'autoforge-run-split-top-pct'
const RUN_SPLIT_MIN = 25
const RUN_SPLIT_MAX = 75
const RUN_SPLIT_DEFAULT = 45
const SIDEBAR_WIDTH = 224
const MAIN_MIN_WIDTH = 480
const MIN_WIDTH = 320
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 384

const panelWidth = ref(DEFAULT_WIDTH)
const resizing = ref(false)
const runSplitTopPct = ref(RUN_SPLIT_DEFAULT)
const runSplitResizing = ref(false)
const viewingSessionId = ref<string | null>(null)
const runResultSectionExpanded = ref(true)

function getMaxPanelWidth(): number {
  return Math.min(
    MAX_WIDTH,
    Math.floor(window.innerWidth * 0.55),
    window.innerWidth - SIDEBAR_WIDTH - MAIN_MIN_WIDTH
  )
}

function clampWidth(width: number): number {
  const max = Math.max(MIN_WIDTH, getMaxPanelWidth())
  return Math.min(max, Math.max(MIN_WIDTH, width))
}

function onWindowResize(): void {
  panelWidth.value = clampWidth(panelWidth.value)
}

function loadPanelWidth(): void {
  const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  panelWidth.value = clampWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_WIDTH)
}

function onResizeStart(e: MouseEvent): void {
  e.preventDefault()
  resizing.value = true
  const startX = e.clientX
  const startWidth = panelWidth.value

  const onMove = (ev: MouseEvent): void => {
    panelWidth.value = clampWidth(startWidth + (startX - ev.clientX))
  }

  const onUp = (): void => {
    resizing.value = false
    localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth.value))
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

function onResizeReset(): void {
  panelWidth.value = DEFAULT_WIDTH
  localStorage.setItem(PANEL_WIDTH_KEY, String(DEFAULT_WIDTH))
}

function loadRunSplitRatio(): void {
  const stored = Number(localStorage.getItem(RUN_SPLIT_KEY))
  runSplitTopPct.value =
    Number.isFinite(stored) && stored >= RUN_SPLIT_MIN && stored <= RUN_SPLIT_MAX
      ? stored
      : RUN_SPLIT_DEFAULT
}

function clampRunSplitPct(pct: number): number {
  return Math.min(RUN_SPLIT_MAX, Math.max(RUN_SPLIT_MIN, pct))
}

function onRunSplitStart(e: MouseEvent): void {
  e.preventDefault()
  runSplitResizing.value = true
  const container = (e.currentTarget as HTMLElement).parentElement
  if (!container) return
  const rect = container.getBoundingClientRect()
  const startY = e.clientY
  const startPct = runSplitTopPct.value

  const onMove = (ev: MouseEvent): void => {
    const deltaPct = ((ev.clientY - startY) / rect.height) * 100
    runSplitTopPct.value = clampRunSplitPct(startPct + deltaPct)
  }

  const onUp = (): void => {
    runSplitResizing.value = false
    localStorage.setItem(RUN_SPLIT_KEY, String(runSplitTopPct.value))
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

const emit = defineEmits<{
  close: []
  refresh: []
  delete: []
  viewLog: []
  'keep-script': [scriptId: string]
  'navigate-tab': [tab: DetailPanelTab]
}>()

const activeTab = ref<DetailPanelTab>('detail')
const environments = ref<EnvironmentProfile[]>([])
const selectedEnvId = ref('')
const cronExpression = ref('')
const cronEnabled = ref(false)
const saving = ref(false)
const detailSaving = ref(false)
const detailCategory = ref('')
const installingDeps = ref(false)
const envVars = ref<Record<string, string>>({})
const paramVars = ref<Record<string, string>>({})
const iconPickerOpen = ref(false)
const savingMeta = ref(false)
const renaming = ref(false)
const browserHeadless = ref(false)
const editorDetached = ref(false)
const editModeActive = ref(false)

const scriptIdRef = computed(() => props.script.id)
const entryPathRef = computed(() => props.script.entry)
const {
  files: workspaceFiles,
  activePath: activeFilePath,
  activeContent,
  editDirty,
  editLanguage,
  editReadonly,
  loadingFile,
  loadFileList,
  selectFile,
  saveAllDirtyFiles,
  getDirtyPaths,
  revertAllDirty,
  isAnyDirty,
  getSnapshot,
  mergeFileFromSync,
  markSaved,
  reset: resetFileEditor,
  isFileDirty
} = useScriptFileEditor(scriptIdRef, entryPathRef)

const iconOptions = SCRIPT_ICON_OPTIONS

const tabs = [
  { id: 'detail' as const, label: '详情' },
  { id: 'params' as const, label: '运行' },
  { id: 'history' as const, label: '运行历史' },
  { id: 'edit' as const, label: '编辑' },
  { id: 'log' as const, label: '日志' },
  { id: 'config' as const, label: '配置' }
]

const session = computed(() => {
  const scriptSessions = props.runner.sessions.value.filter((s) => s.scriptId === props.script.id)
  const running = scriptSessions.find((s) => s.status === 'running')
  if (running) return running
  return [...scriptSessions]
    .filter((s) => s.status === 'running' || s.status === 'success' || s.status === 'error')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
})

const latestRunSessionId = computed(() => resolveLatestSessionId())

const latestRunSession = computed(() => {
  const sid = latestRunSessionId.value
  if (!sid) return undefined
  return props.runner.sessions.value.find((s) => s.id === sid)
})

const latestRunLogs = computed(() => {
  const sid = latestRunSessionId.value
  if (!sid) return []
  return props.runner.logsForSession(sid)
})

const isRunning = computed(
  () =>
    props.runner.sessions.value.some((s) => s.scriptId === props.script.id && s.status === 'running') ||
    props.script.status === 'running'
)

const activeSessionId = computed(() => {
  const running = props.runner.sessions.value.find(
    (s) => s.scriptId === props.script.id && s.status === 'running'
  )
  return running?.id ?? props.script.activeSessionId
})

function resolveLatestSessionId(): string | undefined {
  const scriptSessions = props.runner.sessions.value.filter((s) => s.scriptId === props.script.id)
  const running = scriptSessions.find((s) => s.status === 'running')
  if (running) return running.id
  const latest = [...scriptSessions]
    .filter((s) => s.status === 'success' || s.status === 'error' || s.status === 'stopped')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  return latest?.id
}

function syncViewingSessionId(): void {
  const currentId = viewingSessionId.value
  if (currentId && props.runner.sessions.value.some((s) => s.id === currentId)) return
  viewingSessionId.value = resolveLatestSessionId() ?? null
}

const viewingSession = computed(() => {
  const sid = viewingSessionId.value ?? resolveLatestSessionId()
  if (!sid) return undefined
  return props.runner.sessions.value.find((s) => s.id === sid)
})

const runResult = computed(() => {
  const s = viewingSession.value
  if (!s || s.status === 'running') return null
  if (s.status === 'success' && s.result != null) return s.result
  return null
})

const runResultFinishedAt = computed(() => viewingSession.value?.finishedAt)

const viewingSessionFailed = computed(() => viewingSession.value?.status === 'error')

const viewingSessionExitCode = computed(() => viewingSession.value?.exitCode)

const runResultOutputDir = computed(() => extractRunResultOutputDir(runResult.value))

const runResultSectionBrief = computed(() => {
  if (viewingSession.value?.status === 'running') return '运行中…'
  if (viewingSessionFailed.value) return '运行失败'
  if (runResultFinishedAt.value) return `完成于 ${formatRunFinishedAt(runResultFinishedAt.value)}`
  return ''
})

const statusLabel = computed(() => {
  if (isRunning.value) return { text: '运行中', class: 'text-emerald-400', icon: 'running' as const }
  if (props.script.status === 'error') return { text: '运行异常', class: 'text-red-400', icon: 'error' as const }
  return { text: '空闲', class: 'sb-text-muted', icon: 'idle' as const }
})

function formatRunFinishedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

const sessionProgressSummary = computed(() => formatScriptRunProgressSummary(session.value?.runProgress))

const headerStatusSubtext = computed(() => {
  if (sessionProgressSummary.value) return sessionProgressSummary.value
  if (session.value?.phase) return session.value.phase
  return props.script.meta
})

function syncBrowserHeadless(): void {
  browserHeadless.value = props.script.browser?.headless ?? false
}

async function loadContent(): Promise<void> {
  await loadFileList()
}

async function loadEnvironments(): Promise<void> {
  environments.value = await window.autoforge.env.list()
  selectedEnvId.value = props.script.defaultEnvId ?? environments.value.find((e) => e.isDefault)?.id ?? environments.value[0]?.id ?? ''
  syncEnvVars()
}

function syncEnvVars(): void {
  const profile = environments.value.find((e) => e.id === selectedEnvId.value)
  const scriptConfig = props.script.configByEnv?.[selectedEnvId.value] ?? {}
  const vars: Record<string, string> = {}
  for (const def of props.script.envSchema) {
    vars[def.key] =
      scriptConfig[def.key] ?? profile?.variables[def.key] ?? defaultSchemaValue(def)
  }
  envVars.value = vars
}

function resolvedDefaultEnvId(): string {
  return (
    props.script.defaultEnvId ??
    environments.value.find((e) => e.isDefault)?.id ??
    environments.value[0]?.id ??
    ''
  )
}

function savedParamValue(def: (typeof props.script.paramSchema)[number]): string {
  const saved = props.script.paramsByEnv?.[selectedEnvId.value]?.[def.key]
  if (saved !== undefined) return saved
  return defaultSchemaValue(def)
}

function savedEnvConfigValue(def: (typeof props.script.envSchema)[number]): string {
  const saved = props.script.configByEnv?.[selectedEnvId.value]?.[def.key]
  if (saved !== undefined) return saved
  return defaultSchemaValue(def)
}

function syncParamVars(): void {
  const vars: Record<string, string> = {}
  for (const def of props.script.paramSchema) {
    vars[def.key] = savedParamValue(def)
  }
  paramVars.value = vars
}

function syncDetailDraft(): void {
  detailCategory.value = props.script.category
  selectedEnvId.value = resolvedDefaultEnvId()
  syncBrowserHeadless()
  syncParamVars()
}

const detailDirty = computed(() => {
  if (detailCategory.value !== props.script.category) return true
  if (selectedEnvId.value !== resolvedDefaultEnvId()) return true
  if (browserHeadless.value !== (props.script.browser?.headless ?? false)) return true
  return false
})

const paramsDirty = computed(() => {
  for (const def of props.script.paramSchema) {
    if ((paramVars.value[def.key] ?? '') !== savedParamValue(def)) return true
  }
  return false
})

async function cleanupAttachmentDiff(
  schema: Array<{ key: string; type?: string }>,
  before: Record<string, string>,
  after: Record<string, string>,
  mode: 'removed' | 'added'
): Promise<void> {
  for (const def of schema) {
    if (def.type !== 'attachment') continue
    const prev = parseParamAttachments(before[def.key])
    const next = parseParamAttachments(after[def.key])
    const prevPaths = new Set(prev.map((item) => item.path))
    const nextPaths = new Set(next.map((item) => item.path))
    const targets =
      mode === 'removed'
        ? prev.filter((item) => !nextPaths.has(item.path))
        : next.filter((item) => !prevPaths.has(item.path))
    for (const item of targets) {
      await window.autoforge.scripts.removeAttachment(item.path)
    }
  }
}

async function saveDetail(): Promise<void> {
  if (!detailDirty.value) return
  detailSaving.value = true
  try {
    const metaPatch: {
      category?: string
      categoryLabel?: string
      browser?: { headless?: boolean }
    } = {}
    if (detailCategory.value !== props.script.category) {
      const def = props.categoryDefinitions?.find((c) => c.key === detailCategory.value)
      metaPatch.category = detailCategory.value
      metaPatch.categoryLabel = def?.label
    }
    if (browserHeadless.value !== (props.script.browser?.headless ?? false)) {
      metaPatch.browser = { headless: browserHeadless.value }
    }
    if (Object.keys(metaPatch).length) {
      await window.autoforge.scripts.updateMeta(props.script.id, metaPatch)
    }

    if (selectedEnvId.value !== resolvedDefaultEnvId()) {
      await window.autoforge.scripts.update(props.script.id, { defaultEnvId: selectedEnvId.value })
    }

    emit('refresh')
  } finally {
    detailSaving.value = false
  }
}

async function saveParams(): Promise<void> {
  if (!paramsDirty.value) return
  detailSaving.value = true
  try {
    const beforeParams = Object.fromEntries(
      props.script.paramSchema.map((def) => [def.key, savedParamValue(def)])
    )
    const nextParams = plainParamVars()
    await cleanupAttachmentDiff(props.script.paramSchema, beforeParams, nextParams, 'removed')
    await window.autoforge.scripts.setParams(props.script.id, selectedEnvId.value, nextParams)
    emit('refresh')
  } finally {
    detailSaving.value = false
  }
}

async function cancelDetailDraft(): Promise<void> {
  if (!detailDirty.value) return
  detailCategory.value = props.script.category
  selectedEnvId.value = resolvedDefaultEnvId()
  syncBrowserHeadless()
}

async function cancelParamsDraft(): Promise<void> {
  if (!paramsDirty.value) return
  const beforeParams = Object.fromEntries(
    props.script.paramSchema.map((def) => [def.key, savedParamValue(def)])
  )
  await cleanupAttachmentDiff(props.script.paramSchema, beforeParams, paramVars.value, 'added')
  syncParamVars()
}

function plainParamVars(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(toRaw(paramVars.value)).map(([k, v]) => [k, v ?? ''])
  )
}

function syncScheduleFromScript(): void {
  cronExpression.value = normalizeCronExpression(props.script.schedule?.expression)
  cronEnabled.value = props.script.schedule?.enabled ?? false
}

onMounted(async () => {
  loadPanelWidth()
  loadRunSplitRatio()
  syncScheduleFromScript()
  syncViewingSessionId()
  await Promise.all([loadContent(), loadEnvironments()])
  syncDetailDraft()
  window.addEventListener('resize', onWindowResize)

  unsubEditorClosed = window.autoforge.editor.onClosed(() => {
    editorDetached.value = false
  })
  unsubEditorSync = window.autoforge.editor.onSync((payload) => {
    if (payload.scriptId !== props.script.id) return
    if (payload.activeFilePath) activeFilePath.value = payload.activeFilePath
    mergeFileFromSync(payload.filePath, payload.content)
  })
  unsubEditorSaved = window.autoforge.editor.onSaved(({ scriptId, filePath }) => {
    if (scriptId !== props.script.id) return
    if (filePath) markSaved(filePath)
    emit('refresh')
  })
  const editorOpen = await window.autoforge.editor.isOpen()
  if (editorOpen) {
    const remote = await window.autoforge.editor.getSession()
    editorDetached.value = remote?.scriptId === props.script.id
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  unsubEditorClosed?.()
  unsubEditorSync?.()
  unsubEditorSaved?.()
})

watch(
  () => props.script.id,
  async (newId, oldId) => {
    if (oldId && newId !== oldId && editModeActive.value && isAnyDirty.value) {
      const choice = promptUnsavedFiles(getDirtyPaths(), '切换脚本', { allowStay: true })
      if (choice === 'cancel') {
        emit('keep-script', oldId)
        return
      }
      if (choice === 'save') {
        saving.value = true
        try {
          const dirtyPaths = getDirtyPaths()
          const ok = await saveAllDirtyFiles(oldId)
          if (!ok) {
            emit('keep-script', oldId)
            return
          }
          if (dirtyPaths.includes(MANIFEST_FILENAME)) emit('refresh')
        } finally {
          saving.value = false
        }
      } else {
        revertAllDirty()
      }
    }

    if (editorDetached.value) {
      await window.autoforge.editor.close()
      editorDetached.value = false
    }
    editModeActive.value = false
    syncScheduleFromScript()
    viewingSessionId.value = null
    resetFileEditor()
    if (props.initialTab) activeTab.value = props.initialTab
    await Promise.all([loadContent(), loadEnvironments()])
    syncDetailDraft()
    syncViewingSessionId()
  }
)

watch(
  () => props.runner.sessions.value,
  () => syncViewingSessionId(),
  { deep: true }
)

watch(
  () => props.tabRequest,
  () => {
    if (props.initialTab) activeTab.value = props.initialTab
  },
  { immediate: true }
)

watch(selectedEnvId, async (_newId, oldId) => {
  syncEnvVars()
  if (oldId && paramsDirty.value) {
    const beforeParams = Object.fromEntries(
      props.script.paramSchema.map((def) => [
        def.key,
        props.script.paramsByEnv?.[oldId]?.[def.key] ?? defaultSchemaValue(def)
      ])
    )
    await cleanupAttachmentDiff(props.script.paramSchema, beforeParams, paramVars.value, 'added')
  }
  syncParamVars()
})

watch(
  () => props.script.paramsByEnv,
  () => {
    if (!paramsDirty.value) syncParamVars()
  },
  { deep: true }
)

watch(
  () => props.script.configByEnv,
  () => syncEnvVars(),
  { deep: true }
)

async function resolveUnsavedEdit(
  actionLabel: string,
  allowStay = true,
  scriptIdOverride?: string
): Promise<boolean> {
  if (!editModeActive.value || !isAnyDirty.value) return true

  const choice = promptUnsavedFiles(getDirtyPaths(), actionLabel, { allowStay })
  if (choice === 'cancel') return false

  if (choice === 'save') {
    saving.value = true
    try {
      const dirtyPaths = getDirtyPaths()
      const ok = await saveAllDirtyFiles(scriptIdOverride)
      if (!ok) return false
      if (dirtyPaths.includes(MANIFEST_FILENAME)) emit('refresh')
      return true
    } finally {
      saving.value = false
    }
  }

  revertAllDirty()
  return true
}

function enterEditMode(): void {
  if (editorDetached.value) return
  editModeActive.value = true
}

async function cancelEditMode(): Promise<void> {
  const ok = await resolveUnsavedEdit('退出编辑', true)
  if (!ok) return
  editModeActive.value = false
}

async function saveEditMode(): Promise<void> {
  saving.value = true
  try {
    if (isAnyDirty.value) {
      const dirtyPaths = getDirtyPaths()
      const ok = await saveAllDirtyFiles()
      if (!ok) return
      if (dirtyPaths.includes(MANIFEST_FILENAME)) emit('refresh')
    }
    editModeActive.value = false
  } finally {
    saving.value = false
  }
}

async function switchTab(tabId: DetailPanelTab): Promise<void> {
  if (activeTab.value === tabId) return
  if (activeTab.value === 'edit' && tabId !== 'edit') {
    const ok = await resolveUnsavedEdit('切换标签', true)
    if (!ok) return
    editModeActive.value = false
  }
  activeTab.value = tabId
}

async function handlePopoutEditor(): Promise<void> {
  const snapshot = getSnapshot()
  await window.autoforge.editor.open({
    scriptId: props.script.id,
    scriptName: props.script.name,
    entryPath: props.script.entry,
    manifestPath: MANIFEST_FILENAME,
    activeFilePath: snapshot.activeFilePath,
    files: snapshot.files,
    fileStates: snapshot.fileStates
  })
  editorDetached.value = true
}

async function handleDockEditor(): Promise<void> {
  await window.autoforge.editor.close()
  editorDetached.value = false
}

let unsubEditorClosed: (() => void) | undefined
let unsubEditorSync: (() => void) | undefined
let unsubEditorSaved: (() => void) | undefined

function plainEnvVars(): Record<string, string> {
  return Object.fromEntries(Object.entries(toRaw(envVars.value)).map(([k, v]) => [k, v ?? '']))
}

async function saveConfig(): Promise<void> {
  saving.value = true
  try {
    const beforeEnv = Object.fromEntries(
      props.script.envSchema.map((def) => [def.key, savedEnvConfigValue(def)])
    )
    const plainConfig = plainEnvVars()
    await cleanupAttachmentDiff(props.script.envSchema, beforeEnv, plainConfig, 'removed')
    await window.autoforge.scripts.setEnvConfig(props.script.id, selectedEnvId.value, plainConfig)
    await window.autoforge.scripts.update(props.script.id, {
      defaultEnvId: selectedEnvId.value,
      schedule: { expression: cronExpression.value, enabled: cronEnabled.value }
    })
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function runWithEnv(): Promise<void> {
  const params = plainParamVars()
  const started = await props.runner.start(props.script.id, selectedEnvId.value, params)
  if (started) {
    viewingSessionId.value = started.id
    runResultSectionExpanded.value = true
  }
  emit('navigate-tab', 'params')
  emit('viewLog')
  emit('refresh')
}

function clearSessionLogs(): void {
  const sid = latestRunSessionId.value
  if (sid) props.runner.clearLogs(sid)
}

async function installDeps(): Promise<void> {
  installingDeps.value = true
  try {
    const result = await window.autoforge.scripts.installDeps(props.script.id)
    if (!result.ok) {
      alert(`依赖安装失败:\n${result.stderr || result.stdout}`)
    }
  } finally {
    installingDeps.value = false
  }
}

async function openScriptLocation(): Promise<void> {
  await window.autoforge.system.openPath(props.script.workspacePath)
}

async function openOutputDir(): Promise<void> {
  const dir = runResultOutputDir.value
  if (!dir) return
  await window.autoforge.system.openPath(dir)
}

async function updateIcon(icon: ScriptIcon): Promise<void> {
  if (icon === props.script.icon) {
    iconPickerOpen.value = false
    return
  }
  savingMeta.value = true
  try {
    await window.autoforge.scripts.updateMeta(props.script.id, { icon })
    iconPickerOpen.value = false
    emit('refresh')
  } finally {
    savingMeta.value = false
  }
}
async function restartScript(): Promise<void> {
  const started = await props.runner.restart(props.script.id, selectedEnvId.value, plainParamVars())
  if (started) {
    viewingSessionId.value = started.id
    runResultSectionExpanded.value = true
  }
  emit('navigate-tab', 'params')
  emit('refresh')
}

async function handleRename(): Promise<void> {
  if (renaming.value) return
  iconPickerOpen.value = false
  renaming.value = true
  try {
    const ok = await renameScript(props.script.id, props.script.name)
    if (ok) emit('refresh')
  } finally {
    renaming.value = false
  }
}
</script>

<template>
  <aside
    class="relative flex-shrink-0 border-l sb-border sb-bg-panel flex flex-col min-h-0"
    :class="resizing && 'select-none'"
    :style="{ width: `${panelWidth}px` }"
  >
    <div
      class="absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 cursor-col-resize z-10 group"
      title="拖拽调节宽度，双击恢复默认"
      @mousedown="onResizeStart"
      @dblclick="onResizeReset"
    >
      <div
        class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors"
        :class="resizing ? 'bg-[var(--sb-accent-solid)]' : 'sb-border-subtle group-hover:bg-[var(--sb-accent-solid)]'"
      />
    </div>
    <div
      class="relative flex items-center justify-between px-4 py-3.5 border-b sb-border-subtle detail-panel-header gap-3"
      :class="iconPickerOpen && 'z-30'"
    >
      <div
        class="absolute inset-x-0 top-0 h-px pointer-events-none"
        style="background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sb-accent-solid) 55%, transparent), transparent)"
        aria-hidden="true"
      />
      <div class="flex items-center gap-3 min-w-0">
        <div class="relative flex-shrink-0">
          <button
            type="button"
            class="w-9 h-9 rounded-lg border flex items-center justify-center transition-opacity hover:opacity-80 shadow-sm"
            :class="[script.iconBg, script.iconBorder]"
            :disabled="savingMeta"
            title="点击更换图标"
            @click="iconPickerOpen = !iconPickerOpen"
          >
            <component :is="resolveScriptIcon(script.icon)" class="w-4 h-4" :class="script.iconColor" :stroke-width="1.5" />
          </button>
          <div
            v-if="iconPickerOpen"
            class="absolute left-0 top-full mt-1 z-20 w-max max-h-52 overflow-y-auto overscroll-contain p-2 rounded-lg border sb-border sb-bg-panel shadow-xl grid grid-cols-4 gap-1"
          >
            <button
              v-for="opt in iconOptions"
              :key="opt.id"
              type="button"
              class="w-8 h-8 rounded-md border flex items-center justify-center transition-colors"
              :class="
                script.icon === opt.id
                  ? 'sb-bg-inset border-[var(--sb-accent-solid)]'
                  : 'sb-border-subtle sb-bg-surface hover:sb-bg-inset'
              "
              :title="opt.label"
              @click="updateIcon(opt.id)"
            >
              <component :is="resolveScriptIcon(opt.id)" class="w-3.5 h-3.5 sb-text-secondary" :stroke-width="1.5" />
            </button>
          </div>
        </div>
        <div class="min-w-0 overflow-hidden flex-1">
          <div class="flex items-center gap-1 min-w-0">
            <h2 class="text-[14px] font-semibold sb-text-primary truncate leading-snug">{{ script.name }}</h2>
            <button
              type="button"
              class="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md sb-text-faint hover:sb-text-secondary hover:sb-bg-inset transition-colors disabled:opacity-40"
              title="重命名"
              :disabled="renaming"
              @click="handleRename"
            >
              <Pencil class="w-3 h-3" :stroke-width="1.5" />
            </button>
          </div>
          <div class="flex items-center gap-2 mt-1.5 flex-wrap">
            <span class="text-[10px] px-1.5 py-0.5 rounded border font-medium" :class="script.categoryColor">{{ script.categoryLabel }}</span>
            <span class="text-[10px] sb-text-faint font-mono">{{ script.version }}</span>
          </div>
        </div>
      </div>

      <div
        class="flex-shrink-0 flex items-center gap-2.5 px-3 py-1.5 rounded-lg border min-w-0 max-w-[180px]"
        :class="isRunning ? 'bg-emerald-500/5 border-emerald-500/15' : 'sb-bg-surface sb-border-subtle'"
      >
        <div
          class="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
          :class="isRunning ? 'bg-emerald-500/10' : 'sb-bg-inset'"
        >
          <Loader2
            v-if="statusLabel.icon === 'running'"
            class="w-3.5 h-3.5 animate-spin"
            :class="statusLabel.class"
            :stroke-width="1.5"
          />
          <AlertCircle
            v-else-if="statusLabel.icon === 'error'"
            class="w-3.5 h-3.5"
            :class="statusLabel.class"
            :stroke-width="1.5"
          />
          <CheckCircle2
            v-else
            class="w-3.5 h-3.5"
            :class="statusLabel.class"
            :stroke-width="1.5"
          />
        </div>
        <div class="min-w-0">
          <p class="text-[12px] font-medium leading-tight" :class="statusLabel.class">{{ statusLabel.text }}</p>
          <p class="text-[10px] sb-text-muted truncate leading-tight mt-0.5" :title="headerStatusSubtext">
            {{ headerStatusSubtext }}
          </p>
        </div>
      </div>

      <button type="button" class="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-secondary hover:sb-bg-inset transition-colors" @click="emit('close')">
        <X class="w-4 h-4" :stroke-width="1.5" />
      </button>
    </div>

    <div class="flex-shrink-0 flex gap-2 px-4 py-3 border-b sb-border-subtle">
      <button
        type="button"
        class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[12px] font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
        :disabled="isRunning"
        @click="runWithEnv"
      >
        <Play class="w-3 h-3" :stroke-width="1.5" />
        运行
      </button>
      <button
        type="button"
        class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[12px] font-medium hover:bg-red-500/20 transition-colors disabled:opacity-40"
        :disabled="!activeSessionId"
        @click="activeSessionId && runner.stop(activeSessionId).then(() => emit('refresh'))"
      >
        <Square class="w-3 h-3" :stroke-width="1.5" />
        停止
      </button>
      <button
        type="button"
        class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg sb-bg-inset sb-text-secondary border sb-border-subtle text-[12px] font-medium sb-bg-hover transition-colors"
        @click="restartScript"
      >
        <RotateCw class="w-3.5 h-3.5" :stroke-width="1.5" />
        重启
      </button>
    </div>

    <div class="flex border-b sb-border-subtle px-3 gap-0.5">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="px-3 py-2.5 text-[12px] transition-colors rounded-t-md"
        :class="
          activeTab === tab.id
            ? 'sb-nav-active font-semibold sb-text-primary border-b-2 border-[var(--sb-accent-solid)] -mb-px'
            : 'sb-text-muted hover:sb-text-secondary hover:sb-bg-hover'
        "
        @click="switchTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 详情 -->
    <div v-if="activeTab === 'detail'" class="flex-1 flex flex-col min-h-0">
      <div class="flex-1 overflow-y-auto min-h-0">
        <div class="p-4 space-y-4 border-b sb-border-subtle">
        <div>
          <label class="sb-field-label">功能描述</label>
          <p class="mt-1.5 text-[13px] sb-text-muted leading-relaxed">{{ script.description || '暂无描述' }}</p>
        </div>

        <div>
          <label class="sb-field-label">分类</label>
          <select
            v-model="detailCategory"
            class="mt-1.5 w-full h-8 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input disabled:opacity-50"
            :disabled="detailSaving || !categoryDefinitions?.length"
          >
            <option v-for="cat in categoryDefinitions" :key="cat.key" :value="cat.key">{{ cat.label }}</option>
          </select>
        </div>

        <div>
          <label class="sb-field-label">运行环境</label>
          <select
            v-model="selectedEnvId"
            class="mt-1.5 w-full h-8 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input"
          >
            <option v-for="env in environments" :key="env.id" :value="env.id">{{ env.name }}</option>
          </select>
          <p class="mt-1 text-[11px] sb-text-faint">环境变量在「配置」Tab 中按环境保存；运行参数在「运行」Tab 中同样按环境分别保存</p>
        </div>

        <div>
          <label class="sb-field-label">浏览器模式</label>
          <label class="mt-2 flex items-center gap-2 text-[13px] sb-text-secondary cursor-pointer">
            <input
              v-model="browserHeadless"
              type="checkbox"
              class="rounded"
              :disabled="detailSaving"
            />
            无头模式
          </label>
          <p class="mt-1 text-[11px] sb-text-faint">关闭后可显示浏览器窗口，便于手动完成验证码；后台抓取类脚本可开启无头模式</p>
        </div>
      </div>

      <div class="p-4 space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="p-3 rounded-lg border sb-border-subtle sb-bg-surface">
            <p class="sb-field-title text-[11px]">版本</p>
            <p class="text-[13px] sb-text-secondary mt-0.5 font-mono">{{ script.version }}</p>
          </div>
          <div class="p-3 rounded-lg border sb-border-subtle sb-bg-surface">
            <p class="sb-field-title text-[11px]">入口</p>
            <p class="text-[11px] sb-text-muted mt-0.5 font-mono truncate">{{ script.entry }}</p>
          </div>
        </div>

        <div v-if="script.dependencies && Object.keys(script.dependencies).length">
          <label class="sb-field-label">依赖</label>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="(ver, pkg) in script.dependencies" :key="pkg" class="text-[11px] px-2 py-1 rounded-md sb-bg-inset sb-text-muted border sb-border-subtle font-mono">
              {{ pkg }}@{{ ver }}
            </span>
          </div>
          <button
            type="button"
            class="mt-2 flex items-center gap-1.5 text-[12px] sb-text-muted hover:sb-text-primary"
            :disabled="installingDeps"
            @click="installDeps"
          >
            <Package class="w-3.5 h-3.5" :stroke-width="1.5" />
            {{ installingDeps ? '安装中…' : '安装依赖' }}
          </button>
        </div>
      </div>
      </div>

      <div class="flex-shrink-0 px-3 py-2 border-t sb-border-subtle flex items-center gap-1.5">
        <button
          type="button"
          class="h-7 px-2 flex items-center gap-1 rounded-md text-[11px] sb-text-muted border sb-border hover:sb-text-primary hover:sb-bg-hover transition-colors"
          @click="openScriptLocation"
        >
          <FolderOpen class="w-3 h-3" :stroke-width="1.5" />
          打开目录
        </button>
        <button
          type="button"
          class="h-7 px-2 flex items-center gap-1 rounded-md text-[11px] text-red-400/80 border sb-border hover:text-red-400 hover:border-red-500/30 transition-colors"
          @click="emit('delete')"
        >
          <Trash2 class="w-3 h-3" :stroke-width="1.5" />
          删除
        </button>
        <div v-if="detailDirty || detailSaving" class="flex-1 flex items-center justify-end gap-1.5 min-w-0">
          <button
            type="button"
            class="h-7 px-2.5 rounded-md text-[11px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-40"
            :disabled="!detailDirty || detailSaving"
            @click="cancelDetailDraft"
          >
            取消
          </button>
          <button
            type="button"
            class="h-7 px-2.5 flex items-center gap-1 rounded-md sb-btn-accent text-[11px] font-medium hover:opacity-90 transition-colors disabled:opacity-50"
            :disabled="!detailDirty || detailSaving"
            @click="saveDetail"
          >
            <Save class="w-3 h-3" :stroke-width="1.5" />
            {{ detailSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 运行 -->
    <div v-else-if="activeTab === 'params'" class="flex-1 flex flex-col min-h-0" :class="runSplitResizing && 'select-none'">
      <div
        class="overflow-y-auto min-h-0 p-4 space-y-4"
        :class="runResultSectionExpanded ? 'flex-shrink-0' : 'flex-1'"
        :style="runResultSectionExpanded ? { height: `${runSplitTopPct}%` } : undefined"
      >
        <div v-if="script.paramSchema.length">
          <label class="sb-field-label">运行参数</label>
          <p class="mt-1 text-[11px] sb-text-faint">
            业务参数随每次运行传入脚本，通过 ctx.params 访问；当前环境：
            {{ environments.find((e) => e.id === selectedEnvId)?.name ?? '—' }}（切换后加载该环境下已保存的参数）
          </p>
          <div v-for="def in script.paramSchema" :key="def.key" class="mt-3">
            <SchemaValueField
              v-model="paramVars[def.key]"
              :def="def"
              :script-id="script.id"
              :attachment-storage-key="`params/${selectedEnvId}/${def.key}`"
              show-clear
            />
          </div>
        </div>
        <p v-else class="text-[13px] sb-text-muted">此脚本未定义运行参数</p>
      </div>

      <div
        v-show="runResultSectionExpanded"
        class="flex-shrink-0 h-1.5 cursor-row-resize group relative border-y sb-border-subtle"
        title="拖拽调节上下区域高度"
        @mousedown="onRunSplitStart"
      >
        <div
          class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors"
          :class="runSplitResizing ? 'bg-[var(--sb-accent-solid)]' : 'sb-border-subtle group-hover:bg-[var(--sb-accent-solid)]'"
        />
      </div>

      <div
        class="flex flex-col overflow-hidden sb-bg-panel border-t sb-border-subtle"
        :class="runResultSectionExpanded ? 'flex-1 min-h-0' : 'flex-shrink-0 mt-auto'"
      >
        <button
          type="button"
          class="run-result-section-header flex-shrink-0 w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:sb-bg-hover"
          :aria-expanded="runResultSectionExpanded"
          @click="runResultSectionExpanded = !runResultSectionExpanded"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span class="sb-field-label shrink-0">
              本次运行结果
            </span>
            <span v-if="runResultSectionBrief" class="text-[11px] sb-text-muted truncate">
              {{ runResultSectionBrief }}
            </span>
          </div>
          <ChevronDown
            class="w-4 h-4 sb-text-faint shrink-0 transition-transform duration-200"
            :class="runResultSectionExpanded && 'rotate-180'"
            :stroke-width="1.5"
          />
        </button>

        <div v-if="runResultSectionExpanded" class="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col">
          <div
            v-if="viewingSession?.status === 'running'"
            class="flex items-center gap-3 p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/15"
          >
            <Loader2 class="w-4 h-4 text-emerald-400 animate-spin flex-shrink-0" :stroke-width="1.5" />
            <div class="min-w-0">
              <p class="text-[13px] font-medium text-emerald-400">运行中…</p>
              <p v-if="sessionProgressSummary" class="text-[11px] sb-text-muted mt-0.5">{{ sessionProgressSummary }}</p>
              <p v-else-if="session?.phase" class="text-[11px] sb-text-muted mt-0.5">{{ session.phase }}</p>
            </div>
          </div>

          <div
            v-else-if="viewingSessionFailed"
            class="flex items-start gap-3 p-3 rounded-lg border bg-red-500/5 border-red-500/15"
          >
            <AlertCircle class="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" :stroke-width="1.5" />
            <div class="min-w-0">
              <p class="text-[13px] font-medium text-red-400">运行失败</p>
              <p v-if="viewingSessionExitCode != null" class="text-[11px] sb-text-muted mt-0.5">
                退出码 {{ viewingSessionExitCode }}
              </p>
              <p v-if="runResultFinishedAt" class="text-[11px] sb-text-faint mt-1">
                {{ formatRunFinishedAt(runResultFinishedAt) }}
              </p>
            </div>
          </div>

          <RunResultViewer
            v-else-if="runResult"
            :result="runResult"
            :output-dir="runResultOutputDir"
            fill-height
            @open-output-dir="openOutputDir"
          />

          <p v-else class="text-[13px] sb-text-muted py-2">暂无运行结果，点击上方「运行」开始执行</p>

          <ScriptRunProgressPanel
            v-if="session?.runProgress && isRunning"
            :progress="session.runProgress"
            compact
            class="mt-3"
          />
        </div>
      </div>

      <div
        v-if="script.paramSchema.length && (paramsDirty || detailSaving)"
        class="flex-shrink-0 px-3 py-2 border-t sb-border-subtle flex items-center justify-end gap-1.5"
      >
        <button
          type="button"
          class="h-7 px-2.5 rounded-md text-[11px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-40"
          :disabled="!paramsDirty || detailSaving"
          @click="cancelParamsDraft"
        >
          取消
        </button>
        <button
          type="button"
          class="h-7 px-2.5 flex items-center gap-1 rounded-md sb-btn-accent text-[11px] font-medium hover:opacity-90 transition-colors disabled:opacity-50"
          :disabled="!paramsDirty || detailSaving"
          @click="saveParams"
        >
          <Save class="w-3 h-3" :stroke-width="1.5" />
          {{ detailSaving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>

    <!-- 运行历史 -->
    <ScriptRunHistoryPanel v-else-if="activeTab === 'history'" :script-id="script.id" :script="script" />

    <!-- 日志 -->
    <div v-else-if="activeTab === 'log'" class="flex-1 flex flex-col p-4 min-h-0">
      <LogConsole
        embedded
        title="最近运行日志"
        :logs="latestRunLogs"
        :run-progress="latestRunSession?.runProgress"
        @clear="clearSessionLogs"
      />
    </div>

    <!-- 编辑 -->
    <div v-else-if="activeTab === 'edit'" class="flex-1 flex flex-col p-3 gap-2 min-h-0">
      <div class="flex-1 flex min-h-0 gap-2">
        <ScriptWorkspaceSidebar
          storage-key="autoforge-detail-workspace-sidebar"
          :files="workspaceFiles"
          :active-path="activeFilePath"
          :is-dirty="isFileDirty"
          @select="(path) => void selectFile(path)"
        />
        <div class="flex-1 flex flex-col min-w-0 min-h-0 gap-2">
          <div v-if="loadingFile" class="text-[11px] sb-text-faint px-1">加载文件中…</div>
          <CodeEditor
            v-if="!editorDetached"
            v-model="activeContent"
            :filename="activeFilePath"
            :language="editLanguage"
            :dirty="editDirty"
            :readonly="!editModeActive || editReadonly"
            :placeholder="editReadonly ? '此文件为二进制格式，无法在编辑器中修改' : '// 在此编辑文件…'"
            @popout="handlePopoutEditor"
          />
          <div
            v-else
            class="flex-1 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed sb-border-subtle sb-bg-surface min-h-[200px]"
          >
            <p class="text-[13px] sb-text-muted">编辑器已在独立窗口中</p>
            <button
              type="button"
              class="text-[12px] sb-text-primary hover:text-[var(--sb-accent-solid)] transition-colors"
              @click="handleDockEditor"
            >
              收回主窗口
            </button>
          </div>
        </div>
      </div>
      <div v-if="!editorDetached" class="flex-shrink-0 flex gap-2">
        <button
          v-if="!editModeActive"
          type="button"
          class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg sb-btn-accent text-[13px] font-medium hover:opacity-90 transition-colors"
          @click="enterEditMode"
        >
          <Pencil class="w-3.5 h-3.5" :stroke-width="1.5" />
          编辑
        </button>
        <template v-else>
          <button
            type="button"
            class="flex-1 h-8 rounded-lg text-[12px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-40"
            :disabled="saving"
            @click="cancelEditMode"
          >
            取消
          </button>
          <button
            type="button"
            class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg sb-btn-accent text-[13px] font-medium hover:opacity-90 transition-colors disabled:opacity-50"
            :disabled="saving"
            @click="saveEditMode"
          >
            <Save class="w-3.5 h-3.5" :stroke-width="1.5" />
            {{ saving ? '保存中…' : isAnyDirty ? '保存' : '完成' }}
          </button>
        </template>
      </div>
    </div>

    <!-- 配置 -->
    <div v-else-if="activeTab === 'config'" class="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <label class="sb-field-title">运行环境</label>
        <select
          v-model="selectedEnvId"
          class="mt-1 w-full h-8 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input"
        >
          <option v-for="env in environments" :key="env.id" :value="env.id">{{ env.name }}</option>
        </select>
        <p class="mt-1 text-[11px] sb-text-faint">不同环境可配置不同的账号、URL 等，运行时可切换</p>
      </div>

      <div v-if="script.envSchema.length">
        <h3 class="sb-field-title mb-2">环境变量</h3>
        <p class="text-[11px] sb-text-faint mb-3">固定环境配置（账号、URL 等），按环境保存，通过 ctx.env 访问；支持 text、select、boolean、attachment 等类型，值均为字符串</p>
        <div v-for="def in script.envSchema" :key="def.key" class="mb-3">
          <SchemaValueField
            v-model="envVars[def.key]"
            :def="def"
            :script-id="script.id"
            :attachment-storage-key="`env/${selectedEnvId}/${def.key}`"
            attachment-hint="支持多选；文件会复制到本地缓存（按环境分别保存），脚本通过 JSON 解析 ctx.env 获取路径"
          />
        </div>
      </div>
      <div v-else class="rounded-lg border sb-border-subtle sb-bg-surface p-4 text-[12px] sb-text-muted">
        此脚本未声明环境变量。可在「编辑 → autoforge.json」的 <code class="sb-text-muted">env</code> 字段中添加，例如账号、密码、URL。运行业务参数请使用 <code class="sb-text-muted">params</code> 字段，在「详情」Tab 填写。
      </div>

      <div>
        <label class="sb-field-title">定时任务</label>
        <div class="mt-1">
          <CronScheduleBuilder v-model="cronExpression" />
        </div>
        <label class="mt-3 flex items-center gap-2 text-[12px] sb-text-muted">
          <input v-model="cronEnabled" type="checkbox" class="rounded" />
          启用定时任务
        </label>
      </div>

      <button
        type="button"
        class="w-full h-8 rounded-lg sb-btn-accent text-[13px] font-medium hover:opacity-90 transition-colors disabled:opacity-50"
        :disabled="saving"
        @click="saveConfig"
      >
        保存配置
      </button>
    </div>
  </aside>
</template>
