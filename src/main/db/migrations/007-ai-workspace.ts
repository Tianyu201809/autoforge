/** SQLite schema v7 for local AI projects and persisted conversation turns. */
export const MIGRATION_007 = `
CREATE TABLE IF NOT EXISTS ai_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL CHECK (language IN ('javascript', 'python')),
  profile_id TEXT NOT NULL,
  imported_script_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ready', 'generating', 'applying', 'checking', 'importing', 'blocked', 'error', 'interrupted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_project_turns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'cancelled', 'error')),
  changes TEXT,
  checks TEXT,
  imported_script_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_project_turns_project_created
  ON ai_project_turns(project_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_ai_projects_updated
  ON ai_projects(updated_at DESC);
`
