import type { ScriptMeta } from '../../shared/types/script'
import { scriptStore } from './script-store'
import { scriptWorkspace } from './script-workspace'

export class ScriptRegistry {
  listAll(): ScriptMeta[] {
    return scriptStore.getScripts()
  }

  getById(id: string): ScriptMeta | undefined {
    return scriptStore.getScriptById(id)
  }

  importFromPath(sourcePath: string): ScriptMeta {
    const meta = scriptWorkspace.import(sourcePath)
    return scriptStore.addScript(meta)
  }

  update(id: string, patch: Partial<ScriptMeta>): ScriptMeta | null {
    return scriptStore.updateScript(id, patch)
  }

  delete(id: string): boolean {
    const ok = scriptStore.deleteScript(id)
    if (ok) {
      scriptWorkspace.deleteScript(id)
    }
    return ok
  }

  refreshFromWorkspace(): void {
    const ids = scriptWorkspace.listScriptIds()
    const existing = new Set(scriptStore.getScripts().map((s) => s.id))
    for (const id of ids) {
      if (existing.has(id)) continue
      try {
        const manifest = scriptWorkspace.readManifest(scriptWorkspace.getScriptDir(id))
        const meta = scriptWorkspace.manifestToMeta(id, manifest)
        scriptStore.addScript(meta as ScriptMeta)
      } catch {
        /* skip invalid packages */
      }
    }
  }
}

export const scriptRegistry = new ScriptRegistry()
