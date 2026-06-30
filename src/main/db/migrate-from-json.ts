import type { SqliteDatabase } from '../database'
import { existsSync, readFileSync, renameSync } from 'fs'
import { join } from 'path'
import { UTF8 } from '../../shared/encoding'
import type { AppConfig, EnvironmentProfile, ExecutionRecord, ScriptMeta } from '../../shared/types/script'
import type { CategoryOverride, StoredCategory } from '../../services/category-service'
import type { ScriptPreference } from '../../shared/types/script'
import { isDatabaseEmpty } from './database'
import { CategoryRepository } from './repositories/category-repository'
import { ConfigRepository } from './repositories/config-repository'
import { EnvironmentRepository } from './repositories/environment-repository'
import { ExecutionRepository } from './repositories/execution-repository'
import { ScriptRepository } from './repositories/script-repository'

const DATA_FILENAME = 'autoforge-data.json'
const LEGACY_DATA_FILENAME = 'script-box-data.json'
const HISTORY_FILENAME = 'execution-history.json'

interface PersistedData {
  scripts?: ScriptMeta[]
  importedScripts?: ScriptMeta[]
  environments?: EnvironmentProfile[]
  categories?: StoredCategory[]
  categoryOverrides?: CategoryOverride[]
  config?: AppConfig
  preferences?: Record<string, ScriptPreference>
}

interface PersistedHistory {
  records?: ExecutionRecord[]
}

function resolveDataPath(userData: string): string | null {
  const newPath = join(userData, DATA_FILENAME)
  const legacyPath = join(userData, LEGACY_DATA_FILENAME)
  if (existsSync(newPath)) return newPath
  if (existsSync(legacyPath)) return legacyPath
  return null
}

function loadJsonFile<T>(path: string): T | null {
  try {
    const raw = readFileSync(path, UTF8)
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function backupFile(path: string): void {
  if (!existsSync(path)) return
  const backupPath = `${path}.migrated.bak`
  if (!existsSync(backupPath)) {
    renameSync(path, backupPath)
  }
}

/** 若 DB 为空且存在旧 JSON，则事务内导入并备份 JSON 文件 */
export function migrateFromJsonIfNeeded(db: SqliteDatabase, userData: string): void {
  if (!isDatabaseEmpty(db)) return

  const dataPath = resolveDataPath(userData)
  const historyPath = join(userData, HISTORY_FILENAME)
  const hasData = dataPath !== null
  const hasHistory = existsSync(historyPath)

  if (!hasData && !hasHistory) return

  const data = hasData ? loadJsonFile<PersistedData>(dataPath!) : null
  const history = hasHistory ? loadJsonFile<PersistedHistory>(historyPath) : null

  const scriptRepo = new ScriptRepository(db)
  const envRepo = new EnvironmentRepository(db)
  const categoryRepo = new CategoryRepository(db)
  const configRepo = new ConfigRepository(db)
  const historyRepo = new ExecutionRepository(db)

  const migrate = db.transaction(() => {
    if (data) {
      envRepo.clearAll()
      for (const env of data.environments ?? []) {
        envRepo.insert(env)
      }
      if ((data.environments ?? []).length === 0) {
        envRepo.insert({
          id: 'default',
          name: '默认环境',
          description: '未指定时的默认环境变量集',
          variables: {},
          isDefault: true
        })
      }

      categoryRepo.clearAll()
      for (const category of data.categories ?? []) {
        categoryRepo.insertCategory(category)
      }
      for (const override of data.categoryOverrides ?? []) {
        categoryRepo.upsertOverride(override)
      }

      if (data.config) {
        configRepo.importConfig(data.config)
      }

      const scripts = data.scripts ?? data.importedScripts ?? []
      const preferences = data.preferences ?? {}
      for (const script of scripts) {
        const pref = preferences[script.id] ?? {}
        scriptRepo.importScript(script, pref)
      }
    }

    if (history?.records?.length) {
      historyRepo.bulkInsert(history.records)
    }
  })

  try {
    migrate()
    if (dataPath) backupFile(dataPath)
    if (hasHistory) backupFile(historyPath)
  } catch (err) {
    console.error('[db] JSON migration failed, keeping legacy files:', err)
  }
}
