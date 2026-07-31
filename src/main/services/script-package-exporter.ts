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
const MAX_EXPORT_BYTES = 50 * 1024 * 1024
const MAX_FILE_BYTES = 10 * 1024 * 1024

export interface ScriptExportPlan {
  files: string[]
  totalBytes: number
  defaultFileName: string
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

export function isBlockedExportPath(relativePath: string): boolean {
  const normalized = toPosixPath(relativePath).toLowerCase()
  const parts = normalized.split('/')
  const fileName = parts.at(-1) ?? ''
  if (parts.some((part) => BLOCKED_DIR_NAMES.has(part))) return true
  if (BLOCKED_FILE_NAMES.has(fileName) || fileName.startsWith('.env.')) return true
  if (fileName !== MANIFEST_FILENAME && extname(fileName).toLowerCase() === '.json') return true
  return BLOCKED_EXTENSIONS.has(extname(fileName).toLowerCase())
}

function isGeneratedExportPath(relativePath: string): boolean {
  return toPosixPath(relativePath)
    .toLowerCase()
    .split('/')
    .some((part) => GENERATED_DIR_NAMES.has(part))
}

function isAllowedExportFile(relativePath: string): boolean {
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

function assertSafeFile(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  if (isBlockedExportPath(normalized)) {
    throw new Error(`导出规则禁止包含文件: ${normalized}`)
  }
  if (!isAllowedExportFile(normalized)) {
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

function stripJsComments(content: string): string {
  let result = ''
  let state: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' = 'code'

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (state === 'line') {
      if (char === '\n' || char === '\r') {
        state = 'code'
        result += char
      } else {
        result += ' '
      }
      continue
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code'
        result += '  '
        index += 1
      } else if (char === '\n' || char === '\r') {
        result += char
      } else {
        result += ' '
      }
      continue
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      result += char
      if (char === '\\' && next !== undefined) {
        result += next
        index += 1
      } else if (
        (state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')
      ) {
        state = 'code'
      }
      continue
    }

    if (char === '/' && next === '/') {
      state = 'line'
      result += '  '
      index += 1
    } else if (char === '/' && next === '*') {
      state = 'block'
      result += '  '
      index += 1
    } else {
      result += char
      if (char === "'") state = 'single'
      else if (char === '"') state = 'double'
      else if (char === '`') state = 'template'
    }
  }

  return result
}

function extractJsSpecifiers(content: string): string[] {
  const specifiers = new Set<string>()
  const code = stripJsComments(content)
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.add(match[1])
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

function listWorkspaceFiles(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      const relativePath = toPosixPath(relative(root, fullPath))
      if (isBlockedExportPath(relativePath) || isGeneratedExportPath(relativePath)) continue
      if (entry.isSymbolicLink()) throw new Error(`导出不允许符号链接: ${relativePath}`)
      if (entry.isDirectory()) walk(fullPath)
      else if (entry.isFile()) files.push(relativePath)
    }
  }
  walk(root)
  return files
}

function resolveExplicitIncludes(root: string, patterns: string[]): string[] {
  if (!patterns.length) return []
  const workspaceFiles = listWorkspaceFiles(root)
  const included = new Set<string>()
  for (const rawPattern of patterns) {
    const normalized = normalizeRelativePath(rawPattern)
    const matcher = globToRegExp(normalized)
    const matches = workspaceFiles.filter((file) => matcher.test(file))
    if (!matches.length) throw new Error(`export.include 未匹配任何文件: ${rawPattern}`)
    for (const match of matches) {
      assertSafeFile(root, match)
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

export function buildScriptExportPlan(script: ScriptMeta, manifest: ScriptManifest): ScriptExportPlan {
  const root = resolve(script.workspacePath)
  const pending = [MANIFEST_FILENAME, manifest.entry ?? script.entry ?? 'index.mjs']
  const readme = ['README.md', 'README'].find((name) => existsSync(join(root, name)))
  if (readme) pending.push(readme)
  pending.push(...resolveExplicitIncludes(root, manifest.export?.include ?? []))

  const files = new Set<string>()
  while (pending.length) {
    const relativePath = normalizeRelativePath(pending.shift()!)
    if (files.has(relativePath)) continue
    const fullPath = assertSafeFile(root, relativePath)
    files.add(relativePath)

    const extension = extname(relativePath).toLowerCase()
    if (!CODE_EXTENSIONS.has(extension)) continue
    const content = readFileSync(fullPath, UTF8)
    if (extension === '.py') {
      for (const dependency of extractPythonModules(content)) {
        const resolvedDependency = resolvePythonDependency(root, relativePath, dependency.module)
        if (resolvedDependency) pending.push(resolvedDependency)
        else if (dependency.required) {
          throw new Error(`无法解析本地 Python 依赖: ${dependency.module} (${relativePath})`)
        }
      }
    } else {
      for (const specifier of extractJsSpecifiers(content)) {
        const resolvedDependency = resolveJsDependency(root, relativePath, specifier)
        if (resolvedDependency) pending.push(resolvedDependency)
        else if (specifier.startsWith('.')) {
          throw new Error(`无法解析本地 JavaScript 依赖: ${specifier} (${relativePath})`)
        }
      }
    }
  }

  let totalBytes = 0
  for (const relativePath of files) {
    const size = statSync(resolveWorkspacePath(root, relativePath)).size
    if (size > MAX_FILE_BYTES) throw new Error(`单个导出文件超过 10 MB: ${relativePath}`)
    totalBytes += size
  }
  if (totalBytes > MAX_EXPORT_BYTES) throw new Error('导出文件总大小超过 50 MB')

  return {
    files: [...files].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    totalBytes,
    defaultFileName: safeArchiveName(manifest.name, manifest.version ?? script.version ?? '1.0.0')
  }
}

export function writeScriptExportZip(script: ScriptMeta, plan: ScriptExportPlan, destination: string): void {
  const zip = new AdmZip()
  for (const relativePath of plan.files) {
    const fullPath = assertSafeFile(script.workspacePath, relativePath)
    zip.addFile(relativePath, readFileSync(fullPath))
  }
  zip.writeZip(destination)
}

export function describeExportPlan(plan: ScriptExportPlan): string {
  const sizeMb = (plan.totalBytes / 1024 / 1024).toFixed(2)
  return `将导出 ${plan.files.length} 个必要文件（${sizeMb} MB）。依赖包、运行产物、密钥和业务数据不会包含在 ZIP 中。`
}

export function exportDisplayName(destination: string): string {
  return basename(destination)
}
