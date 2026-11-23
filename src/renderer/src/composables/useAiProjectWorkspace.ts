import { computed, onScopeDispose, reactive, ref } from 'vue'
import type { AiAgentEvent, AiProjectAttachment, AiAttachmentPreview, AiProject, AiProjectLanguage, AiProjectSummary, AiProjectTurn } from '../../../shared/ai-workspace-types'
import type { LlmProfileView } from '../../../shared/ai-types'

type AiWorkspaceApi = Pick<Window['autoforge']['ai'],
  'pickProjectFolder' | 'listProjects' | 'getProject' | 'listProjectTurns' | 'createProject' | 'renameProject' |
  'setProjectPinned' | 'exportProjectTurns' | 'removeProject' |
  'pickAttachments' | 'previewAttachment' | 'removeAttachment' | 'startTurn' | 'importProject' | 'cancelTurn' | 'onAgentEvent' | 'listProfiles'>

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
  const pendingByProject = reactive<Record<string, AiProjectAttachment[]>>({})
  const pendingAttachments = computed(() => pendingByProject[activeProject.value?.id ?? ''] ?? [])
  const attachmentPreviews = ref<Record<string, AiAttachmentPreview>>({})
  const attaching = ref(false)
  let runningProjectId: string | null = null
  let selectionVersion = 0
  let disposed = false
  const canRetry = computed(() => !turns.value.at(-1)?.checks?.length && ['error', 'cancelled'].includes(turns.value.at(-1)?.status ?? '') && turns.value.some(turn => turn.role === 'user'))
  async function previewAttachment(attachment: AiProjectAttachment): Promise<void> {
    const projectId = activeProject.value?.id
    if (!projectId || attachmentPreviews.value[attachment.id]) return
    try {
      const result = await api.previewAttachment(projectId, attachment.id)
      if (!disposed && activeProject.value?.id === projectId) {
        const keys = Object.keys(attachmentPreviews.value)
        while (keys.length >= 8) delete attachmentPreviews.value[keys.shift()!]
        attachmentPreviews.value[attachment.id] = result
      }
    } catch {
      if (!disposed && activeProject.value?.id === projectId) {
        const keys = Object.keys(attachmentPreviews.value)
        while (keys.length >= 8) delete attachmentPreviews.value[keys.shift()!]
        attachmentPreviews.value[attachment.id] = { metadata: attachment, error: '附件不可用，请重新添加素材' }
      }
    }
  }
  async function addAttachments(): Promise<void> {
    const projectId = activeProject.value?.id
    if (!projectId || attaching.value || busy.value) return
    attaching.value = true
    try {
      const added = await api.pickAttachments(projectId)
      if (!added) return
      if (disposed || !activeProject.value || !projects.value.some(p => p.id === projectId) && activeProject.value.id !== projectId) {
        await Promise.all(added.map(a => api.removeAttachment(projectId, a.id).catch(() => false)))
        return
      }
      const pending = pendingByProject[projectId] ?? []
      if (pending.length + added.length > 8 || [...pending, ...added].reduce((sum, a) => sum + a.size, 0) > 20 * 1024 * 1024) {
        await Promise.all(added.map(a => api.removeAttachment(projectId, a.id)))
        throw new Error('每条消息最多 8 个附件，总大小不超过 20 MB')
      }
      pendingByProject[projectId] = [...pending, ...added]
      if (activeProject.value?.id === projectId) for (const attachment of added) void previewAttachment(attachment)
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '添加素材失败' }
    finally { attaching.value = false }
  }
  async function removeAttachment(attachment: AiProjectAttachment): Promise<void> {
    const projectId = activeProject.value?.id
    if (!projectId || busy.value) return
    try {
      await api.removeAttachment(projectId, attachment.id)
      pendingByProject[projectId] = (pendingByProject[projectId] ?? []).filter(a => a.id !== attachment.id)
      delete attachmentPreviews.value[attachment.id]
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '移除素材失败' }
  }
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
  onScopeDispose(() => {
    disposed = true
    unsubscribe()
    for (const [projectId, pending] of Object.entries(pendingByProject)) {
      if (runningProjectId === projectId) continue
      for (const attachment of pending) void api.removeAttachment(projectId, attachment.id).catch(() => false)
    }
  })

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
    const version = ++selectionVersion
    error.value = ''
    try {
      const [project, savedTurns] = await Promise.all([api.getProject(id), api.listProjectTurns(id)])
      if (version !== selectionVersion || disposed) return
      if (!project) throw new Error('AI 项目不存在')
      activeProject.value = project
      onActiveProjectChange(project.id)
      turns.value = savedTurns
      prompt.value = ''
      attachmentPreviews.value = {}
      void (async () => {
        const recent = [...savedTurns.flatMap(turn => turn.attachments ?? []), ...pendingAttachments.value].slice(-8)
        for (const attachment of recent) {
          if (disposed || activeProject.value?.id !== id) break
          await previewAttachment(attachment)
        }
      })()
      activeProfileId.value = project.profileId
      streamingText.value = ''
      activeTurnId.value = null
      fileChanges.value = []
      const checkedTurn = [...savedTurns].reverse().find((turn) => turn.checks?.length)
      checkResults.value = checkedTurn?.checks as CheckSummary[] ?? []
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
      delete pendingByProject[id]
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

  async function sendMessage(message = prompt.value, retryUser?: AiProjectTurn): Promise<void> {
    const project = activeProject.value
    const attachments = retryUser?.attachments ?? [...pendingAttachments.value]
    if (!project || (!message.trim() && !attachments.length) || busy.value || attaching.value) return
    error.value = ''
    busy.value = true
    runningProjectId = project.id
    streamingText.value = ''
    activeTurnId.value = null
    fileChanges.value = []
    checkResults.value = []
    importResult.value = null
    const optimisticId = createId()
    if (!retryUser) turns.value.push({ id: optimisticId, projectId: project.id, role: 'user', content: message, attachments, status: 'complete', createdAt: new Date().toISOString() })
    try {
      const options = retryUser ? { retryUserTurnId: retryUser.id } : attachments.length ? { attachmentIds: attachments.map(a => a.id) } : undefined
      const result = await api.startTurn(project.id, message, options)
      if (!retryUser) pendingByProject[project.id] = []
      if (activeProject.value?.id !== project.id || disposed) return
      prompt.value = ''
      const saved = await api.listProjectTurns(project.id)
      if (activeProject.value?.id !== project.id || disposed) return
      if (saved.length) turns.value = saved
      else turns.value.push(result)
      if (result.status === 'error') error.value = '模型请求失败。消息和素材已保留，可重试；若模型不支持图片，请在输入框重新发送文字请求。'
      if (result.checks) checkResults.value = result.checks as CheckSummary[]
      if (result.importedScriptId) importResult.value = { ok: true, scriptId: result.importedScriptId, message: '脚本已导入 Autoforge' }
    } catch (cause) {
      if (activeProject.value?.id !== project.id || disposed) return
      error.value = cause instanceof Error ? cause.message : 'Agent 任务失败'
      turns.value = turns.value.filter(turn => turn.id !== optimisticId)
      const saved = await api.listProjectTurns(project.id).catch(() => [])
      if (activeProject.value?.id === project.id && saved.length) turns.value = saved
    } finally {
      runningProjectId = null
      busy.value = false
      if (activeProject.value?.id === project.id) {
        streamingText.value = ''
        activeTurnId.value = null
      }
    }
  }

  async function retryMessage(): Promise<void> {
    if (!canRetry.value) return
    const user = [...turns.value].reverse().find(turn => turn.role === 'user')
    if (user) await sendMessage(user.content, user)
  }

  async function cancelTurn(): Promise<void> {
    if (!runningProjectId || !busy.value) return
    try {
      await api.cancelTurn(runningProjectId)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法取消 Agent 任务'
    }
  }

  async function importProject(): Promise<void> {
    const projectId = activeProject.value?.id
    if (!projectId || busy.value) return
    busy.value = true
    runningProjectId = projectId
    error.value = ''
    streamingText.value = ''
    activeTurnId.value = null
    fileChanges.value = []
    checkResults.value = []
    importResult.value = null
    try {
      const result = await api.importProject(projectId)
      if (activeProject.value?.id !== projectId) return
      turns.value.push(result)
      if (result.checks?.length) checkResults.value = result.checks as CheckSummary[]
      if (result.importedScriptId) importResult.value = { ok: true, scriptId: result.importedScriptId, message: '脚本已导入 Autoforge' }
    } catch (cause) {
      if (activeProject.value?.id === projectId) error.value = cause instanceof Error ? cause.message : '项目构建与导入失败'
    } finally {
      runningProjectId = null
      busy.value = false
      if (activeProject.value?.id === projectId) {
        streamingText.value = ''
        activeTurnId.value = null
      }
    }
  }

  return {
    projects, activeProject, turns, profiles, activeProfileId, credentialPersistent, loading, busy, error,
    prompt, streamingText, activeTurnId, fileChanges, checkResults, importResult, creating, projectDraft, pendingFolder,
    load, openProject, chooseProjectFolder, createProject, renameProject, setProjectPinned, exportProjectTurns,
    pendingAttachments, attachmentPreviews, attaching, addAttachments, removeAttachment, previewAttachment, canRetry, retryMessage,
    removeProject, sendMessage, cancelTurn, importProject
  }
}
