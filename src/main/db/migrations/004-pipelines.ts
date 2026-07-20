export const MIGRATION_004 = `
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  nodes TEXT NOT NULL DEFAULT '[]',
  env_schema TEXT NOT NULL DEFAULT '[]',
  param_schema TEXT NOT NULL DEFAULT '[]',
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_preferences (
  pipeline_id TEXT PRIMARY KEY REFERENCES pipelines(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  recent_run_at TEXT,
  config_by_env TEXT NOT NULL DEFAULT '{}',
  params_by_env TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pipeline_execution_records (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  pipeline_name TEXT NOT NULL,
  status TEXT NOT NULL,
  env_id TEXT,
  trigger TEXT NOT NULL DEFAULT 'manual',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_message TEXT,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_exec_started_at ON pipeline_execution_records(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_exec_pipeline_started ON pipeline_execution_records(pipeline_id, started_at DESC);
`
