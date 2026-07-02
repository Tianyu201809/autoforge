import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import { decodeUtf8, utf8ChildEnv } from '../../shared/encoding'
import type { AppConfig, PythonStatusInfo } from '../../shared/types/script'

export interface PythonInfo {
  executable: string
  version: string
}

const DEFAULT_MIN_VERSION = '3.9'
const VERSION_SNIPPET =
  "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"

function parseVersion(version: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]) }
}

function meetsMinVersion(version: string, minVersion: string): boolean {
  const v = parseVersion(version)
  const min = parseVersion(minVersion)
  if (!v || !min) return false
  if (v.major !== min.major) return v.major > min.major
  return v.minor >= min.minor
}

/** 执行 Python 并读取 major.minor 版本号 */
async function queryPythonVersion(executable: string, args: string[] = []): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...args, '-c', VERSION_SNIPPET], {
      env: utf8ChildEnv(),
      windowsHide: true
    })

    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += decodeUtf8(chunk)
    })
    child.on('close', (code) => {
      resolve(code === 0 && stdout.trim() ? stdout.trim() : null)
    })
    child.on('error', () => resolve(null))
  })
}

async function tryExecutable(executable: string, args: string[] = []): Promise<PythonInfo | null> {
  const version = await queryPythonVersion(executable, args)
  if (!version) return null
  return { executable, version }
}

function getProbeCandidates(): Array<{ executable: string; args: string[] }> {
  if (process.platform === 'win32') {
    return [
      { executable: 'py', args: ['-3'] },
      { executable: 'python', args: [] },
      { executable: 'python3', args: [] }
    ]
  }
  return [
    { executable: 'python3', args: [] },
    { executable: 'python', args: [] }
  ]
}

/** 解析可用的 Python 解释器（方案 A：本机 Python） */
export async function resolvePythonExecutable(config?: AppConfig['python']): Promise<PythonInfo> {
  const minVersion = config?.minVersion ?? DEFAULT_MIN_VERSION

  if (config?.executablePath?.trim()) {
    const path = config.executablePath.trim()
    if (!existsSync(path)) {
      throw new Error(`Python 路径不存在: ${path}`)
    }
    const version = await queryPythonVersion(path)
    if (!version || !meetsMinVersion(version, minVersion)) {
      throw new Error(`Python 版本无效或过低（需要 ${minVersion}+）: ${path}`)
    }
    return { executable: path, version }
  }

  const envPython = process.env.AUTOFORGE_PYTHON?.trim()
  if (envPython && existsSync(envPython)) {
    const version = await queryPythonVersion(envPython)
    if (version && meetsMinVersion(version, minVersion)) {
      return { executable: envPython, version }
    }
  }

  for (const candidate of getProbeCandidates()) {
    const info = await tryExecutable(candidate.executable, candidate.args)
    if (info && meetsMinVersion(info.version, minVersion)) {
      return {
        executable: candidate.executable,
        version: info.version
      }
    }
  }

  throw new Error(`未检测到 Python ${minVersion}+，请在 设置 → Python 中配置解释器路径`)
}

/** 检测 Python 状态（设置页展示，不抛错） */
export async function detectPythonStatus(config?: AppConfig['python']): Promise<PythonStatusInfo> {
  const minVersion = config?.minVersion ?? DEFAULT_MIN_VERSION
  try {
    const info = await resolvePythonExecutable(config)
    return {
      found: true,
      executable: info.executable,
      version: info.version,
      minVersion
    }
  } catch (error) {
    return {
      found: false,
      executable: config?.executablePath?.trim() || null,
      version: null,
      minVersion,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** autoforge_runtime 包根目录（resources/python） */
export function getPythonRuntimeRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'python')
  }
  return join(app.getAppPath(), 'resources', 'python')
}

/** 构建 spawn 时使用的 Python 命令行（Windows py launcher 需额外 args） */
export function buildPythonCommand(
  info: PythonInfo
): { executable: string; baseArgs: string[] } {
  if (process.platform === 'win32' && info.executable === 'py') {
    return { executable: 'py', baseArgs: ['-3'] }
  }
  return { executable: info.executable, baseArgs: [] }
}
