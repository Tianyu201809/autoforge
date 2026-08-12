import type { SqliteDatabase } from '../database'

export class ExecutableTrustRepository {
  constructor(private db: SqliteDatabase) {}

  has(scriptId: string, entry: string, sha256: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM executable_trust WHERE script_id = ? AND entry = ? AND sha256 = ?')
        .get(scriptId, entry, sha256)
    )
  }

  grant(
    scriptId: string,
    entry: string,
    sha256: string,
    trustedAt = new Date().toISOString()
  ): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO executable_trust (script_id, entry, sha256, trusted_at) VALUES (?, ?, ?, ?)'
      )
      .run(scriptId, entry, sha256, trustedAt)
  }

  deleteForScript(scriptId: string): void {
    this.db.prepare('DELETE FROM executable_trust WHERE script_id = ?').run(scriptId)
  }
}
