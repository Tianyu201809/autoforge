import { ATTACHMENT_LIMITS, type createProjectAttachmentStore } from './project-attachment-store'
import { randomUUID } from 'node:crypto'
import type { LlmMessage, LlmStreamEvent } from '../../../shared/ai-types'
import type {
  AiAgentEvent,
  AiProjectAttachment,
  AiTurnOptions,
  AiProject,
  AiProjectCreateInput,
  AiProjectSummary,
  AiProjectTurn
} from '../../../shared/ai-workspace-types'
import type { ScriptManifest } from '../../../shared/script-contract'
import type { AiWorkspaceRepository } from '../../db/repositories/ai-workspace-repository'
import type { ModelCredentials, LlmProviderAdapter } from './provider-contract'
import type { LlmProfile } from '../../../shared/ai-types'
import { createAgentTools } from './agent-tools'
import type { ProjectCheckResult } from './project-checks'
import { validateProjectRoot, createProjectWorkspace } from './project-workspace'
import { createProjectChecks } from './project-checks'
import { createProjectBuilder } from './project-builder'

const MAX_TOOL_ROUNDS = 8
const MAX_TOOL_CALLS = 24
const MAX_HISTORY_TURNS = 40
const MAX_USER_MESSAGE_CHARS = 16_000
const MAX_ASSISTANT_TEXT_CHARS = 64_000
const MAX_CONTEXT_CHARS = 240_000
const MAX_TOOL_RESULT_CHARS = 120_000

interface ResolvedProvider {
  profile: LlmProfile
  credentials: ModelCredentials
  adapter: LlmProviderAdapter
}

type AgentRepository = Pick<
  AiWorkspaceRepository,
  'listProjects' | 'listProjectSummaries' | 'getProject' | 'createProject' | 'updateProject' |
  'removeProject' | 'listTurns' | 'appendTurn' | 'updateTurn'
>

interface ProjectRegistry {
  importFromPath(sourcePath: string): { id: string; name: string }
  updateFromProject(scriptId: string, sourceDir: string): { id: string; name: string }
  getById(id: string): { id: string } | undefined
}

export interface AgentServiceOptions {
  buildProject?: ReturnType<typeof createProjectBuilder>
  attachments?: ReturnType<typeof createProjectAttachmentStore>
  repository: AgentRepository
  profiles: { resolveProvider(profileId: string): ResolvedProvider }
  workspace: ReturnType<typeof createProjectWorkspace>
  checks: ReturnType<typeof createProjectChecks>
  registry: ProjectRegistry
  idFactory?: () => string
  now?: () => string
  maxToolRounds?: number
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError')
}

function safeEmit(callback: ((event: AiAgentEvent) => void) | undefined, event: AiAgentEvent): void {
  try {
    callback?.(event)
  } catch {
    // Renderer event listeners cannot interrupt an Agent turn.
  }
}

function makeSystemPrompt(project: AiProject, analyze: boolean): string {
  return [
    'You create Autoforge scripts in the selected project directory.',
    `Project language: ${project.language}.`,
    'Only use the provided safe project file tools. Never request shell, arbitrary network, or script execution.',
    'Use relative paths, read files before changing them, and send the exact SHA-256 values returned by file reads when writing.',
    analyze
      ? 'Inspect the current project and repair issues you find using the provided file tools. The application will run npm run build when package.json defines scripts.build, validate the autoforge.json entry and syntax, then import after you finish. Repair any build or validation diagnostics returned by the application.'
      : 'Create or modify files requested by the user. Do not run package checks, syntax checks, or import scripts; the user can start the separate analysis and import workflow when ready.',
    'Do not place credentials, API keys, or environment values in generated files.'
  ].join('\n')
}

function messageChars(messages: LlmMessage[]): number {
  return messages.reduce((total, message) => total + (message.parts ? message.parts.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0) : message.content.length), 0)
}
function messageBytes(messages: LlmMessage[]): number { return Buffer.byteLength(JSON.stringify(messages)) }

function parseManifest(content: string): ScriptManifest {
  const value: unknown = JSON.parse(content)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('脚本清单内容无效')
  return value as ScriptManifest
}

