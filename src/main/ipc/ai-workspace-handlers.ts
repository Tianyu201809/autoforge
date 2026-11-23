import type { AiAgentEvent, AiProjectAttachment, AiAttachmentPreview, AiTurnOptions, AiProject, AiProjectConversationExport, AiProjectCreateInput, AiProjectSummary, AiProjectTurn } from '../../shared/ai-workspace-types'
import { IPC } from '../../shared/ipc-channels'
import { createProjectConversationExport } from '../services/ai/project-conversation-export'

interface IpcEvent {
  sender: { send(channel: string, payload: AiAgentEvent): void }
}

type IpcHandler = (event: IpcEvent, ...args: unknown[]) => unknown

export interface AiWorkspaceIpcService {
  listProjects(): AiProjectSummary[]
  getProject(id: string): AiProject | null
  listTurns(projectId: string): AiProjectTurn[]
  createProject(input: Omit<AiProjectCreateInput, 'id'>): Promise<AiProject>
  renameProject(id: string, name: string): AiProject | null
  setProjectPinned(id: string, pinned: boolean): AiProject | null
  removeProject(id: string): boolean
  stageAttachments(projectId: string, paths: string[]): AiProjectAttachment[]
  previewAttachment(projectId: string, attachmentId: string): AiAttachmentPreview
  removeAttachment(projectId: string, attachmentId: string): boolean
  startTurn(projectId: string, message: string, onEvent?: (event: AiAgentEvent) => void, options?: AiTurnOptions): Promise<AiProjectTurn>
  analyzeProject(projectId: string, onEvent?: (event: AiAgentEvent) => void): Promise<AiProjectTurn>
  cancelTurn(projectId: string): boolean
}

export type SaveProjectConversation = (conversation: AiProjectConversationExport) => Promise<string | null>

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('项目 ID 无效')
  return value.trim()
}

export function registerAiWorkspaceIpcHandlers(
  register: (channel: string, handler: IpcHandler) => void,
  service: AiWorkspaceIpcService,
  pickFolder: () => Promise<string | null>,
  saveConversation: SaveProjectConversation,
  pickAttachments: () => Promise<string[] | null> = async () => null
): void {
  register(IPC.AI_PROJECT_PICK_FOLDER, () => pickFolder())
  register(IPC.AI_PROJECTS_LIST, () => service.listProjects())
  register(IPC.AI_PROJECT_GET, (_event, id) => service.getProject(requireId(id)))
  register(IPC.AI_PROJECT_TURNS_LIST, (_event, id) => service.listTurns(requireId(id)))
  register(IPC.AI_PROJECT_CREATE, (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('项目输入无效')
    const value = input as Record<string, unknown>
    if (
      typeof value.rootPath !== 'string' || !value.rootPath.trim() ||
      typeof value.name !== 'string' || !value.name.trim() ||
      (value.language !== 'javascript' && value.language !== 'python') ||
      typeof value.profileId !== 'string' || !value.profileId.trim() ||
      Object.keys(value).some((key) => !['rootPath', 'name', 'language', 'profileId'].includes(key))
    ) {
      throw new Error('项目输入无效')
    }
    return service.createProject({
      rootPath: value.rootPath,
      name: value.name,
      language: value.language,
      profileId: value.profileId
    })
  })
  register(IPC.AI_PROJECT_RENAME, (_event, id, name) => {
    const projectId = requireId(id)
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('项目名称必须为 1 到 100 个字符')
    return service.renameProject(projectId, name)
  })
  register(IPC.AI_PROJECT_SET_PINNED, (_event, id, pinned) => {
    if (typeof pinned !== 'boolean') throw new Error('置顶状态无效')
    return service.setProjectPinned(requireId(id), pinned)
  })
  register(IPC.AI_PROJECT_REMOVE, (_event, id) => service.removeProject(requireId(id)))
  register(IPC.AI_PROJECT_EXPORT_TURNS, (_event, id) => {
    const projectId = requireId(id)
    const project = service.getProject(projectId)
    if (!project) throw new Error('AI 项目不存在')
    return saveConversation(createProjectConversationExport(project, service.listTurns(projectId)))
  })
  register(IPC.AI_PROJECT_ATTACHMENTS_PICK, async (_event, id) => {
    const projectId = requireId(id)
    if (!service.getProject(projectId)) throw new Error('AI 项目不存在')
    const paths = await pickAttachments()
    return paths ? service.stageAttachments(projectId, paths) : null
  })
  register(IPC.AI_PROJECT_ATTACHMENT_PREVIEW, (_event, id, attachmentId) => service.previewAttachment(requireId(id), requireAttachmentId(attachmentId)))
  register(IPC.AI_PROJECT_ATTACHMENT_REMOVE, (_event, id, attachmentId) => service.removeAttachment(requireId(id), requireAttachmentId(attachmentId)))
  register(IPC.AI_PROJECT_START_TURN, (event, id, message, rawOptions) => {
    const projectId = requireId(id)
    const options = requireTurnOptions(rawOptions)
    if (typeof message !== 'string' || message.length > 16000 || (!message.trim() && !options.attachmentIds?.length && !options.retryUserTurnId)) throw new Error('Agent 消息无效')
    return service.startTurn(projectId, message, (agentEvent) => event.sender.send(IPC.EVENT_AI_AGENT, agentEvent), options)
  })
  register(IPC.AI_PROJECT_ANALYZE, (event, id) => {
    const projectId = requireId(id)
    return service.analyzeProject(projectId, (agentEvent) => event.sender.send(IPC.EVENT_AI_AGENT, agentEvent))
  })
  register(IPC.AI_PROJECT_CANCEL_TURN, (_event, id) => service.cancelTurn(requireId(id)))
}

function requireAttachmentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('附件 ID 无效')
  return value
}
function requireTurnOptions(value: unknown): AiTurnOptions {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('消息参数无效')
  const options = value as Record<string, unknown>
  if (Object.keys(options).some(key => !['attachmentIds', 'retryUserTurnId'].includes(key))) throw new Error('消息参数无效')
  if (options.attachmentIds !== undefined && (!Array.isArray(options.attachmentIds) || options.attachmentIds.length > 8)) throw new Error('附件数量无效')
  const attachmentIds = (options.attachmentIds as unknown[] | undefined)?.map(requireAttachmentId)
  const retryUserTurnId = options.retryUserTurnId === undefined ? undefined : requireAttachmentId(options.retryUserTurnId)
  return { attachmentIds, retryUserTurnId }
}
