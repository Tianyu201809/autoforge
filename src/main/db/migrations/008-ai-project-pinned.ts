/** SQLite schema v8 adds persistent project pinning. */
export const MIGRATION_008 = `
ALTER TABLE ai_projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
CREATE INDEX IF NOT EXISTS idx_ai_projects_pinned_updated
  ON ai_projects(pinned DESC, updated_at DESC, id);
`
