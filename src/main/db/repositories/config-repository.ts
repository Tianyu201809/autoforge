import type { SqliteDatabase } from '../database'
import type { AppConfig } from '../../../shared/types/script'
import { fromJson } from '../row-mappers'

const DEFAULT_CONFIG: AppConfig = { logLevel: 'INFO' }

export class ConfigRepository {
  constructor(private db: SqliteDatabase) {}

  getConfig(): AppConfig {
    const row = this.db.prepare('SELECT config FROM app_settings WHERE id = 1').get() as
      | { config: string }
      | undefined
    if (!row) return { ...DEFAULT_CONFIG }
    const parsed = fromJson<Partial<AppConfig>>(row.config, {})
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      hub: { ...DEFAULT_CONFIG.hub, ...parsed.hub },
      browser: { ...DEFAULT_CONFIG.browser, ...parsed.browser },
      window: parsed.window
    }
  }

  setConfig(patch: Partial<AppConfig>): AppConfig {
    const current = this.getConfig()
    const next: AppConfig = {
      ...current,
      ...patch,
      hub: { ...current.hub, ...patch.hub },
      browser: { ...current.browser, ...patch.browser },
      window: { ...current.window, ...patch.window }
    }
    this.db
      .prepare(
        'INSERT INTO app_settings (id, config) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config'
      )
      .run(JSON.stringify(next))
    return next
  }

  /** 迁移/导入时写入完整配置 */
  importConfig(config: Partial<AppConfig>): void {
    const merged = this.getConfig()
    const next: AppConfig = {
      ...merged,
      ...config,
      hub: { ...merged.hub, ...config.hub },
      browser: { ...merged.browser, ...config.browser },
      window: { ...merged.window, ...config.window }
    }
    this.db
      .prepare(
        'INSERT INTO app_settings (id, config) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config'
      )
      .run(JSON.stringify(next))
  }
}
