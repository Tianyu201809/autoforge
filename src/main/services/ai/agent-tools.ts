import type { LlmToolDefinition } from '../../../shared/ai-types'
import type { AiProject, ProjectChangeResult } from '../../../shared/ai-workspace-types'
import type { ScriptManifest } from '../../../shared/script-contract'

const MAX_AGENT_FILE_CONTENT_CHARS = 120_000
const MAX_LISTED_PROJECT_FILES = 500
import type { ProjectCheckResult } from './project-checks'

export interface AgentToolExecution {
  content: string
  fileChanges?: ProjectChangeResult
  checks?: ProjectCheckResult[]
  importedScriptId?: string
}

export interface AgentToolDependencies {
  workspace: {
    listProjectFiles(projectId: string): Promise<unknown[]>
    readProjectFile(projectId: string, path: string): unknown
    applyProjectChanges(
      projectId: string,
      changes: Array<{ path: string; content: string }>,
      expectedHashes: Record<string, string | null>
    ): Promise<ProjectChangeResult>
  }
  checks: {
    checkScriptPackage(projectPath: string): Promise<ProjectCheckResult>
    checkScriptSyntax(projectPath: string, manifest: ScriptManifest): Promise<ProjectCheckResult>
  }
  importScript(project: AiProject): Promise<{ scriptId: string; name: string }>
}

export const AGENT_TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    name: 'list_project_files',
    description: '列出项目根目录中的普通文件及其内容哈希。',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'read_project_file',
    description: '读取项目根目录内的 UTF-8 文本文件。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'write_project_files',
    description: '按已读取的 SHA-256 版本写入或新增项目文本文件。',
    parameters: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
            additionalProperties: false
          }
        },
        expectedHashes: { type: 'object', additionalProperties: { type: ['string', 'null'] } }
      },
      required: ['changes', 'expectedHashes'],
      additionalProperties: false
    }
  },
  {
    name: 'validate_script_package',
    description: '检查 Autoforge 脚本包清单和入口文件。',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'check_script_syntax',
    description: '用固定语法检查器检查 JavaScript 或 Python 入口，不运行脚本。',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'import_script',
    description: '重新执行包校验和语法检查，通过后导入或更新 Autoforge 脚本。',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  }
]

const ALLOWED_TOOL_NAMES = new Set(AGENT_TOOL_DEFINITIONS.map((tool) => tool.name))

function parseArguments(argumentsJson: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    throw new Error('工具参数必须是有效 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('工具参数必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

function assertOnlyKeys(args: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error('工具参数包含未支持字段')
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`工具参数 ${field} 无效`)
  return value
}

function serialize(value: unknown): string {
  return JSON.stringify(value)
}

export function createAgentTools(dependencies: AgentToolDependencies) {
  async function execute(toolName: string, argumentsJson: string, project: AiProject): Promise<AgentToolExecution> {
    if (!ALLOWED_TOOL_NAMES.has(toolName)) throw new Error(`Agent 工具不允许: ${toolName}`)
    const args = parseArguments(argumentsJson)

    if (toolName === 'list_project_files') {
      assertOnlyKeys(args, [])
      const files = await dependencies.workspace.listProjectFiles(project.id)
      return { content: serialize({ files: files.slice(0, MAX_LISTED_PROJECT_FILES), truncated: files.length > MAX_LISTED_PROJECT_FILES }) }
    }

    if (toolName === 'read_project_file') {
      assertOnlyKeys(args, ['path'])
      const path = requireString(args.path, 'path')
      if (!path.trim()) throw new Error('工具参数 path 无效')
      const file = dependencies.workspace.readProjectFile(project.id, path) as { content?: unknown }
      if (typeof file.content === 'string' && file.content.length > MAX_AGENT_FILE_CONTENT_CHARS) {
        throw new Error('文件超过 Agent 上下文限制，请改读更小的文件')
      }
      return { content: serialize(file) }
    }

    if (toolName === 'write_project_files') {
      assertOnlyKeys(args, ['changes', 'expectedHashes'])
      if (!Array.isArray(args.changes) || args.changes.length === 0) throw new Error('工具参数 changes 无效')
      const changes = args.changes.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('工具参数 changes 无效')
        const change = item as Record<string, unknown>
        assertOnlyKeys(change, ['path', 'content'])
        return {
          path: requireString(change.path, 'changes.path'),
          content: requireString(change.content, 'changes.content')
        }
      })
      if (!args.expectedHashes || typeof args.expectedHashes !== 'object' || Array.isArray(args.expectedHashes)) {
        throw new Error('工具参数 expectedHashes 无效')
      }
      const expectedHashes = args.expectedHashes as Record<string, unknown>
      for (const change of changes) {
        if (!Object.hasOwn(expectedHashes, change.path)) throw new Error(`缺少文件版本: ${change.path}`)
      }
      for (const [path, hash] of Object.entries(expectedHashes)) {
        if (!path || (hash !== null && typeof hash !== 'string')) throw new Error('工具参数 expectedHashes 无效')
      }
      const result = await dependencies.workspace.applyProjectChanges(
        project.id,
        changes,
        expectedHashes as Record<string, string | null>
      )
      return { content: serialize(result), fileChanges: result }
    }

    if (toolName === 'validate_script_package') {
      assertOnlyKeys(args, [])
      const result = await dependencies.checks.checkScriptPackage(project.rootPath)
      return { content: serialize(result), checks: [result] }
    }

    if (toolName === 'check_script_syntax' || toolName === 'import_script') {
      assertOnlyKeys(args, [])
      const packageResult = await dependencies.checks.checkScriptPackage(project.rootPath)
      const checks = [packageResult]
      if (packageResult.status !== 'passed') return { content: serialize({ checks }), checks }
      const manifestContent = dependencies.workspace.readProjectFile(project.id, 'autoforge.json') as { content?: unknown }
      if (typeof manifestContent.content !== 'string') throw new Error('脚本清单内容无效')
      let manifest: ScriptManifest
      try {
        const parsed: unknown = JSON.parse(manifestContent.content)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid manifest')
        manifest = parsed as ScriptManifest
      } catch {
        throw new Error('脚本清单内容无效')
      }
      const syntaxResult = await dependencies.checks.checkScriptSyntax(project.rootPath, manifest)
      checks.push(syntaxResult)
      if (toolName === 'check_script_syntax' || syntaxResult.status !== 'passed') {
        return { content: serialize({ checks }), checks }
      }
      const imported = await dependencies.importScript(project)
      return {
        content: serialize({ ...imported, checks }),
        checks,
        importedScriptId: imported.scriptId
      }
    }

    throw new Error(`Agent 工具不允许: ${toolName}`)
  }

  return { definitions: AGENT_TOOL_DEFINITIONS, execute }
}
