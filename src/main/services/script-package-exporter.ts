import AdmZip from 'adm-zip'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync
} from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { MANIFEST_FILENAME, type ScriptManifest } from '../../shared/script-contract'
import type { ScriptMeta } from '../../shared/types/script'
import { UTF8 } from '../../shared/encoding'

const CODE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.py'
])
const RESOURCE_EXTENSIONS = new Set([
  '.css',
  '.scss',
  '.less',
  '.html',
  '.htm',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.txt',
  '.md'
])
const RESOLVABLE_EXTENSIONS = [...CODE_EXTENSIONS, ...RESOURCE_EXTENSIONS]
const BLOCKED_DIR_NAMES = new Set([
  'node_modules',
  '.venv',
  'venv',
  'site-packages',
  '.git',
  '.svn',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.autoforge-attachments',
  '.autoforge-output'
])
const GENERATED_DIR_NAMES = new Set(['dist', 'dist-electron', 'release', 'out', 'coverage'])
const BLOCKED_FILE_NAMES = new Set(['.autoforge-deps.json', '.env'])
const BLOCKED_EXTENSIONS = new Set([
  '.db',
  '.db3',
  '.sqlite',
  '.sqlite3',
  '.csv',
  '.tsv',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.parquet',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.log',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.crt',
  '.cer'
])
/** 原生包整目录打包时仍然排除的凭据类文件 */
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.crt', '.cer'])
const MAX_EXPORT_BYTES = 500 * 1024 * 1024
const MAX_FILE_BYTES = 500 * 1024 * 1024
const MAX_BYTES_LABEL = '500 MB'

export type ScriptExportLanguage = 'executable' | 'source'

export interface ScriptExportPlan {
  files: string[]
  totalBytes: number
  defaultFileName: string
  language: ScriptExportLanguage
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function normalizeRelativePath(input: string): string {
  const normalized = toPosixPath(input.trim()).replace(/^\.\//, '')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    isAbsolute(input) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`非法导出路径: ${input}`)
  }
  return normalized
}

function isReadme(relativePath: string): boolean {
  return /^readme(?:\.md)?$/i.test(relativePath)
}

export function isBlockedExportPath(
  relativePath: string,
  language: ScriptExportLanguage = 'source'
): boolean {
  const normalized = toPosixPath(relativePath).toLowerCase()
  const parts = normalized.split('/')
  const fileName = parts.at(-1) ?? ''
  const extension = extname(fileName).toLowerCase()
  if (parts.some((part) => BLOCKED_DIR_NAMES.has(part))) return true
  if (BLOCKED_FILE_NAMES.has(fileName) || fileName.startsWith('.env.')) return true
  // 原生包整目录打包，配置、数据和运行产物都属于程序自身内容，只排除凭据
  if (language === 'executable') return SECRET_EXTENSIONS.has(extension)
  if (fileName !== MANIFEST_FILENAME && extension === '.json') return true
  return BLOCKED_EXTENSIONS.has(extension)
}

function isGeneratedExportPath(relativePath: string): boolean {
  return toPosixPath(relativePath)
    .toLowerCase()
    .split('/')
    .some((part) => GENERATED_DIR_NAMES.has(part))
}

function isAllowedExportFile(relativePath: string, language: ScriptExportLanguage): boolean {
  if (language === 'executable') return true
  if (relativePath === MANIFEST_FILENAME || isReadme(relativePath)) return true
  const extension = extname(relativePath).toLowerCase()
  return CODE_EXTENSIONS.has(extension) || RESOURCE_EXTENSIONS.has(extension)
}

function resolveWorkspacePath(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  const fullPath = resolve(root, normalized)
  const fromRoot = relative(resolve(root), fullPath)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`导出路径越界: ${relativePath}`)
  }
  return fullPath
}

function assertSafeFile(root: string, relativePath: string, language: ScriptExportLanguage): string {
  const normalized = normalizeRelativePath(relativePath)
  if (isBlockedExportPath(normalized, language)) {
    throw new Error(`导出规则禁止包含文件: ${normalized}`)
  }
  if (!isAllowedExportFile(normalized, language)) {
    throw new Error(`文件类型不在导出白名单中: ${normalized}`)
  }
  const fullPath = resolveWorkspacePath(root, normalized)
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    throw new Error(`导出文件不存在: ${normalized}`)
  }
  if (lstatSync(fullPath).isSymbolicLink()) {
    throw new Error(`导出不允许符号链接: ${normalized}`)
  }
  return fullPath
}

