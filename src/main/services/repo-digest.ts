import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { extname, join, posix, relative, sep } from 'node:path'
import { UTF8 } from '../../shared/encoding'
import type { RepoProfile } from '../../shared/repo-types'

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
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
  '.vscode'
])

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.rar',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.pyd',
  '.pyc',
  '.class',
  '.jar',
  '.wasm',
  '.db',
  '.sqlite',
  '.lock'
])

export interface RepoDigestOptions {
  /** 文件树条数上限 */
  maxTreeEntries?: number
  /** 单个文件读取上限（字节） */
  maxFileBytes?: number
  /** 总字符预算 */
  totalBudgetChars?: number
  /** 最多读取多少个入口候选文件的正文 */
  maxEntryFiles?: number
  /** 是否输出完整文件树；逐文件生成阶段可关掉以节省预算 */
  includeTree?: boolean
  /** 是否输出 README */
  includeReadme?: boolean
}

export const DEFAULT_DIGEST_OPTIONS: Required<RepoDigestOptions> = {
  maxTreeEntries: 400,
  maxFileBytes: 24_000,
  totalBudgetChars: 120_000,
  maxEntryFiles: 4,
  includeTree: true,
  includeReadme: true
}

function normalizeRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join(posix.sep)
}

interface TreeEntry {
  path: string
  depth: number
  bytes: number
}

function collectTree(root: string, limit: number): { entries: TreeEntry[]; truncated: boolean } {
  const entries: TreeEntry[] = []
  let truncated = false

  const walk = (dir: string, depth: number): void => {
    if (entries.length >= limit || depth > 6) {
      if (depth > 6) truncated = true
      return
    }
    let children: Dirent[]
    try {
      children = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const child of children) {
      if (entries.length >= limit) {
        truncated = true
        return
      }
      if (child.isSymbolicLink()) continue
      const absolute = join(dir, child.name)
      if (child.isDirectory()) {
        if (IGNORED_DIRS.has(child.name)) continue
        walk(absolute, depth + 1)
        continue
      }
      if (!child.isFile()) continue
      const ext = extname(child.name).toLowerCase()
      if (BINARY_EXT.has(ext)) continue
      let bytes: number
      try {
        bytes = statSync(absolute).size
      } catch {
        continue
      }
      entries.push({ path: normalizeRelative(root, absolute), depth, bytes })
    }
  }

  walk(root, 0)
  return { entries, truncated }
}

function readTextCapped(path: string, maxBytes: number): string | null {
  try {
    const raw = readFileSync(path, UTF8)
    if (raw.length <= maxBytes) return raw
    return `${raw.slice(0, maxBytes)}\n... [已截断，原文 ${raw.length} 字符]`
  } catch {
    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * 为模型构造有界的仓库上下文。
 *
 * 内容按优先级填充，超出预算即停止：画像 → 文件树 → 依赖清单 → README → 入口候选正文。
 */
export function buildRepoDigest(
  rootDir: string,
  profile: RepoProfile,
  options?: RepoDigestOptions
): string {
  const config = { ...DEFAULT_DIGEST_OPTIONS, ...options }
  const sections: string[] = []
  let used = 0

  const push = (text: string): boolean => {
    if (used + text.length > config.totalBudgetChars) return false
    sections.push(text)
    used += text.length
    return true
  }

  push(
    [
      '## 仓库画像',
      '',
      `- 地址：${profile.ref.url}`,
      `- 分支：${profile.resolvedRef}${profile.commitSha ? ` @ ${profile.commitSha.slice(0, 8)}` : ''}`,
      `- 主要语言：${profile.languages.slice(0, 4).map((l) => `${l.name}(${l.files} 文件)`).join('、') || '未知'}`,
      `- 规模：${profile.fileCount} 个文件 / ${formatBytes(profile.totalBytes)}`,
      `- 许可证：${profile.license ?? '未发现'}`,
      `- 依赖清单：${profile.manifests.join('、') || '无'}`,
      `- 入口候选：${profile.entryCandidates.join('、') || '无'}`,
      `- 需要构建：${profile.hasBuildScript ? '是' : '否'}`,
      `- 疑似 monorepo：${profile.hasMonorepo ? '是' : '否'}`,
      `- 疑似 Web 服务：${profile.hasWebServer ? '是' : '否'}`,
      `- 可转换性判定：${profile.convertibility} — ${profile.convertibilityReason}`,
      profile.risks.length ? `- 风险：${profile.risks.join('；')}` : '',
      ''
    ]
      .filter(Boolean)
      .join('\n')
  )

  const { entries, truncated } = collectTree(rootDir, config.maxTreeEntries)
  if (config.includeTree) {
    const treeLines = entries
      .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
      .map((entry) => `${entry.path} (${formatBytes(entry.bytes)})`)
    push(
      [
        '## 文件树',
        '',
        '```',
        ...treeLines,
        truncated ? `... [文件过多，仅列出前 ${entries.length} 项]` : '',
        '```',
        ''
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  for (const manifest of profile.manifests.slice(0, 4)) {
    const absolute = join(rootDir, manifest.split(posix.sep).join(sep))
    if (!existsSync(absolute)) continue
    const content = readTextCapped(absolute, config.maxFileBytes)
    if (!content) continue
    if (!push(['## 依赖清单：' + manifest, '', '```', content.trim(), '```', ''].join('\n'))) break
  }

  if (config.includeReadme && profile.readme) {
    push(['## README（节选）', '', '```markdown', profile.readme.trim().slice(0, 6_000), '```', ''].join('\n'))
  }

  const readEntries: string[] = []
  for (const candidate of profile.entryCandidates) {
    if (readEntries.length >= config.maxEntryFiles) break
    const absolute = join(rootDir, candidate.split(posix.sep).join(sep))
    if (!existsSync(absolute)) continue
    const content = readTextCapped(absolute, config.maxFileBytes)
    if (!content) continue
    if (!push(['## 入口候选：' + candidate, '', '```', content.trim(), '```', ''].join('\n'))) break
    readEntries.push(candidate)
  }

  if (readEntries.length === 0) {
    push('## 入口候选\n\n（未能定位到明确的入口文件，请在生成计划时依据文件树自行推断）\n')
  }

  return sections.join('\n')
}
