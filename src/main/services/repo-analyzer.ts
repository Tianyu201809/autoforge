import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { extname, join, posix, relative, sep } from 'node:path'
import { UTF8 } from '../../shared/encoding'
import type {
  RepoConvertibilityLevel,
  RepoFetchMethod,
  RepoLanguageStat,
  RepoProfile,
  RepoProfileEntry,
  RepoRef
} from '../../shared/repo-types'

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  '.ruff_cache',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  'coverage',
  '.idea',
  '.vscode',
  '.gradle',
  '.mvn',
  'site-packages'
])

const MAX_FILES = 6_000
const MAX_DEPTH = 8
const MAX_README_CHARS = 4_000
const MAX_TOP_LEVEL = 20

const EXT_LANGUAGE: Record<string, string> = {
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.vue': 'Vue',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.swift': 'Swift',
  '.sh': 'Shell',
  '.ps1': 'PowerShell',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.sql': 'SQL'
}

const NATIVE_EXT = new Set(['.exe', '.dll', '.so', '.dylib', '.node', '.pyd', '.a', '.lib'])
const BUNDLER_CONFIG_PATTERN =
  /^(vite|webpack|rollup|esbuild|parcel|gulp|grunt|tsup|unbuild)\.config\.(js|mjs|cjs|ts|json)$/i
const WEB_SERVER_DEPS = new Set([
  'express',
  'koa',
  'fastify',
  'hapi',
  '@nestjs/core',
  'next',
  'nuxt',
  'flask',
  'django',
  'fastapi',
  'uvicorn',
  'gunicorn',
  'tornado',
  'aiohttp',
  'sanic',
  'starlette'
])
const MANIFEST_FILENAMES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'environment.yml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json'
]
const ENTRY_FILENAMES = [
  'index.mjs',
  'index.js',
  'index.cjs',
  'main.mjs',
  'main.js',
  'cli.js',
  'cli.mjs',
  'main.py',
  'app.py',
  'cli.py',
  'run.py',
  '__main__.py',
  'manage.py'
]
const LICENSE_CANDIDATES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'COPYING', 'COPYING.md']
const README_CANDIDATES = ['README.md', 'README.MD', 'readme.md', 'README.rst', 'README.txt', 'README']

interface WalkState {
  fileCount: number
  totalBytes: number
  languageBytes: Map<string, number>
  languageFiles: Map<string, number>
  topLevel: RepoProfileEntry[]
  manifests: string[]
  entryCandidates: string[]
  hasNativeBinary: boolean
  hasTypeScriptSource: boolean
  hasBundlerConfig: boolean
  truncated: boolean
}

function normalizeRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join(posix.sep)
}

function walk(root: string, dir: string, depth: number, state: WalkState): void {
  if (depth > MAX_DEPTH || state.fileCount >= MAX_FILES) {
    state.truncated = true
    return
  }

  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (state.fileCount >= MAX_FILES) {
      state.truncated = true
      return
    }
    const absolute = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      walk(root, absolute, depth + 1, state)
      continue
    }
    if (!entry.isFile()) continue

    let size: number
    try {
      size = statSync(absolute).size
    } catch {
      continue
    }

    state.fileCount += 1
    state.totalBytes += size

    const ext = extname(entry.name).toLowerCase()
    const language = EXT_LANGUAGE[ext]
    if (language) {
      state.languageBytes.set(language, (state.languageBytes.get(language) ?? 0) + size)
      state.languageFiles.set(language, (state.languageFiles.get(language) ?? 0) + 1)
    }
    if (NATIVE_EXT.has(ext)) state.hasNativeBinary = true
    if ((ext === '.ts' || ext === '.tsx') && !entry.name.endsWith('.d.ts')) {
      state.hasTypeScriptSource = true
    }
    if (BUNDLER_CONFIG_PATTERN.test(entry.name)) state.hasBundlerConfig = true

    const rel = normalizeRelative(root, absolute)
    if (depth === 0) {
      state.topLevel.push({ path: rel, bytes: size })
    }
    if (MANIFEST_FILENAMES.includes(entry.name)) state.manifests.push(rel)
    if (ENTRY_FILENAMES.includes(entry.name) || rel === `src/${entry.name}`) {
      state.entryCandidates.push(rel)
    }
  }
}

function readTextSafe(path: string, limit = 200_000): string | null {
  try {
    const raw = readFileSync(path, UTF8)
    return raw.length > limit ? raw.slice(0, limit) : raw
  } catch {
    return null
  }
}

function firstExisting(root: string, candidates: string[]): string | null {
  for (const name of candidates) {
    const path = join(root, name)
    if (existsSync(path)) return path
  }
  return null
}