function extractJsSpecifiers(content: string): string[] {
  const specifiers = new Set<string>()
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) specifiers.add(match[1])
  }
  return [...specifiers]
}

function extractPythonModules(content: string): Array<{ module: string; required: boolean }> {
  const modules: Array<{ module: string; required: boolean }> = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const fromMatch = /^from\s+([.\w]+)\s+import\s+(.+)$/.exec(line)
    if (fromMatch) {
      modules.push({ module: fromMatch[1], required: fromMatch[1].startsWith('.') })
      for (const name of fromMatch[2].split(',')) {
        const imported = name.trim().split(/\s+as\s+/)[0]
        if (imported && imported !== '*') {
          const separator = fromMatch[1].endsWith('.') ? '' : '.'
          modules.push({
            module: `${fromMatch[1]}${separator}${imported}`,
            required: /^\.+$/.test(fromMatch[1])
          })
        }
      }
      continue
    }
    const importMatch = /^import\s+(.+)$/.exec(line)
    if (!importMatch) continue
    for (const item of importMatch[1].split(',')) {
      const module = item.trim().split(/\s+as\s+/)[0]
      if (module) modules.push({ module, required: false })
    }
  }
  return modules
}

function resolveCandidate(root: string, basePath: string): string | null {
  const candidates = [basePath]
  if (!extname(basePath)) {
    for (const extension of RESOLVABLE_EXTENSIONS) candidates.push(`${basePath}${extension}`)
    for (const extension of CODE_EXTENSIONS) candidates.push(join(basePath, `index${extension}`))
    candidates.push(join(basePath, '__init__.py'))
  }
  for (const candidate of candidates) {
    const fullPath = resolve(candidate)
    const fromRoot = relative(resolve(root), fullPath)
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) continue
    if (existsSync(fullPath) && statSync(fullPath).isFile()) return toPosixPath(fromRoot)
  }
  return null
}

