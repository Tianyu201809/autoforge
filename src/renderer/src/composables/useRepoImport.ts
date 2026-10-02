import { computed, onUnmounted, ref } from 'vue'
import type {
  RepoConvertProgress,
  RepoWorkspaceInfo,
  RepoWorkspaceSummary
} from '../../../shared/repo-types'
import type {
  LlmConversionLogLine,
  LlmConversionResult,
  LlmProfileView
} from '../../../shared/llm-types'
import type { ScriptItem } from '../../../shared/types/script'
import { canSendConversionMessage, workspaceDeleteConfirm } from '../lib/repo-conversion-chat'
import { askConfirm } from './useConfirmDialog'
import { askPrompt } from './usePromptDialog'
import { useToast } from './useToast'

/** 1 地址 → 2 拉取 → 3 转换 → 4 导入 */
export type RepoImportStepNumber = 1 | 2 | 3 | 4

export type RepoImportEngine = 'agent' | 'llm'

export const REPO_IMPORT_STEPS: Array<{ id: RepoImportStepNumber; label: string }> = [
  { id: 1, label: '地址' },
  { id: 2, label: '拉取' },
  { id: 3, label: '转换' },
  { id: 4, label: '导入' }
]

const MAX_CONVERSION_LOG_LINES = 300

/** 从 IPC 错误信息里剥离 Electron 包装前缀 */
function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const marker = raw.lastIndexOf('Error: ')
  return marker >= 0 ? raw.slice(marker + 7) : raw
}

