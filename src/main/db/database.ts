import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { MIGRATION_001 } from './migrations/001-initial'
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
  const row = database.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as
    | { version: number }
    | undefined

  if (!row) {
    database.exec(MIGRATION_001)
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(1)
    seedDefaults(database)
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
  const scriptCount = (database.prepare('SELECT COUNT(*) AS count FROM scripts').get() as { count: number }).count
  const historyCount = (database.prepare('SELECT COUNT(*) AS count FROM execution_records').get() as { count: number })
    .count
  return scriptCount === 0 && historyCount === 0
}
