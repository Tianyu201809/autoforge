import { getAppUserDataPath } from './app-data-root'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, extname, join, relative, resolve } from 'path'
import { randomUUID } from 'crypto'
import { UTF8 } from '../../shared/encoding'
import {
  AUTOFORGE_MANIFEST_VERSION,
  LEGACY_MANIFEST_FILENAME,
  MANIFEST_FILENAME,
  normalizeAutoforgeManifestVersion,
  validateManifest,
  type ScriptIcon,
  type ScriptManifest
} from '../../shared/script-contract'
import { resolveScriptLanguage } from '../../shared/script-language'
import type { CategoryDefinition, ScriptFileContent, ScriptMeta } from '../../shared/types/script'
import { resolveCategoryForManifest } from './category-service'
import { scriptStore } from './script-store'

export { MANIFEST_FILENAME }

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.svn', '__pycache__', '.venv', 'dist-electron', 'release'])
const IGNORED_FILE_NAMES = new Set(['.autoforge-deps.json'])

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function resolveSafeWorkspaceFile(workspacePath: string, relativePath: string): string {
  const normalized = toPosixPath(relativePath).replace(/^\/+/, '')
  if (!normalized || normalized.includes('..')) {
    throw new Error(`非法路径: ${relativePath}`)
  }
  const fullPath = resolve(workspacePath, normalized)
  const root = resolve(workspacePath)
  if (!fullPath.startsWith(root)) {
    throw new Error(`非法路径: ${relativePath}`)
  }
  return fullPath
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString(UTF8)
  const nonPrintable = sample.replace(/[\t\n\r\x20-\x7E\u0080-\uFFFF]/g, '').length
  return nonPrintable > sample.length * 0.3
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

function imageMimeForPath(relativePath: string): string | null {
  const lower = relativePath.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return null
  return IMAGE_MIME_BY_EXT[lower.slice(dot)] ?? null
}

function resolveManifestPath(scriptDir: string): string {
  const primary = join(scriptDir, MANIFEST_FILENAME)
  if (existsSync(primary)) return primary
  const legacy = join(scriptDir, LEGACY_MANIFEST_FILENAME)
  if (existsSync(legacy)) return legacy
  throw new Error(`缺少 ${MANIFEST_FILENAME}`)
}

export function hasManifest(scriptDir: string): boolean {
  return (
    existsSync(join(scriptDir, MANIFEST_FILENAME)) ||
    existsSync(join(scriptDir, LEGACY_MANIFEST_FILENAME))
  )
}

export class ScriptWorkspace {
  private scriptsRoot = ''

  ensureRoot(): string {
    if (this.scriptsRoot) return this.scriptsRoot
    const userData = getAppUserDataPath()
    this.scriptsRoot = join(userData, 'scripts')
    if (!existsSync(this.scriptsRoot)) {
      mkdirSync(this.scriptsRoot, { recursive: true })
    }
    return this.scriptsRoot
  }

  getScriptDir(scriptId: string): string {
    return join(this.ensureRoot(), scriptId)
  }

  readManifest(scriptDir: string): ScriptManifest {
    const manifestPath = resolveManifestPath(scriptDir)
    const raw = JSON.parse(readFileSync(manifestPath, UTF8))
    const result = validateManifest(raw)
    if (!result.ok) throw new Error(result.error)
    return result.manifest
  }

  /** 读取 manifest，并尝试修复常见的 autoforge / name 字段问题 */
  readManifestRelaxed(scriptDir: string): ScriptManifest {
    try {
      return this.readManifest(scriptDir)
    } catch {
      const manifestPath = resolveManifestPath(scriptDir)
      const raw = JSON.parse(readFileSync(manifestPath, UTF8))
      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>
        if (obj.name != null && typeof obj.name !== 'string') {
          obj.name = String(obj.name)
        }
        const autoforgeVersion = normalizeAutoforgeManifestVersion(obj.autoforge ?? obj.scriptbox)
        obj.autoforge = autoforgeVersion ?? AUTOFORGE_MANIFEST_VERSION
        delete obj.scriptbox
      }
      const result = validateManifest(raw)
      if (!result.ok) throw new Error(result.error)
      return result.manifest
    }
  }

  manifestToMeta(
    scriptId: string,
    manifest: ScriptManifest,
    definitions?: CategoryDefinition[]
  ): Omit<ScriptMeta, 'starred' | 'archived' | 'recentRunAt' | 'schedule' | 'defaultEnvId'> {
    const category = manifest.category ?? 'local'
    const defs = definitions ?? scriptStore.getCategoryDefinitions()
    const resolved = resolveCategoryForManifest(defs, category, manifest.categoryLabel)
    return {
      id: scriptId,
      name: manifest.name,
      description: manifest.description ?? '',
      workspacePath: this.getScriptDir(scriptId),
      category,
      categoryLabel: resolved.label,
      categoryColor: resolved.badgeColor,
      icon: manifest.icon ?? 'app-window',
      iconColor: resolved.iconColor,
      iconBg: resolved.iconBg,
      iconBorder: resolved.iconBorder,
      version: manifest.version ?? '1.0.0',
      envSchema: manifest.env ?? [],
      paramSchema: manifest.params ?? [],
      dependencies: manifest.dependencies,
      entry: manifest.entry ?? 'index.mjs',
      language: manifest.language ?? resolveScriptLanguage(undefined, manifest.entry ?? 'index.mjs'),
      browser: manifest.browser
    }
  }

  updateManifestMeta(
    script: ScriptMeta,
    fields: {
      name?: string
      icon?: ScriptIcon
      category?: string
      categoryLabel?: string
      browser?: { headless?: boolean }
    }
  ): ScriptManifest {
    const manifest = this.readManifestRelaxed(script.workspacePath)
    if (fields.name !== undefined) {
      const trimmed = fields.name.trim()
      if (!trimmed) throw new Error('脚本名称不能为空')
      manifest.name = trimmed
    }
    manifest.autoforge = manifest.autoforge ?? AUTOFORGE_MANIFEST_VERSION
    if (fields.icon !== undefined) manifest.icon = fields.icon
    if (fields.category !== undefined) manifest.category = fields.category
    if (fields.categoryLabel !== undefined) manifest.categoryLabel = fields.categoryLabel
    if (fields.browser !== undefined) {
      if (fields.browser.headless === undefined) {
        delete manifest.browser
      } else {
        manifest.browser = { headless: fields.browser.headless }
      }
    }
    this.writeManifestObject(script, manifest)
    return manifest
  }

  private writeManifestObject(script: ScriptMeta, manifest: ScriptManifest): void {
    const manifestPath = join(script.workspacePath, MANIFEST_FILENAME)
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), UTF8)
  }

  /** 从已有目录（含 autoforge.json）导入 */
  importFromDirectory(sourceDir: string): ScriptMeta {
    const manifest = this.readManifest(sourceDir)
    const scriptId = randomUUID()
    const targetDir = this.getScriptDir(scriptId)
    cpSync(sourceDir, targetDir, { recursive: true })
    return this.manifestToMeta(scriptId, manifest) as ScriptMeta
  }

  /** 从单个 .js/.mjs 文件快速创建脚本包 */
  importFromFile(filePath: string): ScriptMeta {
    if (!existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`)
    const scriptId = randomUUID()
    const targetDir = this.getScriptDir(scriptId)
    mkdirSync(targetDir, { recursive: true })

    const ext = extname(filePath) || '.mjs'
    const entryName = `index${ext}`
    copyFileSync(filePath, join(targetDir, entryName))

    const baseName = basename(filePath, ext)
    const manifest: ScriptManifest = {
      autoforge: AUTOFORGE_MANIFEST_VERSION,
      name: baseName,
      description: '从文件导入的脚本',
      version: '1.0.0',
      entry: entryName,
      language: resolveScriptLanguage(undefined, entryName),
      category: 'local'
    }
    writeFileSync(join(targetDir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), UTF8)
    return this.manifestToMeta(scriptId, manifest) as ScriptMeta
  }

  /** 导入文件夹或文件 */
  import(sourcePath: string): ScriptMeta {
    if (!existsSync(sourcePath)) throw new Error(`路径不存在: ${sourcePath}`)
    const stat = statSync(sourcePath)
    if (stat.isDirectory()) {
      return this.importFromDirectory(sourcePath)
    }
    return this.importFromFile(sourcePath)
  }

  deleteScript(scriptId: string, workspacePath?: string): void {
    const dirs = new Set<string>([resolve(this.getScriptDir(scriptId))])
    if (workspacePath) {
      dirs.add(resolve(workspacePath))
    }
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      } catch {
        /* 文件占用等情况下尽力清理，不因 rm 失败阻断 DB 删除结果 */
      }
    }
  }

  getEntryPath(script: ScriptMeta): string {
    return join(script.workspacePath, script.entry)
  }

  readEntryContent(script: ScriptMeta): string {
    const entryPath = this.getEntryPath(script)
    if (!existsSync(entryPath)) {
      throw new Error(`入口文件不存在: ${entryPath}`)
    }
    return readFileSync(entryPath, UTF8)
  }

  writeEntryContent(script: ScriptMeta, content: string): void {
    writeFileSync(this.getEntryPath(script), content, UTF8)
  }

  readManifestContent(script: ScriptMeta): string {
    return readFileSync(resolveManifestPath(script.workspacePath), UTF8)
  }

  writeManifestContent(script: ScriptMeta, content: string): void {
    const manifestPath = join(script.workspacePath, MANIFEST_FILENAME)
    writeFileSync(manifestPath, content, UTF8)
    const parsed = validateManifest(JSON.parse(content))
    if (!parsed.ok) throw new Error(parsed.error)
  }

  listWorkspaceFiles(script: ScriptMeta): string[] {
    const root = resolve(script.workspacePath)
    const files: string[] = []

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (IGNORED_DIR_NAMES.has(entry.name)) continue
          walk(join(dir, entry.name))
          continue
        }
        if (!entry.isFile()) continue
        if (IGNORED_FILE_NAMES.has(entry.name)) continue
        const fullPath = join(dir, entry.name)
        files.push(toPosixPath(relative(root, fullPath)))
      }
    }

    walk(root)
    return files.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }

  readWorkspaceFile(script: ScriptMeta, relativePath: string): ScriptFileContent {
    const fullPath = resolveSafeWorkspaceFile(script.workspacePath, relativePath)
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      throw new Error(`文件不存在: ${relativePath}`)
    }
    const buffer = readFileSync(fullPath)
    const posixPath = toPosixPath(relativePath)
    const imageMime = imageMimeForPath(posixPath)
    if (imageMime) {
      return {
        path: posixPath,
        content: buffer.toString('base64'),
        binary: true,
        encoding: 'base64',
        mimeType: imageMime
      }
    }
    const binary = isLikelyBinary(buffer)
    return {
      path: posixPath,
      content: binary ? '' : buffer.toString(UTF8),
      binary,
      encoding: binary ? undefined : 'utf8'
    }
  }

  writeWorkspaceFile(script: ScriptMeta, relativePath: string, content: string): void {
    const normalized = toPosixPath(relativePath)
    const fullPath = resolveSafeWorkspaceFile(script.workspacePath, normalized)

    if (normalized === MANIFEST_FILENAME || normalized === LEGACY_MANIFEST_FILENAME) {
      this.writeManifestContent(script, content)
      return
    }

    const dir = resolve(fullPath, '..')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(fullPath, content, UTF8)
  }

  listScriptIds(): string[] {
    const root = this.ensureRoot()
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && hasManifest(join(root, d.name)))
      .map((d) => d.name)
  }

  /** 打开文件对话框时检测：是目录还是文件 */
  detectImportType(sourcePath: string): 'directory' | 'file' {
    return statSync(sourcePath).isDirectory() ? 'directory' : 'file'
  }
}

export const scriptWorkspace = new ScriptWorkspace()
