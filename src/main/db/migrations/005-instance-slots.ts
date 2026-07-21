/** SQLite schema v5 — 脚本多实例槽 */
export const MIGRATION_005 = `
ALTER TABLE script_preferences ADD COLUMN instance_slots TEXT NOT NULL DEFAULT '[]';
`