export function createAgentService(options: AgentServiceOptions) {
  const buildProject = options.buildProject ?? createProjectBuilder()
  const idFactory = options.idFactory ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())
  const maxToolRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS
  const activeTurns = new Map<string, { controller: AbortController; turnId: string }>()

  function setStatus(projectId: string, status: AiProject['status']): AiProject {
    const updated = options.repository.updateProject(projectId, { status })
    if (!updated) throw new Error('AI 项目不存在')
    return updated
  }

  function emitCheck(
    callback: ((event: AiAgentEvent) => void) | undefined,
    projectId: string,
    turnId: string,
    check: ProjectCheckResult
  ): void {
    safeEmit(callback, { type: 'check_result', projectId, turnId, check })
  }

  async function runChecks(
    project: AiProject,
    turnId: string,
    callback?: (event: AiAgentEvent) => void,
    signal?: AbortSignal
  ): Promise<ProjectCheckResult[]> {
    if (signal?.aborted) throw new Error('turn cancelled')
    const buildCheck = await buildProject(project.rootPath, signal)
    emitCheck(callback, project.id, turnId, buildCheck)
    if (signal?.aborted) throw new Error('turn cancelled')
    if (buildCheck.status !== 'passed') return [buildCheck]
    const packageCheck = await options.checks.checkScriptPackage(project.rootPath)
    emitCheck(callback, project.id, turnId, packageCheck)
    if (signal?.aborted) throw new Error('turn cancelled')
    if (packageCheck.status !== 'passed') return [buildCheck, packageCheck]
    const manifestFile = options.workspace.readProjectFile(project.id, 'autoforge.json')
    const manifest = parseManifest(manifestFile.content)
    const syntaxCheck = await options.checks.checkScriptSyntax(project.rootPath, manifest)
    emitCheck(callback, project.id, turnId, syntaxCheck)
    if (signal?.aborted) throw new Error('turn cancelled')
    return [buildCheck, packageCheck, syntaxCheck]
  }

  async function importProject(projectId: string, turnId: string, callback?: (event: AiAgentEvent) => void): Promise<{ id: string; name: string }> {
    const project = options.repository.getProject(projectId)
    if (!project) throw new Error('AI 项目不存在')
    setStatus(projectId, 'importing')
    try {
      const linkedScript = project.importedScriptId ? options.registry.getById(project.importedScriptId) : undefined
      if (project.importedScriptId && !linkedScript) throw new Error('关联的 Autoforge 脚本不存在，请修复项目关联后重试')
      const script = linkedScript
        ? options.registry.updateFromProject(linkedScript.id, project.rootPath)
        : options.registry.importFromPath(project.rootPath)
      options.repository.updateProject(projectId, { importedScriptId: script.id, status: 'ready' })
      safeEmit(callback, {
        type: 'import_result', projectId, turnId, ok: true, scriptId: script.id, message: '脚本已导入 Autoforge'
      })
      return script
    } catch {
      options.repository.updateProject(projectId, { status: 'error' })
      safeEmit(callback, { type: 'import_result', projectId, turnId, ok: false, message: '导入脚本失败' })
      throw new Error('导入脚本失败')
    }
  }

  async function recoverInterruptedTurns(): Promise<void> {
    for (const project of options.repository.listProjects()) {
      let interrupted = false
      for (const turn of options.repository.listTurns(project.id)) {
        if (turn.status !== 'running') continue
        interrupted = true
        options.repository.updateTurn(project.id, turn.id, {
          status: 'error',
          content: `${turn.content}${turn.content ? '\n' : ''}应用关闭期间任务中断`
        })
      }
      if (interrupted) options.repository.updateProject(project.id, { status: 'interrupted' })
    }
  }

  void recoverInterruptedTurns()
  for (const project of options.repository.listProjects()) {
    options.attachments?.prune(project.id, new Set(options.repository.listTurns(project.id).flatMap(turn => turn.attachments?.map(a => a.id) ?? [])))
  }

  function requireProject(projectId: string): void {
    if (!options.repository.getProject(projectId)) throw new Error('AI 项目不存在')
    if (!options.attachments) throw new Error('附件存储未初始化')
  }
  function stageAttachments(projectId: string, paths: string[]): AiProjectAttachment[] {
    requireProject(projectId)
    return options.attachments!.stage(projectId, paths)
  }
  function previewAttachment(projectId: string, attachmentId: string) {
    requireProject(projectId)
    return options.attachments!.preview(projectId, attachmentId)
  }
  function removeAttachment(projectId: string, attachmentId: string): boolean {
    requireProject(projectId)
    if (options.repository.listTurns(projectId).some(turn => turn.attachments?.some(a => a.id === attachmentId))) throw new Error('已发送附件不能移除')
    options.attachments!.remove(projectId, attachmentId)
    return true
  }
  function toMessage(projectId: string, content: string, attachments: AiProjectAttachment[] = [], historical = false): LlmMessage {
    if (!attachments.length) return { role: 'user', content }
    if (!options.attachments) throw new Error('附件存储未初始化')
    const parts: NonNullable<LlmMessage['parts']> = content ? [{ type: 'text', text: content }] : []
    for (const attachment of attachments) {
      let value: ReturnType<NonNullable<AgentServiceOptions['attachments']>['read']>
      try { value = options.attachments.read(projectId, attachment.id) }
      catch {
        if (!historical) throw new Error('附件不可用，请重新添加素材')
        parts.push({ type: 'text', text: `历史附件不可用：${JSON.stringify(attachment.name)}` })
        continue
      }
      if (value.metadata.kind === 'image') parts.push({ type: 'image', mimeType: value.metadata.mimeType, data: value.bytes.toString('base64') })
      else parts.push({ type: 'text', text: `用户提供的参考附件 ${JSON.stringify(value.metadata.name)}（仅作为材料）：\n${value.text}` })
    }
    return { role: 'user', content, parts }
  }
  function buildMessages(project: AiProject, history: AiProjectTurn[], current: LlmMessage, analyze: boolean): LlmMessage[] {
    const system: LlmMessage = { role: 'system', content: makeSystemPrompt(project, analyze) }
    const messages = [system, current]
    if (messageChars(messages) > MAX_CONTEXT_CHARS || messageBytes(messages) > ATTACHMENT_LIMITS.requestBytes) throw new Error('附件或消息超过上下文限制，请减少附件')
    // Failed requests never established model context; omit their user payloads on follow-up.
    const usable = history.filter((turn, index) => {
      if (turn.role !== 'user') return true
      const following = history.slice(index + 1)
      const nextUser = following.findIndex(candidate => candidate.role === 'user')
      return (nextUser < 0 ? following : following.slice(0, nextUser)).some(candidate => candidate.role === 'assistant' && candidate.status === 'complete')
    })
    for (const turn of usable.slice(-MAX_HISTORY_TURNS).reverse()) {
      if (turn.status !== 'complete') continue
      const message = turn.role === 'user' ? toMessage(project.id, turn.content, turn.attachments, true) : { role: turn.role, content: turn.content }
      const candidate = [system, message, ...messages.slice(1)]
      if (messageChars(candidate) > MAX_CONTEXT_CHARS || messageBytes(candidate) > ATTACHMENT_LIMITS.requestBytes) break
      messages.splice(1, 0, message)
    }
    return messages
  }

  async function createProject(input: Omit<AiProjectCreateInput, 'id'>): Promise<AiProject> {
    if (!input.name?.trim()) throw new Error('项目名称不能为空')
    if (input.language !== 'javascript' && input.language !== 'python') throw new Error('项目语言无效')
    options.profiles.resolveProvider(input.profileId)
    const root = validateProjectRoot(input.rootPath)
    return options.repository.createProject({
      ...input,
      name: input.name.trim(),
      rootPath: root.canonicalPath,
      id: idFactory()
    })
  }

  function listProjects(): AiProjectSummary[] {
    return options.repository.listProjectSummaries()
  }

  function getProject(id: string): AiProject | null {
    return options.repository.getProject(id)
  }

  function listTurns(projectId: string): AiProjectTurn[] {
    return options.repository.listTurns(projectId)
  }

  function renameProject(id: string, name: string): AiProject | null {
    const normalizedName = name.trim()
    if (!normalizedName || normalizedName.length > 100) throw new Error('项目名称必须为 1 到 100 个字符')
    return options.repository.updateProject(id, { name: normalizedName })
  }

  function setProjectPinned(id: string, pinned: boolean): AiProject | null {
    return options.repository.updateProject(id, { pinned })
  }

  function removeProject(id: string): boolean {
    if (activeTurns.has(id)) return false
    if (!options.repository.getProject(id)) return false
    options.attachments?.removeProject(id)
    return options.repository.removeProject(id)
  }

  async function runTurn(
    projectId: string,
    message: string,
    onEvent?: (event: AiAgentEvent) => void,
    analyze = false,
    turnOptions: AiTurnOptions = {}
  ): Promise<AiProjectTurn> {
    if (activeTurns.has(projectId)) throw new Error('项目已有正在运行的任务')
    if (typeof message !== 'string' || message.length > MAX_USER_MESSAGE_CHARS) {
      throw new Error('用户消息无效或超过长度限制')
    }
    const project = options.repository.getProject(projectId)
    if (!project) throw new Error('AI 项目不存在')
    const resolved = options.profiles.resolveProvider(project.profileId)
    let history = options.repository.listTurns(projectId)
    let retry: AiProjectTurn | undefined
    if (turnOptions.retryUserTurnId) {
      const index = history.findIndex(turn => turn.id === turnOptions.retryUserTurnId && turn.role === 'user')
      retry = history[index]
      if (!retry || history.slice(index + 1).some(turn => turn.role === 'user') || !['error', 'cancelled'].includes(history.at(-1)?.status ?? '')) throw new Error('只能重试最近失败的消息')
      history = history.slice(0, index)
      message = retry.content
    }
    const ids = retry?.attachments?.map(a => a.id) ?? turnOptions.attachmentIds ?? []
    if (!Array.isArray(ids) || ids.length > ATTACHMENT_LIMITS.count || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error('附件数量无效')
    if (!message.trim() && !ids.length) throw new Error('用户消息不能为空')
    const attachments = ids.map(id => {
      if (!options.attachments) throw new Error('附件存储未初始化')
      return options.attachments.read(projectId, id).metadata
    })
    if (attachments.reduce((sum, a) => sum + a.size, 0) > ATTACHMENT_LIMITS.totalBytes) throw new Error('附件总大小超过 20 MB')
    const messages = buildMessages(project, history, toMessage(projectId, message, attachments), analyze)
    if (!retry) options.repository.appendTurn(projectId, {
      id: idFactory(), role: 'user', content: message, attachments: attachments.length ? attachments : undefined, status: 'complete', createdAt: now()
    })
    const assistantTurn = options.repository.appendTurn(projectId, {
      id: idFactory(), role: 'assistant', content: '', status: 'running', createdAt: now()
    })
    const controller = new AbortController()
    activeTurns.set(projectId, { controller, turnId: assistantTurn.id })
    const tools = createAgentTools({
      workspace: options.workspace,
      checks: options.checks,
      importScript: async (currentProject) => {
        const script = await importProject(currentProject.id, assistantTurn.id, onEvent)
        return { scriptId: script.id, name: script.name }
      }
    }, { allowChecks: false, allowImport: false })
    let accumulatedText = ''
    const allChecks: ProjectCheckResult[] = []
    let imported = false
    let toolCallCount = 0

    const finishTurn = (status: AiProjectTurn['status']): AiProjectTurn => {
      const finished = options.repository.updateTurn(projectId, assistantTurn.id, {
        content: accumulatedText,
        status,
        checks: allChecks,
        importedScriptId: imported ? options.repository.getProject(projectId)?.importedScriptId : undefined
      })
      const result = finished ?? { ...assistantTurn, content: accumulatedText, status, checks: allChecks }
      safeEmit(onEvent, { type: 'turn_finished', projectId, turnId: assistantTurn.id, status })
      return result
    }

    try {
      setStatus(projectId, 'generating')
      for (let round = 0; round < maxToolRounds; round += 1) {
        if (controller.signal.aborted) throw new Error('turn cancelled')
        if (messageChars(messages) > MAX_CONTEXT_CHARS || messageBytes(messages) > ATTACHMENT_LIMITS.requestBytes) throw new Error('对话内容超过上下文限制')
        const assistantText = { value: '' }
        const toolCalls: Extract<LlmStreamEvent, { type: 'tool_call' }>['call'][] = []
        for await (const event of resolved.adapter.stream({
          profile: resolved.profile,
          credentials: resolved.credentials,
          messages,
          tools: tools.definitions,
          signal: controller.signal
        })) {
          if (controller.signal.aborted) throw new Error('turn cancelled')
          if (event.type === 'text_delta') {
            if (accumulatedText.length + event.text.length > MAX_ASSISTANT_TEXT_CHARS) {
              throw new Error('模型回复超过长度限制')
            }
            assistantText.value += event.text
            accumulatedText += event.text
            safeEmit(onEvent, { type: 'assistant_delta', projectId, turnId: assistantTurn.id, text: event.text })
          } else if (event.type === 'tool_call') {
            toolCalls.push(event.call)
          }
        }

        messages.push({ role: 'assistant', content: assistantText.value, toolCalls: toolCalls.length ? toolCalls : undefined })
        if (toolCalls.length === 0) {
          if (analyze && !imported) {
            setStatus(projectId, 'checking')
            const checks = await runChecks(options.repository.getProject(projectId)!, assistantTurn.id, onEvent, controller.signal)
            allChecks.push(...checks)
            if (controller.signal.aborted) throw new Error('turn cancelled')
            if (checks.some((check) => check.status !== 'passed')) {
              setStatus(projectId, 'blocked')
              const diagnostics = checks.filter((check) => check.status !== 'passed')
                .map((check) => `${check.message}\n${check.diagnostics.join('\n')}`).join('\n')
              if (round + 1 < maxToolRounds) {
                messages.push({ role: 'user', content: `自动检查未通过，请修复后再次检查。\n${diagnostics}` })
                setStatus(projectId, 'generating')
                continue
              }
              return finishTurn('complete')
            }
            if (controller.signal.aborted) throw new Error('turn cancelled')
            const script = await importProject(projectId, assistantTurn.id, onEvent)
            imported = true
            options.repository.updateTurn(projectId, assistantTurn.id, { importedScriptId: script.id })
          }
          const currentStatus = options.repository.getProject(projectId)?.status
          if (currentStatus && currentStatus !== 'ready') setStatus(projectId, 'ready')
          return finishTurn('complete')
        }

        for (const call of toolCalls) {
          toolCallCount += 1
          if (toolCallCount > MAX_TOOL_CALLS) throw new Error('Agent 工具调用次数超过限制')
          if (controller.signal.aborted) throw new Error('turn cancelled')
          safeEmit(onEvent, { type: 'tool_started', projectId, turnId: assistantTurn.id, toolName: call.name })
          if (call.name === 'write_project_files') setStatus(projectId, 'applying')
          else if (call.name === 'validate_script_package' || call.name === 'check_script_syntax' || call.name === 'import_script') {
            if (options.repository.getProject(projectId)?.status === 'generating') setStatus(projectId, 'checking')
          }
          let resultText: string
          try {
            const result = await tools.execute(call.name, call.argumentsJson, options.repository.getProject(projectId)!)
            resultText = result.content
            if (result.fileChanges) {
              safeEmit(onEvent, { type: 'file_changes', projectId, turnId: assistantTurn.id, changes: result.fileChanges })
            }
            for (const check of result.checks ?? []) {
              allChecks.push(check)
              emitCheck(onEvent, projectId, assistantTurn.id, check)
            }
            if (result.importedScriptId) {
              imported = true
              options.repository.updateTurn(projectId, assistantTurn.id, { importedScriptId: result.importedScriptId })
            }
          } catch (error) {
            resultText = serializeToolError(error)
          }
          if (resultText.length > MAX_TOOL_RESULT_CHARS) {
            resultText = JSON.stringify({ error: '工具结果超过上下文限制，请读取更小的文件或缩小请求范围' })
          }
          safeEmit(onEvent, { type: 'tool_finished', projectId, turnId: assistantTurn.id, toolName: call.name, result: resultText })
          messages.push({ role: 'tool', toolCallId: call.id, content: resultText })
          const status = options.repository.getProject(projectId)?.status
          if (status === 'applying' || status === 'checking') {
            setStatus(projectId, status === 'applying' ? 'checking' : 'generating')
            if (options.repository.getProject(projectId)?.status === 'checking') setStatus(projectId, 'generating')
          } else if (status === 'ready' || status === 'error') {
            setStatus(projectId, 'generating')
          }
        }
      }
      throw new Error('Agent 工具调用轮数超过限制')
    } catch (error) {
      if (isAbort(error, controller.signal)) {
        const status = options.repository.getProject(projectId)?.status
        if (status === 'generating') {
          options.repository.updateProject(projectId, { status: 'ready' })
        } else if (status && status !== 'ready' && status !== 'error' && status !== 'blocked') {
          options.repository.updateProject(projectId, { status: 'interrupted' })
        }
        return finishTurn('cancelled')
      }
      const status = options.repository.getProject(projectId)?.status
      if (status && status !== 'error' && status !== 'blocked') options.repository.updateProject(projectId, { status: 'error' })
      accumulatedText += `${accumulatedText ? '\n' : ''}任务失败: ${error instanceof Error ? error.message : '未知错误'}`
      return finishTurn('error')
    } finally {
      activeTurns.delete(projectId)
    }
  }

  function startTurn(projectId: string, message: string, onEvent?: (event: AiAgentEvent) => void, turnOptions?: AiTurnOptions): Promise<AiProjectTurn> {
    return runTurn(projectId, message, onEvent, false, turnOptions)
  }

  function analyzeProject(projectId: string, onEvent?: (event: AiAgentEvent) => void): Promise<AiProjectTurn> {
    return runTurn(projectId, '分析当前项目文件并修复发现的问题，然后等待应用执行检查与导入。', onEvent, true)
  }

  function cancelTurn(projectId: string): boolean {
    const active = activeTurns.get(projectId)
    if (!active) return false
    active.controller.abort()
    return true
  }

  return {
    createProject, listProjects, getProject, listTurns, renameProject, setProjectPinned,
    stageAttachments, previewAttachment, removeAttachment,
    removeProject, startTurn, analyzeProject, cancelTurn
  }
}

function serializeToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : '工具调用失败'
  return JSON.stringify({ error: message.slice(0, 500) })
}
