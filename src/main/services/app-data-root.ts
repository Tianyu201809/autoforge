import { app } from 'electron'
import { cpSync, existsSync, mkdirSync } from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'
import { appEnv, type AppEnv } from '../../shared/app-env'
import { DB_FILENAME } from '../db/database'
import { openSqliteDatabase } from '../db/sqlite-adapter'

const ENV_SUFFIX: Record<AppEnv, string> = {
  development: 'development',
  production: 'production'
}

/** Electron 默认 userData 根（不受 setPath 影响，始终为 %APPDATA%/autoforge） */
export function getCanonicalLegacyRoot(): string {
  return join(app.getPath('appData'), 'autoforge')
}

/** 与运行环境绑定的 userData 子目录名后缀，例如 autoforge-development */
export function getEnvDataDirName(baseRoot: string, env: AppEnv): string {
  return `${basename(baseRoot)}-${ENV_SUFFIX[env]}`
}

/** 指定运行环境的 userData 根目录 */
export function resolveEnvUserDataRoot(baseRoot: string, env: AppEnv): string {
  return join(dirname(baseRoot), getEnvDataDirName(baseRoot, env))
}

const DATA_SUBDIRS = ['scripts', 'script-inputs', 'runtime', 'runtime-python'] as const

export function hasAppDataAt(root: string): boolean {
  return existsSync(join(root, DB_FILENAME))
}

