/** SQLite schema v1 — embedded for packaged builds */
export const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color_preset TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category_overrides (
  key TEXT PRIMARY KEY,
  label TEXT,
  color_preset TEXT
);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  variables TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  workspace_path TEXT NOT NULL,
  category TEXT NOT NULL,
  category_label TEXT NOT NULL,
  category_color TEXT NOT NULL,
  icon TEXT NOT NULL,
  icon_color TEXT NOT NULL,
  icon_bg TEXT NOT NULL,
  icon_border TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  entry TEXT NOT NULL DEFAULT 'index.mjs',
  env_schema TEXT NOT NULL DEFAULT '[]',
  param_schema TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT,
  browser TEXT
);

CREATE TABLE IF NOT EXISTS script_preferences (
  script_id TEXT PRIMARY KEY REFERENCES scripts(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  recent_run_at TEXT,
  schedule TEXT,
  default_env_id TEXT,
  config_by_env TEXT NOT NULL DEFAULT '{}',
  params_by_env TEXT NOT NULL DEFAULT '{}',
  saved_params TEXT
);

CREATE TABLE IF NOT EXISTS execution_records (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  script_name TEXT NOT NULL,
  status TEXT NOT NULL,
  env_id TEXT,
  trigger TEXT NOT NULL DEFAULT 'manual',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  error_message TEXT,
  duration_ms INTEGER,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_exec_started_at ON execution_records(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_script_started ON execution_records(script_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scripts_category ON scripts(category);
`