function detectLicense(root: string): string | null {
  const path = firstExisting(root, LICENSE_CANDIDATES)
  if (!path) return null
  const text = readTextSafe(path, 8_000)?.toLowerCase()
  if (!text) return '未知许可证'
  if (text.includes('mit license') || text.includes('permission is hereby granted, free of charge')) return 'MIT'
  if (text.includes('apache license') && text.includes('2.0')) return 'Apache-2.0'
  if (text.includes('gnu affero general public license')) return 'AGPL-3.0'
  if (text.includes('gnu lesser general public license')) return 'LGPL-3.0'
  if (text.includes('gnu general public license')) return 'GPL-3.0'
  if (text.includes('mozilla public license')) return 'MPL-2.0'
  if (text.includes('bsd 3-clause') || text.includes('redistribution and use in source')) return 'BSD'
  if (text.includes('the unlicense')) return 'Unlicense'
  return '自定义许可证'
}

function detectReadme(root: string): string | null {
  const path = firstExisting(root, README_CANDIDATES)
  if (!path) return null
  const text = readTextSafe(path, MAX_README_CHARS + 500)
  if (!text) return null
  return text.slice(0, MAX_README_CHARS)
}

interface PackageJsonShape {
  main?: unknown
  bin?: unknown
  scripts?: Record<string, unknown>
  dependencies?: Record<string, unknown>
  workspaces?: unknown
  packageManager?: unknown
}

function readPackageJson(root: string): PackageJsonShape | null {
  const path = join(root, 'package.json')
  if (!existsSync(path)) return null
  const text = readTextSafe(path, 400_000)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as PackageJsonShape) : null
  } catch {
    return null
  }
}

function collectNpmEntries(pkg: PackageJsonShape | null): string[] {
  if (!pkg) return []
  const results: string[] = []
  if (typeof pkg.main === 'string' && pkg.main.trim()) results.push(pkg.main.trim())
  const bin = pkg.bin
  if (typeof bin === 'string') {
    results.push(bin)
  } else if (bin && typeof bin === 'object') {
    for (const value of Object.values(bin as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) results.push(value.trim())
    }
  }
  return results
}

function collectNpmDependencies(pkg: PackageJsonShape | null): string[] {
  if (!pkg?.dependencies || typeof pkg.dependencies !== 'object') return []
  return Object.keys(pkg.dependencies as Record<string, unknown>).sort()
}

function collectPipDependencies(root: string): string[] {
  const names = new Set<string>()
  const requirements = join(root, 'requirements.txt')
  if (existsSync(requirements)) {
    const text = readTextSafe(requirements)
    for (const rawLine of (text ?? '').split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || line.startsWith('-')) continue
      const name = line.split(/[<>=!~;[]/)[0]?.trim()
      if (name) names.add(name)
    }
  }
  const pyproject = join(root, 'pyproject.toml')
  if (existsSync(pyproject)) {
    const text = readTextSafe(pyproject)
    const block = text?.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)
    if (block) {
      for (const quoted of block[1].matchAll(/["']([^"']+)["']/g)) {
        const name = quoted[1].split(/[<>=!~;[]/)[0]?.trim()
        if (name) names.add(name)
      }
    }
  }
  return [...names].sort()
}

function buildLanguages(state: WalkState): RepoLanguageStat[] {
  return [...state.languageBytes.entries()]
    .map(([name, bytes]) => ({ name, bytes, files: state.languageFiles.get(name) ?? 0 }))
    .sort((a, b) => b.bytes - a.bytes)
}

interface DecisionInput {
  hasJsSource: boolean
  hasPySource: boolean
  hasBuildScript: boolean
  hasNativeBinary: boolean
  hasWebServer: boolean
  hasMonorepo: boolean
  entryCandidates: string[]
  runtimeDependencies: string[]
  fileCount: number
  primaryLanguage: string
}

function decideConvertibility(input: DecisionInput): { level: RepoConvertibilityLevel; reason: string } {
  const hasScriptSource = input.hasJsSource || input.hasPySource

  if (input.hasWebServer) {
    return {
      level: 'unsupported',
      reason: '识别到 Web 服务依赖，这是长期运行的常驻服务，不适合作为一次性脚本任务'
    }
  }
  if (!hasScriptSource) {
    if (input.hasNativeBinary) {
      return {
        level: 'unsupported',
        reason: '仓库以原生二进制为主，Autoforge 无法在本机复现构建流程，且产物可能不匹配当前平台'
      }
    }
    return {
      level: 'unsupported',
      reason: `未发现 JavaScript / Python 源码（主要语言：${input.primaryLanguage}），当前运行时无法承载`
    }
  }
  if (input.hasMonorepo) {
    return {
      level: 'needs-build',
      reason: '疑似 monorepo / workspace，需要先确定目标子包并处理跨包依赖与构建顺序'
    }
  }
  if (input.hasBuildScript) {
    return {
      level: 'needs-build',
      reason: '源码需要构建（TypeScript 或打包器）。转换已授权时用仓库自己的构建命令；否则在 run(ctx) 里构建并等待结束'
    }
  }
  if (input.entryCandidates.length === 0) {
    return {
      level: 'wrappable',
      reason: '未找到明确入口文件，需要编写适配入口调用其公开 API 或 CLI'
    }
  }
  if (input.fileCount <= 12 && input.runtimeDependencies.length <= 3) {
    return {
      level: 'direct',
      reason: '近似单文件脚本，依赖很少，可直接作为入口使用'
    }
  }
  return {
    level: 'wrappable',
    reason: '需要编写适配入口，包装其 CLI 或库 API'
  }
}

