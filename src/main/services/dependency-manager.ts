import { spawn } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { decodeUtf8, spawnUtf8Command, UTF8 } from '../../shared/encoding'
import { LEGACY_MANIFEST_FILENAME, MANIFEST_FILENAME } from '../../shared/script-contract'
import type { ScriptLanguage } from '../../shared/script-language'
import type { DependencyInstallResult, GlobalDependency } from '../../shared/types/script'
import { needsScriptDepsInstall, writeDepsLock } from './script-deps-cache'
import { pythonDependencyManager } from './python-dependency-manager'
import { resolvePythonExecutable } from './python-resolver'
import { scriptStore } from './script-store'

interface InstallScriptDepsOptions {
  force?: boolean
}

function resolveManifestPath(scriptDir: string): string | null {
  const primary = join(scriptDir, MANIFEST_FILENAME)
  if (existsSync(primary)) return primary
  const legacy = join(scriptDir, LEGACY_MANIFEST_FILENAME)
  if (existsSync(legacy)) return legacy
  return null
}

export class DependencyManager {
  /** 在脚本目录安装 manifest 中声明的依赖；默认在依赖未变更且环境就绪时跳过 */
  async installScriptDeps(
    scriptDir: string,
    language: ScriptLanguage = 'javascript',
    options: InstallScriptDepsOptions = {}
  ): Promise<DependencyInstallResult> {
    const manifestPath = resolveManifestPath(scriptDir)
    if (!manifestPath) {
      return { ok: false, stdout: '', stderr: `缺少 ${MANIFEST_FILENAME}` }
    }

    const manifest = JSON.parse(readFileSync(manifestPath, UTF8)) as {
      dependencies?: Record<string, string>
    }
    const deps = manifest.dependencies ?? {}
    if (!Object.keys(deps).length) {
      return { ok: true, stdout: '无依赖需要安装', stderr: '' }
    }

    const pipIndexUrl = language === 'python' ? scriptStore.getConfig().python?.pipIndexUrl : undefined
    if (!options.force && !needsScriptDepsInstall(scriptDir, language, deps, pipIndexUrl)) {
      return { ok: true, stdout: '依赖已就绪，跳过安装', stderr: '' }
    }

    let result: DependencyInstallResult
    if (language === 'python') {
      const python = await resolvePythonExecutable(scriptStore.getConfig().python)
      result = await pythonDependencyManager.installScriptDeps(scriptDir, python, pipIndexUrl)
    } else {
      const pkgPath = join(scriptDir, 'package.json')
      const pkg = {
        name: 'autoforge-script',
        private: true,
        type: 'module',
        dependencies: deps
      }
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), UTF8)
      result = await this.runNpmInstall(scriptDir)
    }

    if (result.ok) {
      writeDepsLock(scriptDir, {
        dependencies: deps,
        language,
        ...(language === 'python' && pipIndexUrl?.trim() ? { pipIndexUrl: pipIndexUrl.trim() } : {})
      })
    }

    return result
  }

  /** 安装全局运行时依赖 */
  async installGlobal(
    packageName: string,
    version = 'latest',
    language: ScriptLanguage = 'javascript'
  ): Promise<DependencyInstallResult> {
    if (language === 'python') {
      const python = await resolvePythonExecutable(scriptStore.getConfig().python)
      return pythonDependencyManager.installGlobal(
        packageName,
        version,
        python,
        scriptStore.getConfig().python?.pipIndexUrl
      )
    }
    const { app } = await import('electron')
    const runtimeDir = join(app.getPath('userData'), 'runtime')
    if (!existsSync(runtimeDir)) {
      const { mkdirSync } = await import('fs')
      mkdirSync(runtimeDir, { recursive: true })
    }

    const pkgPath = join(runtimeDir, 'package.json')
    let pkg: { name: string; private: boolean; dependencies: Record<string, string> }
    if (existsSync(pkgPath)) {
      pkg = JSON.parse(readFileSync(pkgPath, UTF8))
    } else {
      pkg = { name: 'autoforge-runtime', private: true, dependencies: {} }
    }
    pkg.dependencies[packageName] = version
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), UTF8)

    return this.runNpmInstall(runtimeDir)
  }

  getRuntimeNodeModules(): string {
    const { app } = require('electron') as { app: { getPath: (name: string) => string } }
    return join(app.getPath('userData'), 'runtime', 'node_modules')
  }

  /** 列出已安装的全局依赖 */
  listGlobal(language: ScriptLanguage = 'javascript'): GlobalDependency[] {
    if (language === 'python') {
      return pythonDependencyManager.listGlobal()
    }
    const { app } = require('electron') as { app: { getPath: (name: string) => string } }
    const pkgPath = join(app.getPath('userData'), 'runtime', 'package.json')
    if (!existsSync(pkgPath)) return []

    const pkg = JSON.parse(readFileSync(pkgPath, UTF8)) as {
      dependencies?: Record<string, string>
    }
    const deps = pkg.dependencies ?? {}
    return Object.entries(deps)
      .map(([name, version]) => ({ name, version }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** 从全局 runtime 移除依赖 */
  async removeGlobal(
    packageName: string,
    language: ScriptLanguage = 'javascript'
  ): Promise<DependencyInstallResult> {
    if (language === 'python') {
      const python = await resolvePythonExecutable(scriptStore.getConfig().python)
      return pythonDependencyManager.removeGlobal(
        packageName,
        python,
        scriptStore.getConfig().python?.pipIndexUrl
      )
    }
    const { app } = await import('electron')
    const runtimeDir = join(app.getPath('userData'), 'runtime')
    const pkgPath = join(runtimeDir, 'package.json')
    if (!existsSync(pkgPath)) {
      return { ok: true, stdout: '无全局依赖', stderr: '' }
    }

    const pkg = JSON.parse(readFileSync(pkgPath, UTF8)) as {
      name: string
      private: boolean
      dependencies: Record<string, string>
    }
    if (!pkg.dependencies?.[packageName]) {
      return { ok: true, stdout: '依赖不存在', stderr: '' }
    }
    delete pkg.dependencies[packageName]
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), UTF8)

    if (!Object.keys(pkg.dependencies).length) {
      return { ok: true, stdout: '已移除', stderr: '' }
    }
    return this.runNpmInstall(runtimeDir)
  }

  private runNpmInstall(cwd: string): Promise<DependencyInstallResult> {
    return new Promise((resolve) => {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const command = `${npm} install --omit=dev --no-audit --no-fund`
      const child = spawnUtf8Command(command, {
        cwd,
        env: { npm_config_loglevel: 'error' }
      })

      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += decodeUtf8(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += decodeUtf8(chunk)
      })
      child.on('close', (code) => {
        resolve({ ok: code === 0, stdout, stderr })
      })
      child.on('error', (err) => {
        resolve({ ok: false, stdout, stderr: err.message })
      })
    })
  }
}

export const dependencyManager = new DependencyManager()
