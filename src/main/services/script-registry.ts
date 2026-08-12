import type { ScriptMeta } from '../../shared/types/script'
import { existsSync, statSync } from 'fs'
import { scriptStore } from './script-store'
import { scriptWorkspace } from './script-workspace'
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

export class ScriptRegistry {
  listAll(): ScriptMeta[] {
    return scriptStore.getScripts()
  }

  getById(id: string): ScriptMeta | undefined {
    return scriptStore.getScriptById(id)
  }

  getByHubScriptId(hubScriptId: string): ScriptMeta | undefined {
    return scriptStore.getScriptByHubScriptId(hubScriptId)
  }

  inspectImport(sourcePath: string): ScriptImportInspection {
    return inspectScriptImport(sourcePath)
  }

  importFromPath(
    sourcePath: string,
    options?: { hubScriptId?: string; selectedEntry?: string }
  ): ScriptMeta {
    const imported = withPreparedImportSource(sourcePath, (source) => {
      if (source.singleScriptLanguage) return scriptWorkspace.importFromFile(sourcePath)
      if (source.hasManifest) return scriptWorkspace.importFromDirectory(source.packageRoot)
      const inspection = inspectPreparedPackage(source)
      const selectedEntry = options?.selectedEntry ?? (
        inspection.kind === 'ready' ? inspection.candidate?.entry : undefined
      )
      return scriptWorkspace.importExecutableSource(
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
      return scriptStore.addScript(meta)
    } catch (err) {
      scriptWorkspace.deleteScript(meta.id, meta.workspacePath)
      throw err
    }
  }

  updateFromHubPackage(scriptId: string, sourceDir: string): ScriptMeta {
    const existing = scriptStore.getScriptById(scriptId)
    if (!existing?.hubScriptId) throw new Error('Hub 脚本不存在或缺少稳定 ID')
    try {
      return scriptWorkspace.replaceFromDirectory(existing, sourceDir, (meta) => {
        const updated = scriptStore.updateScript(scriptId, meta)
        if (!updated) throw new Error('无法更新 Hub 脚本元数据')
        return updated
      })
    } catch (error) {
      scriptStore.updateScript(scriptId, existing)
      throw error
    }
  }

  update(id: string, patch: Partial<ScriptMeta>): ScriptMeta | null {
    return scriptStore.updateScript(id, patch)
  }

  delete(id: string): boolean {
    const scriptId = id?.trim()
    if (!scriptId) return false

    const script = scriptStore.getScriptById(scriptId)
    if (!script) {
      scriptWorkspace.deleteScript(scriptId)
      return true
    }

    const workspacePath = script.workspacePath
    scriptStore.deleteExecutableTrust(scriptId)
    const dbDeleted = scriptStore.deleteScript(scriptId)
    scriptWorkspace.deleteScript(scriptId, workspacePath)
    return dbDeleted || !scriptStore.getScriptById(scriptId)
  }

  refreshFromWorkspace(): void {
    const ids = scriptWorkspace.listScriptIds()
    const existing = new Set(scriptStore.getScripts().map((s) => s.id))
    for (const id of ids) {
      if (existing.has(id)) continue
      try {
        const manifest = scriptWorkspace.readManifest(scriptWorkspace.getScriptDir(id))
        const meta = scriptWorkspace.manifestToMeta(id, manifest)
        scriptStore.addScript({
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
