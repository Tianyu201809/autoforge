import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { decodeUtf8, utf8ChildEnv, UTF8 } from '../../shared/encoding'
import { LEGACY_MANIFEST_FILENAME, MANIFEST_FILENAME } from '../../shared/script-contract'
import type { DependencyInstallResult, GlobalDependency } from '../../shared/types/script'
import { buildPythonCommand, type PythonInfo } from './python-resolver'

const VENV_DIR = '.venv'
const GLOBAL_REQUIREMENTS = 'requirements.json'

interface RequirementsFile {
  dependencies: Record<string, string>
}

function resolveManifestPath(scriptDir: string): string | null {
  const primary = join(scriptDir, MANIFEST_FILENAME)
  if (existsSync(primary)) return primary
  const legacy = join(scriptDir, LEGACY_MANIFEST_FILENAME)
  if (existsSync(legacy)) return legacy
  return null
}

function getVenvPython(venvDir: string): string {
  if (process.platform === 'win32') {
    return join(venvDir, 'Scripts', 'python.exe')
  }
  return join(venvDir, 'bin', 'python3')
}

function findUnixSitePackages(venvDir: string): string | null {
  const libDir = join(venvDir, 'lib')
  if (!existsSync(libDir)) return null
  for (const entry of readdirSync(libDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('python')) continue
    const sitePackages = join(libDir, entry.name, 'site-packages')
    if (existsSync(sitePackages)) return sitePackages
  }
  return null
}

function formatRequirementLine(name: string, spec: string): string {
  const trimmed = String(spec).trim()
  if (!trimmed || trimmed === 'latest') return name
  if (/^[<>=~!]/.test(trimmed) || trimmed.includes('==')) return `${name}${trimmed}`
  return `${name}==${trimmed}`
}

function readRequirementsFile(path: string): RequirementsFile {
  if (!existsSync(path)) return { dependencies: {} }
  const raw = JSON.parse(readFileSync(path, UTF8)) as { dependencies?: Record<string, string> }
  return { dependencies: raw.dependencies ?? {} }
}

function writeRequirementsFile(path: string, data: RequirementsFile): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, UTF8)
}

export class PythonDependencyManager {
  getGlobalRuntimeDir(): string {
    return join(app.getPath('userData'), 'runtime-python')
  }

  getGlobalVenvDir(): string {
    return join(this.getGlobalRuntimeDir(), VENV_DIR)
  }

  getVenvDir(scriptDir: string): string {
    return join(scriptDir, VENV_DIR)
  }

  getSitePackagesPath(venvDir: string): string | null {
    if (!existsSync(venvDir)) return null
    if (process.platform === 'win32') {
      const sitePackages = join(venvDir, 'Lib', 'site-packages')
      return existsSync(sitePackages) ? sitePackages : null
    }
    return findUnixSitePackages(venvDir)
  }

  getScriptSitePackagesPath(scriptDir: string): string | null {
    return this.getSitePackagesPath(this.getVenvDir(scriptDir))
  }

  getGlobalSitePackagesPath(): string | null {
    return this.getSitePackagesPath(this.getGlobalVenvDir())
  }

  private getGlobalRequirementsPath(): string {
    return join(this.getGlobalRuntimeDir(), GLOBAL_REQUIREMENTS)
  }

