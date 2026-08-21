import { existsSync, lstatSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { ScriptLanguage } from '../../shared/script-language'
import type { ScriptImportInspection } from '../../shared/types/script'
import { inferScriptLanguageFromExtension } from '../../shared/script-language'
import { discoverExecutableCandidates, type ExecutableCandidate } from './executable-package-discovery'
import { inspectExecutable } from './executable-inspector'
import { extractZipSecurely, MAX_ZIP_BYTES, resolveZipPackageRoot } from './safe-zip-package'
import { hasManifest } from './script-workspace'
import { removePathBestEffort } from './filesystem-cleanup'

export interface PreparedImportSource {
  sourcePath: string
  packageRoot: string
  hasManifest: boolean
  singleScriptLanguage?: Extract<ScriptLanguage, 'javascript' | 'python'>
  singleFileCandidate?: ExecutableCandidate
  singleFilePath?: string
}

function isZipPath(sourcePath: string): boolean {
  return extname(sourcePath).toLowerCase() === '.zip'
}

export function withPreparedImportSource<T>(
  sourcePath: string,
  callback: (source: PreparedImportSource) => T,
  platform: NodeJS.Platform = process.platform
): T {
  if (!existsSync(sourcePath)) throw new Error(`路径不存在: ${sourcePath}`)
  const stat = lstatSync(sourcePath)
  if (stat.isSymbolicLink()) throw new Error(`不支持导入符号链接: ${sourcePath}`)

  if (stat.isDirectory()) {
    return callback({ sourcePath, packageRoot: sourcePath, hasManifest: hasManifest(sourcePath) })
  }
  if (!stat.isFile()) throw new Error(`不支持的导入来源: ${sourcePath}`)

  if (isZipPath(sourcePath)) {
    if (stat.size > MAX_ZIP_BYTES) throw new Error('ZIP 文件超过 500 MB')
    const tempDir = mkdtempSync(join(tmpdir(), 'autoforge-import-'))
    try {
      const extractDir = join(tempDir, 'extracted')
      extractZipSecurely(sourcePath, extractDir)
      const packageRoot = resolveZipPackageRoot(extractDir)
      return callback({ sourcePath, packageRoot, hasManifest: hasManifest(packageRoot) })
    } finally {
      removePathBestEffort(tempDir)
    }
  }

  const scriptLanguage = inferScriptLanguageFromExtension(sourcePath)
  if (scriptLanguage) {
    return callback({
      sourcePath,
      packageRoot: sourcePath,
      hasManifest: false,
      singleScriptLanguage: scriptLanguage,
      singleFilePath: sourcePath
    })
  }
  const inspection = inspectExecutable(sourcePath)
  if (inspection?.kind !== 'executable' || inspection.platform !== platform) {
    throw new Error('未找到当前系统可运行的 PE、Mach-O 或 ELF 程序')
  }
  return callback({
    sourcePath,
    packageRoot: sourcePath,
    hasManifest: false,
    singleFilePath: sourcePath,
    singleFileCandidate: {
      entry: sourcePath.split(/[\\/]/).pop()!,
      format: inspection.format,
      platform: inspection.platform,
      size: statSync(sourcePath).size
    }
  })
}

export function inspectPreparedPackage(
  source: PreparedImportSource,
  platform: NodeJS.Platform = process.platform
): ScriptImportInspection {
  if (source.hasManifest || source.singleScriptLanguage) return { kind: 'ready' }
  const candidates = source.singleFileCandidate
    ? [source.singleFileCandidate]
    : discoverExecutableCandidates(source.packageRoot, platform)
  if (candidates.length === 0) {
    throw new Error('未找到当前系统可运行的 PE、Mach-O 或 ELF 程序')
  }
  if (candidates.length === 1) return { kind: 'ready', candidate: candidates[0] }
  return { kind: 'select-executable', candidates }
}

export function inspectScriptImport(
  sourcePath: string,
  platform: NodeJS.Platform = process.platform
): ScriptImportInspection {
  return withPreparedImportSource(
    sourcePath,
    (source) => inspectPreparedPackage(source, platform),
    platform
  )
}
