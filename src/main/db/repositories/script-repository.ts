import type { SqliteDatabase } from '../database'
import type { ScriptMeta } from '../../../shared/types/script'
import type { ScriptPreference } from '../../../shared/types/script'
import {
  extractPreferenceFromMeta,
  preferenceToRow,
  rowToPreference,
  rowToScriptBase,
  scriptMetaToScriptRow
} from '../row-mappers'

const SCRIPT_JOIN = `
  SELECT
    s.id, s.hub_script_id, s.name, s.description, s.workspace_path, s.category, s.category_label,
    s.category_color, s.icon, s.icon_color, s.icon_bg, s.icon_border, s.version,
    s.entry, s.imported_at, s.env_schema, s.param_schema, s.dependencies, s.browser,
    p.starred, p.archived, p.recent_run_at, p.schedule, p.default_env_id,
    p.config_by_env, p.params_by_env, p.saved_params
  FROM scripts s
  LEFT JOIN script_preferences p ON p.script_id = s.id
`

export class ScriptRepository {
  constructor(private db: SqliteDatabase) {}

  listAll(): ScriptMeta[] {
    const rows = this.db.prepare(`${SCRIPT_JOIN} ORDER BY s.name ASC`).all()
    return rows.map((row) => rowToScriptBase(row as Parameters<typeof rowToScriptBase>[0]))
  }

  getById(id: string): ScriptMeta | undefined {
    const row = this.db.prepare(`${SCRIPT_JOIN} WHERE s.id = ?`).get(id)
    return row ? rowToScriptBase(row as Parameters<typeof rowToScriptBase>[0]) : undefined
  }

  getByHubScriptId(hubScriptId: string): ScriptMeta | undefined {
    const normalized = hubScriptId.trim()
    if (!normalized) return undefined
    const row = this.db.prepare(`${SCRIPT_JOIN} WHERE s.hub_script_id = ?`).get(normalized)
    return row ? rowToScriptBase(row as Parameters<typeof rowToScriptBase>[0]) : undefined
  }

  insert(meta: Omit<ScriptMeta, 'starred' | 'archived'>): void {
    const scriptRow = {
      ...scriptMetaToScriptRow(meta),
      imported_at: meta.importedAt ?? new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO scripts (
          id, hub_script_id, name, description, workspace_path, category, category_label, category_color,
          icon, icon_color, icon_bg, icon_border, version, entry, imported_at, env_schema, param_schema,
          dependencies, browser
        ) VALUES (
          @id, @hub_script_id, @name, @description, @workspace_path, @category, @category_label, @category_color,
          @icon, @icon_color, @icon_bg, @icon_border, @version, @entry, @imported_at, @env_schema, @param_schema,
          @dependencies, @browser
        )`
      )
      .run(scriptRow)

    this.upsertPreference(meta.id, { starred: false, archived: false })
  }

  updateMeta(id: string, patch: Partial<ScriptMeta>): boolean {
    const current = this.getById(id)
    if (!current) return false

    const {
      starred,
      archived,
      recentRunAt,
      schedule,
      defaultEnvId,
      configByEnv,
      paramsByEnv,
      savedParams,
      ...metaPatch
    } = patch

    if (Object.keys(metaPatch).length > 0) {
      const next = { ...current, ...metaPatch }
      const row = scriptMetaToScriptRow(next)
      this.db
        .prepare(
          `UPDATE scripts SET
            hub_script_id = @hub_script_id, name = @name, description = @description, workspace_path = @workspace_path,
            category = @category, category_label = @category_label, category_color = @category_color,
            icon = @icon, icon_color = @icon_color, icon_bg = @icon_bg, icon_border = @icon_border,
            version = @version, entry = @entry, imported_at = @imported_at, env_schema = @env_schema, param_schema = @param_schema,
            dependencies = @dependencies, browser = @browser
           WHERE id = @id`
        )
        .run(row)
    }

    const prefPatch = extractPreferenceFromMeta({
      starred,
      archived,
      recentRunAt,
      schedule,
      defaultEnvId,
      configByEnv,
      paramsByEnv,
      savedParams
    })
    if (Object.keys(prefPatch).length > 0) {
      this.mergePreference(id, prefPatch)
    }

    return true
  }

  delete(id: string): boolean {
    this.db.prepare('DELETE FROM script_preferences WHERE script_id = ?').run(id)
    this.db.prepare('DELETE FROM execution_records WHERE script_id = ?').run(id)
    const result = this.db.prepare('DELETE FROM scripts WHERE id = ?').run(id)
    return result.changes > 0
  }

  getPreference(id: string): ScriptPreference {
    const row = this.db.prepare('SELECT * FROM script_preferences WHERE script_id = ?').get(id) as
      | Parameters<typeof rowToPreference>[0]
      | undefined
    return row ? rowToPreference(row) : {}
  }

  mergePreference(id: string, patch: ScriptPreference): void {
    const current = this.getPreference(id)
    const next: ScriptPreference = { ...current, ...patch }
    this.upsertPreference(id, next)
  }

  upsertPreference(id: string, pref: ScriptPreference): void {
    const row = preferenceToRow(id, pref)
    this.db
      .prepare(
        `INSERT INTO script_preferences (
          script_id, starred, archived, recent_run_at, schedule, default_env_id,
          config_by_env, params_by_env, saved_params
        ) VALUES (
          @script_id, @starred, @archived, @recent_run_at, @schedule, @default_env_id,
          @config_by_env, @params_by_env, @saved_params
        )
        ON CONFLICT(script_id) DO UPDATE SET
          starred = excluded.starred,
          archived = excluded.archived,
          recent_run_at = excluded.recent_run_at,
          schedule = excluded.schedule,
          default_env_id = excluded.default_env_id,
          config_by_env = excluded.config_by_env,
          params_by_env = excluded.params_by_env,
          saved_params = excluded.saved_params`
      )
      .run(row)
  }

  countByCategory(key: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM scripts WHERE category = ?').get(key) as {
      count: number
    }
    return row.count
  }

  /** 迁移导入：写入脚本及 preference */
  importScript(meta: ScriptMeta, pref: ScriptPreference): void {
    const scriptRow = {
      ...scriptMetaToScriptRow(meta),
      imported_at: meta.importedAt ?? new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO scripts (
          id, hub_script_id, name, description, workspace_path, category, category_label, category_color,
          icon, icon_color, icon_bg, icon_border, version, entry, imported_at, env_schema, param_schema,
          dependencies, browser
        ) VALUES (
          @id, @hub_script_id, @name, @description, @workspace_path, @category, @category_label, @category_color,
          @icon, @icon_color, @icon_bg, @icon_border, @version, @entry, @imported_at, @env_schema, @param_schema,
          @dependencies, @browser
        )`
      )
      .run(scriptRow)

    const mergedPref: ScriptPreference = {
      starred: pref.starred ?? meta.starred ?? false,
      archived: pref.archived ?? meta.archived ?? false,
      recentRunAt: pref.recentRunAt ?? meta.recentRunAt,
      schedule: pref.schedule ?? meta.schedule,
      defaultEnvId: pref.defaultEnvId ?? meta.defaultEnvId,
      configByEnv: pref.configByEnv ?? meta.configByEnv ?? {},
      paramsByEnv: pref.paramsByEnv ?? meta.paramsByEnv ?? {},
      savedParams: pref.savedParams ?? meta.savedParams
    }
    this.upsertPreference(meta.id, mergedPref)
  }
}