  private ensureGlobalRuntimeDir(): string {
    const dir = this.getGlobalRuntimeDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  private buildPipArgs(requirementsFileName: string, pipIndexUrl?: string): string[] {
    const args = ['-m', 'pip', 'install', '-r', requirementsFileName]
    const index = pipIndexUrl?.trim()
    if (index) {
      args.push('-i', index)
    }
    return args
  }

  private async ensureVenv(python: PythonInfo, venvDir: string, cwd: string): Promise<DependencyInstallResult> {
    const venvPython = getVenvPython(venvDir)
    if (existsSync(venvPython)) {
      return { ok: true, stdout: 'venv 已存在', stderr: '' }
    }
    if (!existsSync(venvDir)) mkdirSync(venvDir, { recursive: true })
    return this.runPythonCommand(python, ['-m', 'venv', venvDir], cwd)
  }

  /** 在脚本目录创建 venv 并 pip install manifest.dependencies */
  async installScriptDeps(
    scriptDir: string,
    python: PythonInfo,
    pipIndexUrl?: string
  ): Promise<DependencyInstallResult> {
    const manifestPath = resolveManifestPath(scriptDir)
    if (!manifestPath) {
      return { ok: false, stdout: '', stderr: `缺少 ${MANIFEST_FILENAME}` }
    }

    const manifest = JSON.parse(readFileSync(manifestPath, UTF8)) as {
      dependencies?: Record<string, string>
    }
    const deps = manifest.dependencies
    if (!deps || !Object.keys(deps).length) {
      return { ok: true, stdout: '无依赖需要安装', stderr: '' }
    }

    const requirementsPath = join(scriptDir, 'requirements.txt')
    const lines = Object.entries(deps).map(([name, spec]) => formatRequirementLine(name, spec))
    writeFileSync(requirementsPath, `${lines.join('\n')}\n`, UTF8)

    const venvDir = this.getVenvDir(scriptDir)
    const createResult = await this.ensureVenv(python, venvDir, scriptDir)
    if (!createResult.ok) return createResult

    const venvPython = getVenvPython(venvDir)
    if (!existsSync(venvPython)) {
      return { ok: false, stdout: '', stderr: `venv 创建失败，未找到: ${venvPython}` }
    }

    return this.runSpawn(venvPython, this.buildPipArgs('requirements.txt', pipIndexUrl), scriptDir)
  }

  /** 安装全局 Python 依赖到 userData/runtime-python/.venv */
  async installGlobal(
    packageName: string,
    version: string,
    python: PythonInfo,
    pipIndexUrl?: string
  ): Promise<DependencyInstallResult> {
    const name = packageName.trim()
    if (!name) return { ok: false, stdout: '', stderr: '包名不能为空' }

    const runtimeDir = this.ensureGlobalRuntimeDir()
    const reqPath = this.getGlobalRequirementsPath()
    const file = readRequirementsFile(reqPath)
    file.dependencies[name] = version.trim() || 'latest'
    writeRequirementsFile(reqPath, file)

    const venvDir = this.getGlobalVenvDir()
    const createResult = await this.ensureVenv(python, venvDir, runtimeDir)
    if (!createResult.ok) return createResult

    const lines = Object.entries(file.dependencies).map(([pkg, spec]) => formatRequirementLine(pkg, spec))
    writeFileSync(join(runtimeDir, 'requirements.txt'), `${lines.join('\n')}\n`, UTF8)

    const venvPython = getVenvPython(venvDir)
    return this.runSpawn(venvPython, this.buildPipArgs('requirements.txt', pipIndexUrl), runtimeDir)
  }

  listGlobal(): GlobalDependency[] {
    const file = readRequirementsFile(this.getGlobalRequirementsPath())
    return Object.entries(file.dependencies)
      .map(([name, version]) => ({ name, version }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async removeGlobal(
    packageName: string,
    python: PythonInfo,
    pipIndexUrl?: string
  ): Promise<DependencyInstallResult> {
    const runtimeDir = this.ensureGlobalRuntimeDir()
    const reqPath = this.getGlobalRequirementsPath()
    const file = readRequirementsFile(reqPath)
    if (!file.dependencies[packageName]) {
      return { ok: true, stdout: '依赖不存在', stderr: '' }
    }
    delete file.dependencies[packageName]
    writeRequirementsFile(reqPath, file)

    if (!Object.keys(file.dependencies).length) {
      return { ok: true, stdout: '已移除', stderr: '' }
    }

    const venvDir = this.getGlobalVenvDir()
    const createResult = await this.ensureVenv(python, venvDir, runtimeDir)
    if (!createResult.ok) return createResult

    const lines = Object.entries(file.dependencies).map(([pkg, spec]) => formatRequirementLine(pkg, spec))
    writeFileSync(join(runtimeDir, 'requirements.txt'), `${lines.join('\n')}\n`, UTF8)

    const venvPython = getVenvPython(venvDir)
    return this.runSpawn(venvPython, this.buildPipArgs('requirements.txt', pipIndexUrl), runtimeDir)
  }

  private async runPythonCommand(
    python: PythonInfo,
    args: string[],
    cwd: string
  ): Promise<DependencyInstallResult> {
    const { executable, baseArgs } = buildPythonCommand(python)
    return this.runSpawn(executable, [...baseArgs, ...args], cwd)
  }

  private runSpawn(
    executable: string,
    args: string[],
    cwd: string
  ): Promise<DependencyInstallResult> {
    return new Promise((resolve) => {
      const child = spawn(executable, args, {
        cwd,
        env: utf8ChildEnv(),
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += decodeUtf8(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += decodeUtf8(chunk)
      })
      child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }))
      child.on('error', (err) => resolve({ ok: false, stdout, stderr: err.message }))
    })
  }
}

export const pythonDependencyManager = new PythonDependencyManager()
