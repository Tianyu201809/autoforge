import type { SqliteDatabase } from '../database'
import type { PipelineMeta } from '../../../shared/types/script'

interface PipelineRow {
  id: string
  name: string
  description: string
  nodes: string
  env_schema: string
  param_schema: string
  imported_at: string
  starred: number
  archived: number
  recent_run_at: string | null
  config_by_env: string
  params_by_env: string
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function rowToPipeline(row: PipelineRow): PipelineMeta {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    nodes: parseJson(row.nodes, []),
    envSchema: parseJson(row.env_schema, []),
    paramSchema: parseJson(row.param_schema, []),
    configByEnv: parseJson(row.config_by_env, {}),
    paramsByEnv: parseJson(row.params_by_env, {}),
    starred: row.starred === 1,
    archived: row.archived === 1,
    recentRunAt: row.recent_run_at ?? undefined
  }
}

const JOIN = `
  SELECT p.id, p.name, p.description, p.nodes, p.env_schema, p.param_schema, p.imported_at,
    pref.starred, pref.archived, pref.recent_run_at, pref.config_by_env, pref.params_by_env
  FROM pipelines p
  LEFT JOIN pipeline_preferences pref ON pref.pipeline_id = p.id
`

export class PipelineRepository {
  constructor(private db: SqliteDatabase) {}

  listAll(): PipelineMeta[] {
    return this.db.prepare(`${JOIN} ORDER BY p.name ASC`).all().map((row) => rowToPipeline(row as PipelineRow))
  }

  getById(id: string): PipelineMeta | undefined {
    const row = this.db.prepare(`${JOIN} WHERE p.id = ?`).get(id)
    return row ? rowToPipeline(row as PipelineRow) : undefined
  }

  insert(meta: PipelineMeta): void {
    this.db
      .prepare(
        `INSERT INTO pipelines (id, name, description, nodes, env_schema, param_schema, imported_at)
         VALUES (@id, @name, @description, @nodes, @env_schema, @param_schema, @imported_at)`
      )
      .run({
        id: meta.id,
        name: meta.name,
        description: meta.description ?? '',
        nodes: JSON.stringify(meta.nodes),
        env_schema: JSON.stringify(meta.envSchema),
        param_schema: JSON.stringify(meta.paramSchema),
        imported_at: new Date().toISOString()
      })
    this.upsertPreference(meta.id, meta)
  }

  update(id: string, patch: Partial<PipelineMeta>): PipelineMeta | undefined {
    const current = this.getById(id)
    if (!current) return undefined
    const next = { ...current, ...patch }
    this.db
      .prepare(
        `UPDATE pipelines SET name = @name, description = @description, nodes = @nodes,
          env_schema = @env_schema, param_schema = @param_schema WHERE id = @id`
      )
      .run({
        id,
        name: next.name,
        description: next.description ?? '',
        nodes: JSON.stringify(next.nodes),
        env_schema: JSON.stringify(next.envSchema),
        param_schema: JSON.stringify(next.paramSchema)
      })
    this.upsertPreference(id, next)
    return this.getById(id)
  }

  delete(id: string): boolean {
    this.db.prepare('DELETE FROM pipeline_execution_records WHERE pipeline_id = ?').run(id)
    this.db.prepare('DELETE FROM pipeline_preferences WHERE pipeline_id = ?').run(id)
    return this.db.prepare('DELETE FROM pipelines WHERE id = ?').run(id).changes > 0
  }

  private upsertPreference(id: string, meta: PipelineMeta): void {
    this.db
      .prepare(
        `INSERT INTO pipeline_preferences
          (pipeline_id, starred, archived, recent_run_at, config_by_env, params_by_env)
         VALUES (@pipeline_id, @starred, @archived, @recent_run_at, @config_by_env, @params_by_env)
         ON CONFLICT(pipeline_id) DO UPDATE SET
          starred = excluded.starred, archived = excluded.archived,
          recent_run_at = excluded.recent_run_at, config_by_env = excluded.config_by_env,
          params_by_env = excluded.params_by_env`
      )
      .run({
        pipeline_id: id,
        starred: meta.starred ? 1 : 0,
        archived: meta.archived ? 1 : 0,
        recent_run_at: meta.recentRunAt ?? null,
        config_by_env: JSON.stringify(meta.configByEnv ?? {}),
        params_by_env: JSON.stringify(meta.paramsByEnv ?? {})
      })
  }
}
