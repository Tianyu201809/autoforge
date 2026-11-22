import { randomUUID } from 'node:crypto'
import type { LlmMessage, LlmStreamEvent } from '../../../shared/ai-types'
import type {
  AiAgentEvent,
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

function makeSystemPrompt(project: AiProject): string {
  return [
    'You create Autoforge scripts in the selected project directory.',
    `Project language: ${project.language}.`,
    'Only use the provided project file and check/import tools. Never request shell, arbitrary network, or script execution.',
    'Use relative paths, read files before changing them, and send the exact SHA-256 values returned by file reads when writing.',
    'Create a valid autoforge.json and matching entry file. After changes, check the package and syntax, then call import_script.',
    'Do not place credentials, API keys, or environment values in generated files.'
  ].join('\n')
}

function buildMessages(project: AiProject, history: AiProjectTurn[], currentMessage: string): LlmMessage[] {
  const system = { role: 'system' as const, content: makeSystemPrompt(project) }
  const recentMessages: LlmMessage[] = []
  let usedChars = system.content.length + currentMessage.length
  for (const turn of history.slice(-MAX_HISTORY_TURNS).reverse()) {
    if (turn.status !== 'complete' || usedChars + turn.content.length > MAX_CONTEXT_CHARS) continue
    recentMessages.push({ role: turn.role, content: turn.content })
    usedChars += turn.content.length
  }
  recentMessages.reverse()
  return [system, ...recentMessages, { role: 'user', content: currentMessage }]
}

function messageChars(messages: LlmMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0)
}

function parseManifest(content: string): ScriptManifest {
  const value: unknown = JSON.parse(content)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('脚本清单内容无效')
  return value as ScriptManifest
}

export function createAgentService(options: AgentServiceOptions) {
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
    const packageCheck = await options.checks.checkScriptPackage(project.rootPath)
    emitCheck(callback, project.id, turnId, packageCheck)
    if (signal?.aborted) throw new Error('turn cancelled')
    if (packageCheck.status !== 'passed') return [packageCheck]
    const manifestFile = options.workspace.readProjectFile(project.id, 'autoforge.json')
    const manifest = parseManifest(manifestFile.content)
    const syntaxCheck = await options.checks.checkScriptSyntax(project.rootPath, manifest)
    emitCheck(callback, project.id, turnId, syntaxCheck)
    if (signal?.aborted) throw new Error('turn cancelled')
    return [packageCheck, syntaxCheck]
  }

  async function importProject(projectId: string, turnId: string, callback?: (event: AiAgentEvent) => void): Promise<{ id: string; name: string }> {
    const project = options.repository.getProject(projectId)
    if (!project) throw new Error('AI 项目不存在')
    setStatus(projectId, 'importing')
    try {
      const linkedScript = project.importedScriptId ? options.registry.getById(project.importedScriptId) : undefined
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

  function removeProject(id: string): boolean {
    if (activeTurns.has(id)) return false
    return options.repository.removeProject(id)
  }

  async function startTurn(
    projectId: string,
    message: string,
    onEvent?: (event: AiAgentEvent) => void
  ): Promise<AiProjectTurn> {
    if (activeTurns.has(projectId)) throw new Error('项目已有正在运行的任务')
    if (typeof message !== 'string' || !message.trim() || message.length > MAX_USER_MESSAGE_CHARS) {
      throw new Error('用户消息无效或超过长度限制')
    }
    const project = options.repository.getProject(projectId)
    if (!project) throw new Error('AI 项目不存在')
    const resolved = options.profiles.resolveProvider(project.profileId)
    const history = options.repository.listTurns(projectId).slice(-MAX_HISTORY_TURNS)
    const createdAt = now()
    const userTurn = options.repository.appendTurn(projectId, {
      id: idFactory(), role: 'user', content: message, status: 'complete', createdAt
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
    })
    let accumulatedText = ''
    const allChecks: ProjectCheckResult[] = []
    let changedFiles = false
    let imported = false
    let toolCallCount = 0
    const messages = buildMessages(project, history, userTurn.content)

    const finishTurn = (status: AiProjectTurn['status']): AiProjectTurn => {
      const finished = options.repository.updateTurn(projectId, assistantTurn.id, {
        content: accumulatedText,
        status,
        checks: allChecks,
        importedScriptId: options.repository.getProject(projectId)?.importedScriptId
      })
      const result = finished ?? { ...assistantTurn, content: accumulatedText, status, checks: allChecks }
      safeEmit(onEvent, { type: 'turn_finished', projectId, turnId: assistantTurn.id, status })
      return result
    }

    try {
      setStatus(projectId, 'generating')
      for (let round = 0; round < maxToolRounds; round += 1) {
        if (controller.signal.aborted) throw new Error('turn cancelled')
        if (messageChars(messages) > MAX_CONTEXT_CHARS) throw new Error('对话内容超过上下文限制')
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
          if (changedFiles && !imported) {
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
              if (result.fileChanges.applied.length > 0) changedFiles = true
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

  async function retryChecks(projectId: string): Promise<AiProjectTurn> {
    if (activeTurns.has(projectId)) throw new Error('项目已有正在运行的任务')
    const project = options.repository.getProject(projectId)
    if (!project) throw new Error('AI 项目不存在')
    const turn = options.repository.appendTurn(projectId, {
      id: idFactory(), role: 'assistant', content: '重新检查项目文件', status: 'running', createdAt: now()
    })
    const controller = new AbortController()
    activeTurns.set(projectId, { controller, turnId: turn.id })
    const currentStatus = options.repository.getProject(projectId)?.status
    if (currentStatus === 'ready' || currentStatus === 'interrupted') setStatus(projectId, 'generating')
    try {
      setStatus(projectId, 'checking')
      const checks = await runChecks(project, turn.id, undefined, controller.signal)
      if (controller.signal.aborted) throw new Error('turn cancelled')
      const failed = checks.some((check) => check.status !== 'passed')
      let importedScriptId: string | undefined
      if (failed) {
        setStatus(projectId, 'blocked')
      } else {
        const script = await importProject(projectId, turn.id)
        importedScriptId = script.id
      }
      return options.repository.updateTurn(projectId, turn.id, {
        status: 'complete', checks, importedScriptId
      }) ?? { ...turn, status: 'complete', checks, importedScriptId }
    } catch (error) {
      if (isAbort(error, controller.signal)) {
        options.repository.updateProject(projectId, { status: 'interrupted' })
        return options.repository.updateTurn(projectId, turn.id, { status: 'cancelled' }) ?? { ...turn, status: 'cancelled' }
      }
      options.repository.updateProject(projectId, { status: 'error' })
      return options.repository.updateTurn(projectId, turn.id, {
        status: 'error', content: error instanceof Error ? error.message : '检查失败'
      }) ?? { ...turn, status: 'error' }
    } finally {
      activeTurns.delete(projectId)
    }
  }

  function cancelTurn(projectId: string): boolean {
    const active = activeTurns.get(projectId)
    if (!active) return false
    active.controller.abort()
    return true
  }

  return { createProject, listProjects, getProject, removeProject, startTurn, cancelTurn, retryChecks }
}

function serializeToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : '工具调用失败'
  return JSON.stringify({ error: message.slice(0, 500) })
}
