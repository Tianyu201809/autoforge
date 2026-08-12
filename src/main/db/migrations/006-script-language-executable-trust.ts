/** SQLite schema v6 — 原生程序语言持久化与入口信任 */
export const MIGRATION_006 = `
ALTER TABLE scripts ADD COLUMN language TEXT NOT NULL DEFAULT 'javascript';
CREATE TABLE IF NOT EXISTS executable_trust (
  script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  entry TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  trusted_at TEXT NOT NULL,
  PRIMARY KEY (script_id, entry, sha256)
);
CREATE INDEX IF NOT EXISTS idx_executable_trust_script ON executable_trust(script_id);
`

export const EXECUTABLE_TRUST_SCHEMA = `
CREATE TABLE IF NOT EXISTS executable_trust (
  script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  entry TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  trusted_at TEXT NOT NULL,
  PRIMARY KEY (script_id, entry, sha256)
);
CREATE INDEX IF NOT EXISTS idx_executable_trust_script ON executable_trust(script_id);
`