export function useRepoImport() {
  const { pushToast } = useToast()

  const url = ref('')
  const branch = ref('')
  const token = ref('')
  const showAdvanced = ref(false)

  const busy = ref(false)
  const importing = ref(false)
  const error = ref<string | null>(null)
  const progress = ref<RepoConvertProgress | null>(null)
  const workspace = ref<RepoWorkspaceInfo | null>(null)
  const history = ref<RepoWorkspaceSummary[]>([])

  const engine = ref<RepoImportEngine>('agent')
  const llmProfiles = ref<LlmProfileView[]>([])
  const activeProfileId = ref<string | null>(null)
  const selectedProfileId = ref('')
  const allowBuildGlobally = ref(false)
  const allowBuildThisRun = ref(false)
  const instruction = ref('')
  const converting = ref(false)
  const conversionLogs = ref<LlmConversionLogLine[]>([])
  const conversionResult = ref<LlmConversionResult | null>(null)

  const step = computed<RepoImportStepNumber>(() => {
    if (workspace.value) return workspace.value.packageReady ? 4 : 3
    return busy.value ? 2 : 1
  })

  const progressPercent = computed(() => {
    if (!busy.value && !converting.value) return 0
    return progress.value?.percent ?? 0
  })

  const canSubmit = computed(() => url.value.trim().length > 0 && !busy.value)

  const convertibility = computed(() => workspace.value?.profile.convertibility ?? null)

  const selectedProfile = computed(
    () => llmProfiles.value.find((profile) => profile.id === selectedProfileId.value) ?? null
  )

  const turns = computed(() => workspace.value?.turns ?? [])

  const canSend = computed(() =>
    canSendConversionMessage(turns.value, instruction.value, converting.value)
  )

  const canConvert = computed(
    () =>
      Boolean(workspace.value) &&
      !converting.value &&
      Boolean(selectedProfileId.value) &&
      Boolean(selectedProfile.value?.hasApiKey) &&
      canSend.value
  )

  const plannedBuildCommands = computed(() => conversionResult.value?.plan.buildCommands ?? [])

  function reset(): void {
    busy.value = false
    importing.value = false
    error.value = null
    progress.value = null
    workspace.value = null
    converting.value = false
    conversionLogs.value = []
    conversionResult.value = null
  }

  function resetAll(): void {
    reset()
    url.value = ''
    branch.value = ''
    token.value = ''
    showAdvanced.value = false
    instruction.value = ''
    allowBuildThisRun.value = false
  }

  async function loadHistory(): Promise<void> {
    try {
      history.value = await window.autoforge.repo.listWorkspaces()
    } catch {
      history.value = []
    }
  }

  async function loadLlmProfiles(): Promise<void> {
    try {
      const result = await window.autoforge.llm.listProfiles()
      llmProfiles.value = result.profiles
      activeProfileId.value = result.activeProfileId
      allowBuildGlobally.value = result.allowBuild
      if (!selectedProfileId.value) {
        selectedProfileId.value = result.activeProfileId ?? result.profiles[0]?.id ?? ''
      }
    } catch {
      llmProfiles.value = []
    }
  }

  async function startFetch(): Promise<void> {
    if (!canSubmit.value) return
    const previous = workspace.value
    error.value = null
    progress.value = null
    conversionLogs.value = []
    conversionResult.value = null
    busy.value = true
    try {
      const info = await window.autoforge.repo.fetch({
        url: url.value.trim(),
        ref: branch.value.trim() || undefined,
        token: token.value.trim() || undefined
      })
      workspace.value = info
      instruction.value = ''
      allowBuildThisRun.value = false
      pushToast({
        type: 'success',
        title: '仓库已就绪',
        message: `${info.profile.ref.owner}/${info.profile.ref.repo} · ${info.profile.resolvedRef}`
      })
      await loadHistory()
      await loadLlmProfiles()
    } catch (err) {
      workspace.value = previous
      error.value = describeError(err)
    } finally {
      busy.value = false
      progress.value = null
    }
  }

  /** Agent 写出产物后重新探测 */
  async function recheckPackage(): Promise<void> {
    const current = workspace.value
    if (!current) return
    try {
      const info = await window.autoforge.repo.getWorkspace(current.taskId)
      if (!info) {
        error.value = '转换工作区已不存在，请重新拉取'
        return
      }
      workspace.value = info
      if (info.packageReady) {
        pushToast({ type: 'success', title: '已检测到脚本包', message: '可以导入到脚本列表了' })
      } else {
        pushToast({ type: 'info', title: '暂未发现产物', message: '产物目录里还没有 autoforge.json' })
      }
    } catch (err) {
      error.value = describeError(err)
    }
  }

  async function resumeWorkspace(taskId: string): Promise<void> {
    reset()
    try {
      const info = await window.autoforge.repo.getWorkspace(taskId)
      if (!info) {
        pushToast({ type: 'error', title: '工作区不存在', message: '该转换工作区可能已被清理' })
        await loadHistory()
        return
      }
      workspace.value = info
      url.value = info.profile.ref.url
      await loadLlmProfiles()
    } catch (err) {
      error.value = describeError(err)
    }
  }

  /** 使用应用内 LLM 引擎生成脚本包 */
  async function startLlmConversion(): Promise<void> {
    const current = workspace.value
    if (!current || !canSendConversionMessage(current.turns, instruction.value, converting.value)) return
    if (!selectedProfileId.value) {
      error.value = '请先在设置 → 模型 中添加并选择一个模型配置'
      return
    }
    const draft = instruction.value.trim()
    const now = new Date().toISOString()
    converting.value = true
    error.value = null
    conversionLogs.value = []
    conversionResult.value = null
    instruction.value = ''
    workspace.value = {
      ...current,
      turns: [
        ...current.turns,
        { id: `local-user-${now}`, role: 'user', content: draft, status: 'complete', createdAt: now },
        { id: `local-assistant-${now}`, role: 'assistant', content: '', status: 'running', createdAt: now }
      ]
    }
    try {
      const result = await window.autoforge.repo.convertWithLlm({
        taskId: current.taskId,
        profileId: selectedProfileId.value,
        allowBuild: allowBuildThisRun.value,
        instruction: draft || undefined
      })
      conversionResult.value = result
      pushToast({
        type: 'success',
        title: '脚本包已生成',
        message: `共写入 ${result.writtenFiles} 个文件，可以导入了`
      })
    } catch (err) {
      const message = describeError(err)
      if (!/已取消/.test(message)) error.value = message
    } finally {
      converting.value = false
      await recheckPackageSilently()
    }
  }

  async function cancelLlmConversion(): Promise<void> {
    const current = workspace.value
    if (!current) return
    try {
      await window.autoforge.repo.cancelLlm(current.taskId)
    } catch (err) {
      error.value = describeError(err)
    }
  }

  async function recheckPackageSilently(): Promise<void> {
    const current = workspace.value
    if (!current) return
    try {
      const info = await window.autoforge.repo.getWorkspace(current.taskId)
      if (info) workspace.value = info
    } catch {
      /* ignore */
    }
  }

  async function importPackage(): Promise<ScriptItem | null> {
    const current = workspace.value
    if (!current || importing.value) return null
    importing.value = true
    error.value = null
    try {
      const script = await window.autoforge.repo.importPackage(current.taskId)
      pushToast({
        type: 'success',
        title: '导入成功',
        message: `已添加「${script.name}」`
      })
      await loadHistory()
      return script
    } catch (err) {
      error.value = describeError(err)
      return null
    } finally {
      importing.value = false
    }
  }

  async function openFolder(target: 'root' | 'repo' | 'package'): Promise<void> {
    const current = workspace.value
    if (!current) return
    const ok = await window.autoforge.repo.openWorkspace(current.taskId, target)
    if (!ok) {
      pushToast({ type: 'error', title: '打开失败', message: '目录不存在或无法打开' })
    }
  }

  async function renameWorkspace(taskId: string): Promise<void> {
    const fromHistory = history.value.find((item) => item.taskId === taskId)
    const current = workspace.value?.taskId === taskId ? workspace.value : null
    const repoName =
      fromHistory?.repo ??
      (current ? `${current.profile.ref.owner}/${current.profile.ref.repo}` : taskId)
    const next = await askPrompt({
      title: '设置别名',
      message: `「${repoName}」在工作区里显示的名称。留空则恢复仓库名。`,
      label: '别名',
      defaultValue: fromHistory?.alias ?? current?.profile.alias ?? '',
      placeholder: '例如：每日导出',
      confirmLabel: '保存'
    })
    if (next == null) return
    const ok = await window.autoforge.repo.setAlias(taskId, next)
    if (!ok) {
      pushToast({ type: 'error', title: '保存失败', message: '工作区不存在或无法写入别名' })
      return
    }
    await loadHistory()
    if (workspace.value?.taskId === taskId) {
      try {
        const info = await window.autoforge.repo.getWorkspace(taskId)
        if (info) workspace.value = info
      } catch {
        /* 列表已更新，打开中的标题下次进入时会刷新 */
      }
    }
  }

  async function deleteWorkspace(taskId: string): Promise<void> {
    const fromHistory = history.value.find((item) => item.taskId === taskId)
    const current = workspace.value?.taskId === taskId ? workspace.value : null
    const repoLabel =
      fromHistory?.repo ??
      (current ? `${current.profile.ref.owner}/${current.profile.ref.repo}` : taskId)
    const workspacePath = fromHistory?.workspacePath ?? current?.workspacePath ?? ''
    const confirmed = await askConfirm(workspaceDeleteConfirm(repoLabel, workspacePath))
    if (!confirmed) return
    const ok = await window.autoforge.repo.deleteWorkspace(taskId)
    if (!ok) {
      pushToast({ type: 'error', title: '删除失败', message: '目录仍在，工作区已保留' })
      return
    }
    if (workspace.value?.taskId === taskId) reset()
    pushToast({ type: 'success', title: '已删除', message: '转换工作区和克隆目录已清理' })
    await loadHistory()
  }

  const unsubscribe = window.autoforge.repo.onProgress((payload) => {
    progress.value = payload
    if (payload.phase === 'error' && payload.error) {
      error.value = payload.error
    }
  })

  const unsubscribeLog = window.autoforge.repo.onConvertLog((line) => {
    if (workspace.value && line.taskId !== workspace.value.taskId) return
    const next = [...conversionLogs.value, line]
    conversionLogs.value = next.length > MAX_CONVERSION_LOG_LINES ? next.slice(-MAX_CONVERSION_LOG_LINES) : next
  })

  const unsubscribeReasoning = window.autoforge.repo.onReasoning((payload) => {
    const current = workspace.value
    if (!current || payload.taskId !== current.taskId) return
    const index = [...current.turns].reverse().findIndex((turn) => turn.role === 'assistant')
    if (index < 0) return
    const target = current.turns.length - 1 - index
    const nextTurns = current.turns.map((turn, turnIndex) =>
      turnIndex === target ? { ...turn, thinking: payload.thinking } : turn
    )
    workspace.value = { ...current, turns: nextTurns }
  })

  onUnmounted(() => {
    unsubscribe()
    unsubscribeLog()
    unsubscribeReasoning()
  })

  return {
    url,
    branch,
    token,
    showAdvanced,
    busy,
    importing,
    error,
    progress,
    workspace,
    history,
    step,
    progressPercent,
    canSubmit,
    convertibility,
    engine,
    llmProfiles,
    activeProfileId,
    selectedProfileId,
    selectedProfile,
    allowBuildGlobally,
    allowBuildThisRun,
    instruction,
    converting,
    conversionLogs,
    conversionResult,
    turns,
    canSend,
    plannedBuildCommands,
    canConvert,
    reset,
    resetAll,
    loadHistory,
    loadLlmProfiles,
    startFetch,
    recheckPackage,
    resumeWorkspace,
    startLlmConversion,
    cancelLlmConversion,
    importPackage,
    openFolder,
    renameWorkspace,
    deleteWorkspace
  }
}