function resolveJsDependency(root: string, fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const clean = specifier.split(/[?#]/, 1)[0]
  return resolveCandidate(root, resolve(root, dirname(fromFile), clean))
}

function resolvePythonDependency(root: string, fromFile: string, moduleName: string): string | null {
  const dotMatch = /^(\.*)(.*)$/.exec(moduleName)
  if (!dotMatch) return null
  const dots = dotMatch[1].length
  const modulePath = dotMatch[2].replace(/\./g, '/')
  let baseDir = dots ? dirname(resolve(root, fromFile)) : resolve(root)
  for (let index = 1; index < dots; index += 1) baseDir = dirname(baseDir)
  return resolveCandidate(root, resolve(baseDir, modulePath))
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeRelativePath(pattern)
  let source = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    if (char === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        source += '(?:.*/)?'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

function listWorkspaceFiles(root: string, language: ScriptExportLanguage): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      const relativePath = toPosixPath(relative(root, fullPath))
      if (isBlockedExportPath(relativePath, language)) continue
      // 构建产物对源码脚本是噪音，对原生包则可能是程序本体
      if (language !== 'executable' && isGeneratedExportPath(relativePath)) continue
      if (entry.isSymbolicLink()) throw new Error(`导出不允许符号链接: ${relativePath}`)
      if (entry.isDirectory()) walk(fullPath)
      else if (entry.isFile()) files.push(relativePath)
    }
  }
  walk(root)
  return files
}

function resolveExplicitIncludes(
  root: string,
  patterns: string[],
  language: ScriptExportLanguage
): string[] {
  if (!patterns.length) return []
  const workspaceFiles = listWorkspaceFiles(root, language)
  const included = new Set<string>()
  for (const rawPattern of patterns) {
    const normalized = normalizeRelativePath(rawPattern)
    const matcher = globToRegExp(normalized)
    const matches = workspaceFiles.filter((file) => matcher.test(file))
    if (!matches.length) throw new Error(`export.include 未匹配任何文件: ${rawPattern}`)
    for (const match of matches) {
      assertSafeFile(root, match, language)
      included.add(match)
    }
  }
  return [...included]
}

function safeArchiveName(name: string, version: string): string {
  const cleaned = `${name}-${version}`
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return `${cleaned || 'autoforge-script'}.zip`
}

function exportLanguageOf(script: ScriptMeta, manifest: ScriptManifest): ScriptExportLanguage {
  return script.language === 'executable' || manifest.language === 'executable'
    ? 'executable'
    : 'source'
}

function collectSourceDependencies(root: string, relativePath: string, fullPath: string): string[] {
  const extension = extname(relativePath).toLowerCase()
  if (!CODE_EXTENSIONS.has(extension)) return []
  const content = readFileSync(fullPath, UTF8)
  const resolved: string[] = []
  if (extension === '.py') {
    for (const dependency of extractPythonModules(content)) {
      const resolvedDependency = resolvePythonDependency(root, relativePath, dependency.module)
      if (resolvedDependency) resolved.push(resolvedDependency)
      else if (dependency.required) {
        throw new Error(`无法解析本地 Python 依赖: ${dependency.module} (${relativePath})`)
      }
    }
    return resolved
  }
  for (const specifier of extractJsSpecifiers(content)) {
    const resolvedDependency = resolveJsDependency(root, relativePath, specifier)
    if (resolvedDependency) resolved.push(resolvedDependency)
    else if (specifier.startsWith('.')) {
      throw new Error(`无法解析本地 JavaScript 依赖: ${specifier} (${relativePath})`)
    }
  }
  return resolved
}

/** 原生包整目录打包：清单与入口只做校验，内容由工作区遍历决定 */
function collectExecutableFiles(root: string, entry: string): Set<string> {
  assertSafeFile(root, MANIFEST_FILENAME, 'executable')
  assertSafeFile(root, entry, 'executable')
  const files = new Set(listWorkspaceFiles(root, 'executable'))
  if (!files.size) throw new Error('脚本目录没有可导出的文件')
  return files
}

function collectSourceFiles(root: string, entry: string, includes: string[]): Set<string> {
  const pending = [MANIFEST_FILENAME, entry]
  const readme = ['README.md', 'README'].find((name) => existsSync(join(root, name)))
  if (readme) pending.push(readme)
  pending.push(...resolveExplicitIncludes(root, includes, 'source'))

  const files = new Set<string>()
  while (pending.length) {
    const relativePath = normalizeRelativePath(pending.shift()!)
    if (files.has(relativePath)) continue
    const fullPath = assertSafeFile(root, relativePath, 'source')
    files.add(relativePath)
    pending.push(...collectSourceDependencies(root, relativePath, fullPath))
  }
  return files
}

export function buildScriptExportPlan(script: ScriptMeta, manifest: ScriptManifest): ScriptExportPlan {
  const language = exportLanguageOf(script, manifest)
  const root = resolve(script.workspacePath)
  const entry = manifest.entry ?? script.entry ?? (language === 'executable' ? '' : 'index.mjs')
  if (!entry) throw new Error('清单缺少入口文件')

  const files =
    language === 'executable'
      ? collectExecutableFiles(root, entry)
      : collectSourceFiles(root, entry, manifest.export?.include ?? [])

  let totalBytes = 0
  for (const relativePath of files) {
    const size = statSync(resolveWorkspacePath(root, relativePath)).size
    if (size > MAX_FILE_BYTES) {
      throw new Error(`单个导出文件超过 ${MAX_BYTES_LABEL}: ${relativePath}`)
    }
    totalBytes += size
  }
  if (totalBytes > MAX_EXPORT_BYTES) {
    throw new Error(`导出文件总大小超过 ${MAX_BYTES_LABEL}`)
  }

  return {
    files: [...files].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    totalBytes,
    defaultFileName: safeArchiveName(manifest.name, manifest.version ?? script.version ?? '1.0.0'),
    language
  }
}

export function writeScriptExportZip(script: ScriptMeta, plan: ScriptExportPlan, destination: string): void {
  const zip = new AdmZip()
  for (const relativePath of plan.files) {
    const fullPath = assertSafeFile(script.workspacePath, relativePath, plan.language)
    zip.addFile(relativePath, readFileSync(fullPath))
  }
  zip.writeZip(destination)
}

export function describeExportPlan(plan: ScriptExportPlan): string {
  const sizeMb = (plan.totalBytes / 1024 / 1024).toFixed(2)
  if (plan.language === 'executable') {
    return `将打包整个脚本目录，共 ${plan.files.length} 个文件（${sizeMb} MB）。\n\n依赖目录、缓存、.env、密钥和证书不会包含在 ZIP 中；其余文件按目录结构原样导出。`
  }
  return `将导出 ${plan.files.length} 个必要文件（${sizeMb} MB）。依赖包、运行产物、密钥和业务数据不会包含在 ZIP 中。\n\n请确认动态加载的模板或资源已在 autoforge.json 的 export.include 中声明。`
}

export function exportDisplayName(destination: string): string {
  return basename(destination)
}
