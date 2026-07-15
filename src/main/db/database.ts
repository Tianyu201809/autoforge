import { existsSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { MIGRATION_001 } from './migrations/001-initial'
import { MIGRATION_002 } from './migrations/002-script-imported-at'
import { MIGRATION_003 } from './migrations/003-script-hub-id'
import { migrateFromJsonIfNeeded } from './migrate-from-json'
import { openSqliteDatabase, type SqliteDatabase } from './sqlite-adapter'

export const DB_FILENAME = 'autoforge.db'

export type { SqliteDatabase }

let db: SqliteDatabase | null = null
let initPromise: Promise<SqliteDatabase> | null = null

/** 打开或返回已初始化的 SQLite 连接 */
export function getDb(): SqliteDatabase {
  if (db) return db
  throw new Error('Database not initialized. Call await initDatabase() first.')
}

/** 初始化数据库：建表、迁移 JSON、设置 PRAGMA */
export async function initDatabase(userData: string): Promise<SqliteDatabase> {
  if (db) return db
  if (!initPromise) {
    initPromise = openAndMigrate(userData)
  }
  db = await initPromise
  return db
}

async function openAndMigrate(userData: string): Promise<SqliteDatabase> {
  if (!existsSync(userData)) {
    mkdirSync(userData, { recursive: true })
  }

  const dbPath = join(userData, DB_FILENAME)
  const database = await openSqliteDatabase(dbPath)

  runMigrations(database)
  migrateFromJsonIfNeeded(database, userData)

  return database
}

/** 关闭数据库连接并落盘 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    initPromise = null
  }
}

function runMigrations(database: SqliteDatabase): void {
  const hasMigrationsTable = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()

  if (!hasMigrationsTable) {
    database.exec(MIGRATION_001)
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(1)
    seedDefaults(database)
  }

  const versionRow = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null
  }
  const currentVersion = versionRow.version ?? 0

  if (currentVersion < 2) {
    database.exec(MIGRATION_002)
    backfillImportedAt(database)
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(2)
  }

  if (currentVersion < 3) {
    database.exec(MIGRATION_003)
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(3)
  }
}

/** 为已有脚本回填 imported_at（优先工作区目录创建时间） */
function backfillImportedAt(database: SqliteDatabase): void {
  const rows = database
    .prepare('SELECT id, workspace_path, imported_at FROM scripts WHERE imported_at IS NULL')
    .all() as { id: string; workspace_path: string; imported_at: string | null }[]

  const update = database.prepare('UPDATE scripts SET imported_at = ? WHERE id = ?')
  for (const row of rows) {
    let importedAt = new Date(0).toISOString()
    if (row.workspace_path && existsSync(row.workspace_path)) {
      const stat = statSync(row.workspace_path)
      const time = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime
      importedAt = time.toISOString()
    }
    update.run(importedAt, row.id)
  }
}

function seedDefaults(database: SqliteDatabase): void {
  const configRow = database.prepare('SELECT id FROM app_settings WHERE id = 1').get()
  if (!configRow) {
    database.prepare('INSERT INTO app_settings (id, config) VALUES (1, ?)').run('{"logLevel":"INFO"}')
  }

  const envCount = database.prepare('SELECT COUNT(*) AS count FROM environments').get() as { count: number }
  if (envCount.count === 0) {
    database
      .prepare(
        'INSERT INTO environments (id, name, description, variables, is_default) VALUES (?, ?, ?, ?, ?)'
      )
      .run('default', '默认环境', '未指定时的默认环境变量集', '{}', 1)
  }
}

/** 判断数据库是否已有业务数据（用于迁移决策） */
export function isDatabaseEmpty(database: SqliteDatabase): boolean {
  const hasScripts = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scripts'")
    .get()
  if (!hasScripts) return true

  const scriptCount = (database.prepare('SELECT COUNT(*) AS count FROM scripts').get() as { count: number }).count
  const historyCount = (database.prepare('SELECT COUNT(*) AS count FROM execution_records').get() as { count: number })
    .count
  return scriptCount === 0 && historyCount === 0
}
