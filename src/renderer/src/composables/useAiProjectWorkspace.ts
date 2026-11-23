import { onScopeDispose, reactive, ref } from 'vue'
import type { AiAgentEvent, AiProject, AiProjectLanguage, AiProjectSummary, AiProjectTurn } from '../../../shared/ai-workspace-types'
import type { LlmProfileView } from '../../../shared/ai-types'

type AiWorkspaceApi = Pick<Window['autoforge']['ai'],
  'pickProjectFolder' | 'listProjects' | 'getProject' | 'listProjectTurns' | 'createProject' | 'renameProject' |
  'setProjectPinned' | 'exportProjectTurns' | 'removeProject' |
  'startTurn' | 'cancelTurn' | 'retryChecks' | 'onAgentEvent' | 'listProfiles'>

interface AiWorkspaceDraft {
  name: string
  language: AiProjectLanguage
  profileId: string
}

interface CheckSummary {
  status?: string
  code?: string
  message?: string
  diagnostics?: string[]
}

interface ImportSummary {
  ok: boolean
  scriptId?: string
  message: string
}

export function useAiProjectWorkspace(
  api: AiWorkspaceApi = window.autoforge.ai,
  createId: () => string = () => crypto.randomUUID(),
  onActiveProjectChange: (id: string | null) => void = () => undefined
) {
  const projects = ref<AiProjectSummary[]>([])
  const activeProject = ref<AiProject | null>(null)
  const turns = ref<AiProjectTurn[]>([])
  const profiles = ref<LlmProfileView[]>([])
  const activeProfileId = ref<string | null>(null)
  const credentialPersistent = ref(true)
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  const prompt = ref('')
  const streamingText = ref('')
  const activeTurnId = ref<string | null>(null)
  const fileChanges = ref<string[]>([])
  const checkResults = ref<CheckSummary[]>([])
  const importResult = ref<ImportSummary | null>(null)
  const creating = ref(false)
  const projectDraft = reactive<AiWorkspaceDraft>({ name: '', language: 'javascript', profileId: '' })
  const pendingFolder = ref<string | null>(null)

  function receiveEvent(event: AiAgentEvent): void {
    if (event.projectId !== activeProject.value?.id) return
    if (event.type === 'assistant_delta') {
      if (event.turnId !== activeTurnId.value) activeTurnId.value = event.turnId
      streamingText.value += event.text
      return
    }
    if (event.type === 'file_changes') {
      const changedPaths = [
        ...event.changes.applied,
        ...event.changes.conflicts.map((path) => '冲突 · ' + path),
        ...event.changes.rollbackFailed.map((path) => '回滚失败 · ' + path)
      ]
      fileChanges.value = Array.from(new Set([...fileChanges.value, ...changedPaths]))
    } else if (event.type === 'check_result') {
      checkResults.value.push(event.check as CheckSummary)
    } else if (event.type === 'import_result') {
      importResult.value = { ok: event.ok, scriptId: event.scriptId, message: event.message }
    }
  }

  const unsubscribe = api.onAgentEvent(receiveEvent)
  onScopeDispose(unsubscribe)

  async function load(preferredProjectId?: string | null): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const [savedProjects, profileResult] = await Promise.all([api.listProjects(), api.listProfiles()])
      projects.value = savedProjects
      profiles.value = profileResult.profiles
      activeProfileId.value = profileResult.activeProfileId
      credentialPersistent.value = profileResult.credentialPersistent
      const restoredId = preferredProjectId ?? activeProject.value?.id ?? savedProjects[0]?.id
      if (restoredId) await openProject(restoredId)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法读取 AI 项目'
    } finally {
      loading.value = false
    }
  }

  async function openProject(id: string): Promise<void> {
    error.value = ''
    try {
      const [project, savedTurns] = await Promise.all([api.getProject(id), api.listProjectTurns(id)])
      if (!project) throw new Error('AI 项目不存在')
      activeProject.value = project
      onActiveProjectChange(project.id)
      turns.value = savedTurns
      activeProfileId.value = project.profileId
      streamingText.value = ''
      activeTurnId.value = null
      fileChanges.value = []
      checkResults.value = []
      importResult.value = project.importedScriptId
        ? { ok: true, scriptId: project.importedScriptId, message: '已关联 Autoforge 脚本' }
        : null
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法打开 AI 项目'
    }
  }

  async function chooseProjectFolder(): Promise<string | null> {
    try {
      const folder = await api.pickProjectFolder()
      pendingFolder.value = folder
      if (folder && !projectDraft.name.trim()) {
        const segments = folder.replace(/\\/g, '/').split('/').filter(Boolean)
        projectDraft.name = segments.at(-1) ?? ''
      }
      return folder
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法选择项目文件夹'
      return null
    }
  }

  async function createProject(input: Pick<AiWorkspaceDraft, 'name' | 'language' | 'profileId'>): Promise<void> {
    error.value = ''
    try {
      const folder = pendingFolder.value ?? await chooseProjectFolder()
      if (!folder) return
      const project = await api.createProject({ ...input, rootPath: folder })
      activeProject.value = project
      onActiveProjectChange(project.id)
      pendingFolder.value = null
      projectDraft.name = ''
      creating.value = false
      await loadProjects()
      turns.value = []
      fileChanges.value = []
      checkResults.value = []
      importResult.value = null
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法创建 AI 项目'
    }
  }

  async function loadProjects(): Promise<void> {
    projects.value = await api.listProjects()
  }

  async function renameProject(id: string, name: string): Promise<void> {
    const normalizedName = name.trim()
    if (!normalizedName || normalizedName.length > 100) {
      error.value = '项目名称必须为 1 到 100 个字符'
      return
    }
    try {
      const renamed = await api.renameProject(id, normalizedName)
      if (!renamed) throw new Error('项目不存在或无法重命名')
      if (activeProject.value?.id === id) activeProject.value = renamed
      await loadProjects()
      error.value = ''
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法重命名项目'
    }
  }

  async function setProjectPinned(id: string, pinned: boolean): Promise<void> {
    try {
      const updated = await api.setProjectPinned(id, pinned)
      if (!updated) throw new Error('项目不存在，无法更改置顶状态')
      if (activeProject.value?.id === id) activeProject.value = updated
      await loadProjects()
      error.value = ''
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法更改项目置顶状态'
    }
  }

  async function exportProjectTurns(id: string): Promise<string | null> {
    try {
      error.value = ''
      return await api.exportProjectTurns(id)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法导出项目对话'
      return null
    }
  }

  async function removeProject(id: string): Promise<void> {
    try {
      const removed = await api.removeProject(id)
      if (!removed) {
        error.value = '项目当前无法移除。请等待运行中的任务完成或取消任务后重试。'
        return
      }
      error.value = ''
      await loadProjects()
      if (activeProject.value?.id === id) {
        activeProject.value = null
        onActiveProjectChange(null)
        turns.value = []
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法移除 AI 项目'
    }
  }

  async function sendMessage(message = prompt.value): Promise<void> {
    const project = activeProject.value
    if (!project || !message.trim() || busy.value) return
    const sent = message
    prompt.value = ''
    error.value = ''
    busy.value = true
    streamingText.value = ''
    activeTurnId.value = null
    fileChanges.value = []
    checkResults.value = []
    importResult.value = null
    turns.value.push({
      id: createId(), projectId: project.id, role: 'user', content: sent, status: 'complete', createdAt: new Date().toISOString()
    })
    try {
      const result = await api.startTurn(project.id, sent)
      const existing = turns.value.find((turn) => turn.id === result.id)
      if (existing) Object.assign(existing, result)
      else turns.value.push(result)
      if (result.checks) checkResults.value = result.checks as CheckSummary[]
      if (result.importedScriptId) importResult.value = { ok: true, scriptId: result.importedScriptId, message: '脚本已导入 Autoforge' }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Agent 任务失败'
      turns.value.push({
        id: activeTurnId.value ?? createId(), projectId: project.id, role: 'assistant',
        content: streamingText.value || error.value, status: 'error', createdAt: new Date().toISOString()
      })
    } finally {
      busy.value = false
      if (activeTurnId.value && streamingText.value) {
        const existing = turns.value.find((turn) => turn.id === activeTurnId.value)
        if (existing) Object.assign(existing, { content: streamingText.value, status: 'complete' })
        else turns.value.push({
          id: activeTurnId.value, projectId: project.id, role: 'assistant', content: streamingText.value,
          status: 'complete', createdAt: new Date().toISOString()
        })
      }
    }
  }

  async function cancelTurn(): Promise<void> {
    if (!activeProject.value || !busy.value) return
    try {
      await api.cancelTurn(activeProject.value.id)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法取消 Agent 任务'
    }
  }

  async function retryChecks(): Promise<void> {
    if (!activeProject.value) return
    busy.value = true
    error.value = ''
    try {
      const result = await api.retryChecks(activeProject.value.id)
      turns.value.push(result)
      checkResults.value = result.checks as CheckSummary[] ?? []
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '重新检查失败'
    } finally {
      busy.value = false
    }
  }

  return {
    projects, activeProject, turns, profiles, activeProfileId, credentialPersistent, loading, busy, error,
    prompt, streamingText, activeTurnId, fileChanges, checkResults, importResult, creating, projectDraft, pendingFolder,
    load, openProject, chooseProjectFolder, createProject, renameProject, setProjectPinned, exportProjectTurns,
    removeProject, sendMessage, cancelTurn, retryChecks
  }
}
