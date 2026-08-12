import type {
  CreateScriptInput,
  GetEnvironmentInput,
  ReadScriptFileInput,
  SanitizedEnvironment,
  ScriptListInput,
  ScriptListOutput,
  SetScriptValuesInput,
  StartScriptInput,
  UpdateScriptMetaInput,
  WriteScriptFileInput
} from '../../shared/mcp-types'
import type {
  AppConfig,
  EnvironmentProfile,
  ExecutionHistoryPage,
  ExecutionHistoryQuery,
  RunSession,
  ScriptFileContent,
  ScriptItem,
  ScriptWorkspaceFilesInfo
} from '../../shared/types/script'
import { MANIFEST_FILENAME } from '../../shared/script-contract'
import { scriptRegistry } from './script-registry'
import { scriptStore } from './script-store'
import { scriptWorkspace } from './script-workspace'
import { executionHistory } from './execution-history'
import { enrichScriptItem } from './script-runner'
import type { AutoforgeRuntime } from './runtime-container'
import { sanitizeEnvironment, sanitizeScriptItem } from './mcp-sanitizers'
import { createScriptFromPayload, readWorkspaceFileWithLimit, writeWorkspaceFileAtomic } from './mcp-workspace-io'

export interface AutoforgeControlFacade {
  listScripts(input?: ScriptListInput): ScriptListOutput
  getScript(scriptId: string): ScriptItem | null
  listScriptFiles(scriptId: string): ScriptWorkspaceFilesInfo | null
  readScriptFile(input: ReadScriptFileInput): ScriptFileContent | null
  createScript(input: CreateScriptInput): ScriptItem
  importScript(sourcePath: string): ScriptItem
  writeScriptFile(input: WriteScriptFileInput): ScriptItem | null
  updateScriptMeta(input: UpdateScriptMetaInput): ScriptItem | null
  deleteScript(scriptId: string): boolean
  listEnvironments(): EnvironmentProfile[]
  getEnvironment(input: GetEnvironmentInput): SanitizedEnvironment | null
  createEnvironment(profile: Omit<EnvironmentProfile, 'id'>): EnvironmentProfile
  updateEnvironment(id: string, patch: Partial<EnvironmentProfile>): EnvironmentProfile | null
  deleteEnvironment(id: string): boolean
  setScriptEnv(input: SetScriptValuesInput): ScriptItem | null
  setScriptParams(input: SetScriptValuesInput): ScriptItem | null
  startScript(input: StartScriptInput): Promise<RunSession>
  stopSession(sessionId: string): RunSession | null
  stopScript(scriptId: string): void
  listSessions(): RunSession[]
  getSession(sessionId: string): RunSession | undefined
  queryHistory(query?: ExecutionHistoryQuery): ExecutionHistoryPage
  getConfig(): AppConfig
}

function sortScripts(items: ScriptItem[], input: ScriptListInput): ScriptItem[] {
  const sortBy = input.sortBy ?? 'name'
  const direction = input.sortOrder === 'desc' ? -1 : 1
  return [...items].sort((a, b) => {
    const left = sortBy === 'recentRun' ? a.recentRunAt ?? '' : sortBy === 'importedAt' ? a.importedAt ?? '' : a.name
    const right = sortBy === 'recentRun' ? b.recentRunAt ?? '' : sortBy === 'importedAt' ? b.importedAt ?? '' : b.name
    return left.localeCompare(right, 'zh-CN') * direction
  })
}

function matchesScript(item: ScriptItem, input: ScriptListInput): boolean {
  const query = input.query?.trim().toLocaleLowerCase()
  if (query && !`${item.name} ${item.description} ${item.id}`.toLocaleLowerCase().includes(query)) return false
  if (input.archived !== undefined && item.archived !== input.archived) return false
  if (input.status && input.status !== 'all' && item.status !== input.status) return false
  return true
}

class ControlFacade implements AutoforgeControlFacade {
  constructor(private readonly runtime: AutoforgeRuntime) {}

  listScripts(input: ScriptListInput = {}): ScriptListOutput {
    const items = sortScripts(
      scriptRegistry.listAll()
        .map((meta) => enrichScriptItem(meta, this.runtime.runner.listSessions()))
        .filter((item) => matchesScript(item, input)),
      input
    )
    const offset = Math.max(0, input.offset ?? 0)
    const limit = Math.min(100, Math.max(1, input.limit ?? 50))
    return { scripts: items.slice(offset, offset + limit).map(sanitizeScriptItem), total: items.length }
  }

  getScript(scriptId: string): ScriptItem | null {
    const script = scriptRegistry.getById(scriptId)
    return script ? sanitizeScriptItem(enrichScriptItem(script, this.runtime.runner.listSessions())) : null
  }

  listScriptFiles(scriptId: string): ScriptWorkspaceFilesInfo | null {
    const script = scriptRegistry.getById(scriptId)
    if (!script) return null
    return {
      entryPath: script.entry,
      manifestPath: MANIFEST_FILENAME,
      files: scriptWorkspace.listWorkspaceFiles(script)
    }
  }

