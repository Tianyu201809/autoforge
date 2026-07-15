/** SQLite schema v3 — Hub 脚本稳定身份 */
export const MIGRATION_003 = `
ALTER TABLE scripts ADD COLUMN hub_script_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scripts_hub_script_id
  ON scripts(hub_script_id)
  WHERE hub_script_id IS NOT NULL;
`
