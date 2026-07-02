/** SQLite schema v2 — 脚本导入/上传时间 */
export const MIGRATION_002 = `
ALTER TABLE scripts ADD COLUMN imported_at TEXT;
CREATE INDEX IF NOT EXISTS idx_scripts_imported_at ON scripts(imported_at DESC);
`
