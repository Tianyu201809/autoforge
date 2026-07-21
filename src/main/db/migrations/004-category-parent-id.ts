/** SQLite schema v4 — 分类邻接表父节点 */
export const MIGRATION_004 = `
ALTER TABLE categories ADD COLUMN parent_id TEXT;
`
