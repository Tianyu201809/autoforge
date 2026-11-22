import type { ScriptMeta } from '../../shared/types/script'
import { existsSync, lstatSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { ScriptStore, scriptStore } from './script-store'
import { ScriptWorkspace, scriptWorkspace } from './script-workspace'
import { inspectScriptImport, inspectPreparedPackage, withPreparedImportSource } from './script-import-source'
import type { ScriptImportInspection } from '../../shared/types/script'

function resolveWorkspaceImportedAt(workspacePath: string): string {
  if (workspacePath && existsSync(workspacePath)) {
    const stat = statSync(workspacePath)
    const time = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime
    return time.toISOString()
  }
  return new Date().toISOString()
}

function assertProjectPackageHasNoLinks(sourceDir: string): void {
  const root = lstatSync(sourceDir)
  if (root.isSymbolicLink() || !root.isDirectory()) throw new Error('项目包目录无效或包含符号链接')
  const pending = [sourceDir]
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      const relativePath = relative(sourceDir, path).replace(/\\/g, '/')
      if (stat.isSymbolicLink()) throw new Error(`项目包不能包含符号链接: ${relativePath}`)
      if (stat.isDirectory()) pending.push(path)
      else if (!stat.isFile()) throw new Error(`项目包不能包含特殊文件: ${relativePath}`)
    }
  }
}

export class ScriptRegistry {
  constructor(
    private readonly store: ScriptStore = scriptStore,
    private readonly workspace: ScriptWorkspace = scriptWorkspace
  ) {}

  listAll(): ScriptMeta[] {
    return this.store.getScripts()
  }

  getById(id: string): ScriptMeta | undefined {
    return this.store.getScriptById(id)
  }

  getByHubScriptId(hubScriptId: string): ScriptMeta | undefined {
    return this.store.getScriptByHubScriptId(hubScriptId)
  }

  inspectImport(sourcePath: string): ScriptImportInspection {
    return inspectScriptImport(sourcePath)
  }

  importFromPath(
    sourcePath: string,
    options?: { hubScriptId?: string; selectedEntry?: string }
  ): ScriptMeta {
    const imported = withPreparedImportSource(sourcePath, (source) => {
      if (source.singleScriptLanguage) return this.workspace.importFromFile(sourcePath)
      if (source.hasManifest) return this.workspace.importFromDirectory(source.packageRoot)
      const inspection = inspectPreparedPackage(source)
      const selectedEntry = options?.selectedEntry ?? (
        inspection.kind === 'ready' ? inspection.candidate?.entry : undefined
      )
      return this.workspace.importExecutableSource(
        sourcePath,
        source.packageRoot,
        selectedEntry,
        source.singleFileCandidate
      )
    })
    const meta = {
      ...imported,
      hubScriptId: options?.hubScriptId?.trim() || undefined
    }
    try {
      return this.store.addScript(meta)
    } catch (err) {
      this.workspace.deleteScript(meta.id, meta.workspacePath)
      throw err
    }
  }

  updateFromHubPackage(scriptId: string, sourceDir: string): ScriptMeta {
    const existing = this.store.getScriptById(scriptId)
    if (!existing?.hubScriptId) throw new Error('Hub 脚本不存在或缺少稳定 ID')
    try {
      return this.workspace.replaceFromDirectory(existing, sourceDir, (meta) => {
        const updated = this.store.updateScript(scriptId, meta)
        if (!updated) throw new Error('无法更新 Hub 脚本元数据')
        return updated
      })
    } catch (error) {
      this.store.updateScript(scriptId, existing)
      throw error
    }
  }

  updateFromProject(scriptId: string, sourceDir: string): ScriptMeta {
    const existing = this.store.getScriptById(scriptId)
    if (!existing) throw new Error('关联的 Autoforge 脚本不存在')
    if (existing.hubScriptId) throw new Error('不能通过 AI 项目更新 Hub 脚本')
    assertProjectPackageHasNoLinks(sourceDir)
    try {
      return this.workspace.replaceFromDirectory(existing, sourceDir, (meta) => {
        const updated = this.store.updateScript(scriptId, { ...meta, hubScriptId: undefined })
        if (!updated) throw new Error('无法更新项目关联脚本元数据')
        return updated
      })
    } catch (error) {
      this.store.updateScript(scriptId, existing)
      throw error
    }
  }

  update(id: string, patch: Partial<ScriptMeta>): ScriptMeta | null {
    return this.store.updateScript(id, patch)
  }

  delete(id: string): boolean {
    const scriptId = id?.trim()
    if (!scriptId) return false

    const script = this.store.getScriptById(scriptId)
    if (!script) {
      this.workspace.deleteScript(scriptId)
      return true
    }

    const workspacePath = script.workspacePath
    this.store.deleteExecutableTrust(scriptId)
    const dbDeleted = this.store.deleteScript(scriptId)
    this.workspace.deleteScript(scriptId, workspacePath)
    return dbDeleted || !this.store.getScriptById(scriptId)
  }

  refreshFromWorkspace(): void {
    const ids = this.workspace.listScriptIds()
    const existing = new Set(this.store.getScripts().map((s) => s.id))
    for (const id of ids) {
      if (existing.has(id)) continue
      try {
        const manifest = this.workspace.readManifest(this.workspace.getScriptDir(id))
        const meta = this.workspace.manifestToMeta(id, manifest)
        this.store.addScript({
          ...meta,
          importedAt: resolveWorkspaceImportedAt(meta.workspacePath)
        } as ScriptMeta)
      } catch {
        /* skip invalid packages */
      }
    }
  }
}

export const scriptRegistry = new ScriptRegistry()
