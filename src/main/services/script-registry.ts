import type { ScriptMeta } from '../../shared/types/script'
import { existsSync, statSync } from 'fs'
import { scriptStore } from './script-store'
import { scriptWorkspace } from './script-workspace'

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

  importFromPath(sourcePath: string): ScriptMeta {
    const meta = scriptWorkspace.import(sourcePath)
    try {
      return scriptStore.addScript(meta)
    } catch (err) {
      scriptWorkspace.deleteScript(meta.id, meta.workspacePath)
      throw err
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