  readScriptFile(input: ReadScriptFileInput): ScriptFileContent | null {
    const script = scriptRegistry.getById(input.scriptId)
    if (!script) return null
    return readWorkspaceFileWithLimit(script, input.relativePath, input.limit)
  }

  createScript(input: CreateScriptInput): ScriptItem {
    const meta = createScriptFromPayload(input)
    try {
      const script = scriptStore.addScript(meta)
      this.runtime.scheduler.reload(scriptRegistry.listAll())
      return sanitizeScriptItem(enrichScriptItem(script, this.runtime.runner.listSessions()))
    } catch (error) {
      scriptWorkspace.deleteScript(meta.id, meta.workspacePath)
      throw error
    }
  }

  importScript(sourcePath: string): ScriptItem {
    const script = scriptRegistry.importFromPath(sourcePath)
    this.runtime.scheduler.reload(scriptRegistry.listAll())
    return sanitizeScriptItem(enrichScriptItem(script, this.runtime.runner.listSessions()))
  }

  writeScriptFile(input: WriteScriptFileInput): ScriptItem | null {
    const script = scriptRegistry.getById(input.scriptId)
    if (!script) return null
    writeWorkspaceFileAtomic(script, input.relativePath, input.content, input.encoding)
    if (input.relativePath === MANIFEST_FILENAME || input.relativePath === 'scriptbox.json') {
      const manifest = scriptWorkspace.readManifest(script.workspacePath)
      scriptRegistry.update(input.scriptId, scriptWorkspace.manifestToMeta(input.scriptId, manifest))
    }
    return this.getScript(input.scriptId)
  }

  updateScriptMeta(input: UpdateScriptMetaInput): ScriptItem | null {
    const script = scriptRegistry.getById(input.scriptId)
    if (!script) return null
    const manifest = scriptWorkspace.updateManifestMeta(script, input.patch)
    const updated = scriptRegistry.update(input.scriptId, scriptWorkspace.manifestToMeta(input.scriptId, manifest))
    return updated ? sanitizeScriptItem(enrichScriptItem(updated, this.runtime.runner.listSessions())) : null
  }

  deleteScript(scriptId: string): boolean {
    this.runtime.runner.stopAllForScript(scriptId)
    const deleted = scriptRegistry.delete(scriptId)
    if (deleted) this.runtime.scheduler.reload(scriptRegistry.listAll())
    return deleted
  }

  listEnvironments(): EnvironmentProfile[] {
    return scriptStore.getEnvironments()
  }

  getEnvironment(input: GetEnvironmentInput): SanitizedEnvironment | null {
    const environment = scriptStore.getEnvironment(input.envId)
    if (!environment) return null
    const script = input.scriptId ? scriptRegistry.getById(input.scriptId) : undefined
    return sanitizeEnvironment(environment, script)
  }

  createEnvironment(profile: Omit<EnvironmentProfile, 'id'>): EnvironmentProfile {
    return scriptStore.addEnvironment(profile)
  }

  updateEnvironment(id: string, patch: Partial<EnvironmentProfile>): EnvironmentProfile | null {
    return scriptStore.updateEnvironment(id, patch)
  }

  deleteEnvironment(id: string): boolean {
    return scriptStore.deleteEnvironment(id)
  }

  setScriptEnv(input: SetScriptValuesInput): ScriptItem | null {
    const updated = scriptStore.setScriptEnvConfig(input.scriptId, input.envId, input.values)
    return updated ? sanitizeScriptItem(enrichScriptItem(updated, this.runtime.runner.listSessions())) : null
  }

  setScriptParams(input: SetScriptValuesInput): ScriptItem | null {
    const updated = scriptStore.setScriptParams(input.scriptId, input.envId, input.values)
    return updated ? sanitizeScriptItem(enrichScriptItem(updated, this.runtime.runner.listSessions())) : null
  }

  startScript(input: StartScriptInput): Promise<RunSession> {
    return this.runtime.runner.start(input.scriptId, input.envId, input.params, {
      persistParams: input.persistParams ?? false,
      browserOverride: input.browserOverride,
      interactive: false
    })
  }

  stopSession(sessionId: string): RunSession | null {
    return this.runtime.runner.stop(sessionId)
  }

  stopScript(scriptId: string): void {
    this.runtime.runner.stopAllForScript(scriptId)
  }

  listSessions(): RunSession[] {
    return this.runtime.runner.listSessions()
  }

  getSession(sessionId: string): RunSession | undefined {
    return this.runtime.runner.getSession(sessionId)
  }

  queryHistory(query: ExecutionHistoryQuery = {}): ExecutionHistoryPage {
    return executionHistory.queryPage(query)
  }

  getConfig(): AppConfig {
    return scriptStore.getConfig()
  }
}

export function createAutoforgeControlFacade(runtime: AutoforgeRuntime): AutoforgeControlFacade {
  return new ControlFacade(runtime)
}