/** 旧版扁平布局：数据直接位于 Electron 默认 userData 根目录 */
export function isLegacyFlatLayout(legacyRoot: string): boolean {
  if (!hasAppDataAt(legacyRoot)) return false
  const name = basename(legacyRoot)
  return !name.endsWith('-development') && !name.endsWith('-production')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 仅在路径边界处替换根目录，避免 `autoforge` 误匹配 `autoforge-development` 内部。
 */
export function rewritePathPrefixes(value: string, fromRoot: string, toRoot: string): string {
  if (!value || resolve(fromRoot) === resolve(toRoot)) return value

  const from = resolve(fromRoot)
  const to = resolve(toRoot)
  const slashVariants: Array<[string, string]> = [
    [from, to],
    [from.replace(/\//g, '\\'), to.replace(/\//g, '\\')],
    [from.replace(/\\/g, '/'), to.replace(/\\/g, '/')]
  ]

  let next = value
  for (const [fromPath, toPath] of slashVariants) {
    const boundary = fromPath.includes('/') ? '/' : '\\\\'
    const pattern = new RegExp(`${escapeRegExp(fromPath)}(?=${boundary}|$)`, 'g')
    if (pattern.test(next)) {
      next = next.replace(pattern, toPath)
      break
    }
  }
  return next
}

/** 将 Roaming 下任意 autoforge(-env)* 前缀统一映射到当前环境根目录 */
export function normalizeAutoforgeDataPath(value: string, envRoot: string): string {
  if (!value) return value
  const appData = app.getPath('appData')
  const target = resolve(envRoot)
  const targetVariants = [target, target.replace(/\//g, '\\'), target.replace(/\\/g, '/')]
  const boundary = `[${escapeRegExp(sep)}/]`
  const pattern = new RegExp(
    `${escapeRegExp(appData)}${boundary}autoforge(?:-(?:development|production))*(?=${boundary}|$)`,
    'gi'
  )

  let next = value
  if (!pattern.test(next)) return next
  next = value.replace(pattern, () => targetVariants[0])
  for (const tv of targetVariants.slice(1)) {
    if (next.includes(targetVariants[0])) {
      next = next.split(targetVariants[0]).join(tv)
    }
  }
  return next
}

function expectedScriptWorkspace(envRoot: string, scriptId: string): string {
  return join(envRoot, 'scripts', scriptId)
}

async function rewriteDatabasePaths(dbPath: string, fromRoot: string, toRoot: string): Promise<void> {
  const db = await openSqliteDatabase(dbPath)
  try {
    const rewrite = (value: unknown): string | null => {
      if (typeof value !== 'string' || !value) return null
      const next = rewritePathPrefixes(value, fromRoot, toRoot)
      return next === value ? null : next
    }

    const scriptRows = db
      .prepare('SELECT id, workspace_path FROM scripts')
      .all() as Array<{ id: string; workspace_path: string }>
    const updateWorkspace = db.prepare('UPDATE scripts SET workspace_path = ? WHERE id = ?')
    for (const row of scriptRows) {
      const next = rewrite(row.workspace_path)
      if (next) updateWorkspace.run(next, row.id)
    }

    await rewriteJsonPathFields(db, toRoot)
  } finally {
    db.close()
  }
}

async function rewriteJsonPathFields(db: Awaited<ReturnType<typeof openSqliteDatabase>>, envRoot: string): Promise<void> {
  const rewriteJson = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value) return null
    const next = normalizeAutoforgeDataPath(value, envRoot)
    return next === value ? null : next
  }

  const prefRows = db
    .prepare('SELECT script_id, config_by_env, params_by_env FROM script_preferences')
    .all() as Array<{ script_id: string; config_by_env: string; params_by_env: string }>
  const updatePrefs = db.prepare(
    'UPDATE script_preferences SET config_by_env = ?, params_by_env = ? WHERE script_id = ?'
  )
  for (const row of prefRows) {
    const config = rewriteJson(row.config_by_env) ?? row.config_by_env
    const params = rewriteJson(row.params_by_env) ?? row.params_by_env
    if (config !== row.config_by_env || params !== row.params_by_env) {
      updatePrefs.run(config, params, row.script_id)
    }
  }

  const envRows = db
    .prepare('SELECT id, variables FROM environments')
    .all() as Array<{ id: string; variables: string }>
  const updateEnv = db.prepare('UPDATE environments SET variables = ? WHERE id = ?')
  for (const row of envRows) {
    const next = rewriteJson(row.variables)
    if (next) updateEnv.run(next, row.id)
  }

  const configRow = db.prepare('SELECT config FROM app_settings WHERE id = 1').get() as
    | { config: string }
    | undefined
  if (configRow?.config) {
    const next = rewriteJson(configRow.config)
    if (next) {
      db.prepare('UPDATE app_settings SET config = ? WHERE id = 1').run(next)
    }
  }
}

/** 修复迁移时错误累积的 workspace_path 与其它 JSON 内绝对路径 */
async function repairDatabasePaths(dbPath: string, envRoot: string): Promise<void> {
  if (!existsSync(dbPath)) return

  const db = await openSqliteDatabase(dbPath)
  let fixedWorkspace = 0
  try {
    const scriptRows = db
      .prepare('SELECT id, workspace_path FROM scripts')
      .all() as Array<{ id: string; workspace_path: string }>
    const updateWorkspace = db.prepare('UPDATE scripts SET workspace_path = ? WHERE id = ?')

    for (const row of scriptRows) {
      const expected = expectedScriptWorkspace(envRoot, row.id)
      const current = row.workspace_path
      const currentOk =
        resolve(current) === resolve(expected) &&
        existsSync(join(current, 'autoforge.json'))
      if (currentOk) continue

      const expectedOk = existsSync(join(expected, 'autoforge.json')) || existsSync(expected)
      if (expectedOk) {
        updateWorkspace.run(expected, row.id)
        fixedWorkspace += 1
        continue
      }

      const normalized = normalizeAutoforgeDataPath(current, envRoot)
      if (normalized !== current && existsSync(normalized)) {
        updateWorkspace.run(normalized, row.id)
        fixedWorkspace += 1
      }
    }

    await rewriteJsonPathFields(db, envRoot)
  } finally {
    db.close()
  }

  if (fixedWorkspace > 0) {
    console.info(`[app-data] repaired ${fixedWorkspace} workspace_path(s) in ${dbPath}`)
  }
}

function copyTree(fromRoot: string, toRoot: string): void {
  mkdirSync(toRoot, { recursive: true })

  const dbSource = join(fromRoot, DB_FILENAME)
  if (existsSync(dbSource)) {
    cpSync(dbSource, join(toRoot, DB_FILENAME))
  }

  for (const dir of DATA_SUBDIRS) {
    const source = join(fromRoot, dir)
    if (!existsSync(source)) continue
    cpSync(source, join(toRoot, dir), { recursive: true })
  }
}

async function seedAppDataFrom(sourceRoot: string, targetRoot: string): Promise<void> {
  if (resolve(sourceRoot) === resolve(targetRoot)) return
  console.info(`[app-data] seed ${targetRoot} <= ${sourceRoot}`)
  copyTree(sourceRoot, targetRoot)
  if (existsSync(join(targetRoot, DB_FILENAME))) {
    await rewriteDatabasePaths(join(targetRoot, DB_FILENAME), sourceRoot, targetRoot)
  }
}

async function ensureEnvDataRoot(
  targetRoot: string,
  primarySource: string | null,
  fallbackSource: string | null
): Promise<void> {
  if (hasAppDataAt(targetRoot)) return
  const source = primarySource && hasAppDataAt(primarySource)
    ? primarySource
    : fallbackSource && hasAppDataAt(fallbackSource)
      ? fallbackSource
      : null
  if (!source) return
  await seedAppDataFrom(source, targetRoot)
}

let legacyUserDataRoot: string | null = null

/**
 * 在 app ready 之前调用：将 userData 指向当前运行环境目录。
 */
export function configureAppUserDataPath(): string {
  legacyUserDataRoot = getCanonicalLegacyRoot()
  const envRoot = resolveEnvUserDataRoot(legacyUserDataRoot, appEnv)
  app.setPath('userData', envRoot)
  mkdirSync(envRoot, { recursive: true })
  return legacyUserDataRoot
}

/** 首次启动时把旧版/开发环境数据复制到独立目录，并重写库内绝对路径。 */
export async function ensureAppDataSeeded(): Promise<void> {
  if (!legacyUserDataRoot) {
    throw new Error('configureAppUserDataPath() must run before ensureAppDataSeeded()')
  }

  const legacyRoot = legacyUserDataRoot
  const devRoot = resolveEnvUserDataRoot(legacyRoot, 'development')
  const prodRoot = resolveEnvUserDataRoot(legacyRoot, 'production')
  const legacySource = isLegacyFlatLayout(legacyRoot) ? legacyRoot : null

  await ensureEnvDataRoot(devRoot, legacySource, null)
  await ensureEnvDataRoot(prodRoot, devRoot, legacySource)

  const currentRoot = app.getPath('userData')
  await repairDatabasePaths(join(currentRoot, DB_FILENAME), currentRoot)

  console.info(
    `[app-data] env=${appEnv} root=${currentRoot} legacy=${legacyRoot} dev=${devRoot} prod=${prodRoot}`
  )
}

export function getAppUserDataPath(): string {
  return app.getPath('userData')
}