function buildRisks(input: {
  license: string | null
  readme: string | null
  runtimeDependencies: string[]
  hasNativeBinary: boolean
  hasBuildScript: boolean
  hasMonorepo: boolean
  truncated: boolean
}): string[] {
  const risks: string[] = []
  if (!input.license) risks.push('未发现许可证文件，商用前需确认授权')
  if (!input.readme) risks.push('缺少 README，入口与用法需从源码推断')
  if (input.runtimeDependencies.length > 8) {
    risks.push(`运行期依赖较多（${input.runtimeDependencies.length} 个），依赖安装耗时与失败概率上升`)
  }
  if (input.hasBuildScript) risks.push('需要构建流程，Autoforge 不提供构建阶段')
  if (input.hasNativeBinary) risks.push('包含原生二进制，跨平台不可移植')
  if (input.hasMonorepo) risks.push('monorepo 结构，需要明确目标子包')
  if (input.truncated) risks.push('仓库文件较多，画像已按上限截断，可能遗漏部分入口')
  return risks
}

/** 对已解压到本机的仓库目录产出结构化画像 */
export function analyzeRepoDirectory(
  rootDir: string,
  ref: RepoRef,
  resolvedRef: string,
  options?: { commitSha?: string | null; fetchMethod?: RepoFetchMethod }
): RepoProfile {
  const state: WalkState = {
    fileCount: 0,
    totalBytes: 0,
    languageBytes: new Map(),
    languageFiles: new Map(),
    topLevel: [],
    manifests: [],
    entryCandidates: [],
    hasNativeBinary: false,
    hasTypeScriptSource: false,
    hasBundlerConfig: false,
    truncated: false
  }

  walk(rootDir, rootDir, 0, state)

  const pkg = readPackageJson(rootDir)
  const npmDeps = collectNpmDependencies(pkg)
  const pipDeps = collectPipDependencies(rootDir)
  const runtimeDependencies = [...new Set([...npmDeps, ...pipDeps])].sort()

  const languages = buildLanguages(state)
  const primaryLanguage = languages[0]?.name ?? '未知'
  const hasJsSource = languages.some((l) => l.name === 'JavaScript' || l.name === 'TypeScript')
  const hasPySource = languages.some((l) => l.name === 'Python')

  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : null
  const hasNpmBuildScript = typeof scripts?.build === 'string'
  const hasTypeScriptConfig = existsSync(join(rootDir, 'tsconfig.json'))
  const hasBuildScript =
    hasNpmBuildScript || state.hasBundlerConfig || (hasTypeScriptConfig && state.hasTypeScriptSource)

  const hasWebServer =
    runtimeDependencies.some((dep) => WEB_SERVER_DEPS.has(dep)) ||
    (typeof scripts?.start === 'string' && /(server|serve|dev|start)/i.test(scripts.start))

  const hasMonorepo =
    Boolean(pkg?.workspaces) ||
    existsSync(join(rootDir, 'pnpm-workspace.yaml')) ||
    existsSync(join(rootDir, 'lerna.json')) ||
    existsSync(join(rootDir, 'nx.json'))

  const entryCandidates = [...new Set([...collectNpmEntries(pkg), ...state.entryCandidates])]
    .filter((path) => existsSync(join(rootDir, path.split('/').join(sep))))
    .slice(0, 12)

  const license = detectLicense(rootDir)
  const readme = detectReadme(rootDir)

  const decision = decideConvertibility({
    hasJsSource,
    hasPySource,
    hasBuildScript,
    hasNativeBinary: state.hasNativeBinary,
    hasWebServer,
    hasMonorepo,
    entryCandidates,
    runtimeDependencies,
    fileCount: state.fileCount,
    primaryLanguage
  })

  const topLevel = state.topLevel
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, MAX_TOP_LEVEL)

  return {
    ref,
    resolvedRef,
    fetchMethod: options?.fetchMethod ?? 'archive',
    commitSha: options?.commitSha ?? null,
    rootDir,
    fileCount: state.fileCount,
    totalBytes: state.totalBytes,
    license,
    readme,
    languages,
    manifests: [...new Set(state.manifests)].sort(),
    entryCandidates,
    runtimeDependencies,
    hasBuildScript,
    hasNativeBinary: state.hasNativeBinary,
    hasWebServer,
    hasMonorepo,
    convertibility: decision.level,
    convertibilityReason: decision.reason,
    risks: buildRisks({
      license,
      readme,
      runtimeDependencies,
      hasNativeBinary: state.hasNativeBinary,
      hasBuildScript,
      hasMonorepo,
      truncated: state.truncated
    }),
    topLevel
  }
}

export const CONVERTIBILITY_LABELS: Record<RepoConvertibilityLevel, string> = {
  direct: '可直接转换',
  wrappable: '需适配包装',
  'needs-build': '需先构建',
  unsupported: '不适合脚本化'
}
