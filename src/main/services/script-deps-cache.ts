import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { UTF8 } from '../../shared/encoding'
import type { ScriptLanguage } from '../../shared/script-language'
import { pythonDependencyManager } from './python-dependency-manager'

export const DEPS_LOCK_FILENAME = '.autoforge-deps.json'

interface ScriptDepsLock {
  dependencies: Record<string, string>
  language: ScriptLanguage
  pipIndexUrl?: string
}

function normalizeDeps(deps: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(deps).sort()) {
    out[key] = deps[key]
  }
  return out
}

function depsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const left = normalizeDeps(a)
  const right = normalizeDeps(b)
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => left[key] === right[key])
}

function getDepsLockPath(scriptDir: string): string {
  return join(scriptDir, DEPS_LOCK_FILENAME)
}

/** 读取上次成功安装时写入的依赖锁文件 */
export function readDepsLock(scriptDir: string): ScriptDepsLock | null {
  const lockPath = getDepsLockPath(scriptDir)
  if (!existsSync(lockPath)) return null
  try {
    const raw = JSON.parse(readFileSync(lockPath, UTF8)) as ScriptDepsLock
    if (!raw.dependencies || typeof raw.dependencies !== 'object') return null
    if (raw.language !== 'javascript' && raw.language !== 'python') return null
    return raw
  } catch {
    return null
  }
}

/** 安装成功后写入依赖锁，供后续运行跳过重复安装 */
export function writeDepsLock(scriptDir: string, lock: ScriptDepsLock): void {
  writeFileSync(getDepsLockPath(scriptDir), `${JSON.stringify(lock, null, 2)}\n`, UTF8)
}

function isJsDepsReady(scriptDir: string): boolean {
  const nodeModules = join(scriptDir, 'node_modules')
  if (!existsSync(nodeModules)) return false
  try {
    return readdirSync(nodeModules).length > 0
  } catch {
    return false
  }
}

function isPythonDepsReady(scriptDir: string): boolean {
  const venvDir = pythonDependencyManager.getVenvDir(scriptDir)
  if (process.platform === 'win32') {
    return existsSync(join(venvDir, 'Scripts', 'python.exe'))
  }
  return existsSync(join(venvDir, 'bin', 'python3'))
}

/** 检查 node_modules / .venv 是否已存在 */
export function isScriptDepsEnvironmentReady(scriptDir: string, language: ScriptLanguage): boolean {
  return language === 'python' ? isPythonDepsReady(scriptDir) : isJsDepsReady(scriptDir)
}

/** 依赖缺失、环境未就绪、manifest 变更或 pip 镜像变更时需要重新安装 */
export function needsScriptDepsInstall(
  scriptDir: string,
  language: ScriptLanguage,
  deps: Record<string, string>,
  pipIndexUrl?: string
): boolean {
  if (!Object.keys(deps).length) return false
  if (!isScriptDepsEnvironmentReady(scriptDir, language)) return true

  const lock = readDepsLock(scriptDir)
  if (!lock) return true
  if (lock.language !== language) return true
  if (!depsEqual(lock.dependencies, deps)) return true

  if (language === 'python') {
    const currentIndex = pipIndexUrl?.trim() || ''
    const lockedIndex = lock.pipIndexUrl?.trim() || ''
    if (currentIndex !== lockedIndex) return true
  }

  return false
}
