import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { UTF8 } from '../../shared/encoding'
import {
  REPO_HANDOFF_FILENAME,
  REPO_META_DIR_NAME,
  REPO_PACKAGE_RELATIVE_PATH,
  REPO_PROFILE_FILENAME,
  REPO_SOURCE_DIR_NAME,
  REPO_WORKSPACE_DIR_NAME,
  type RepoProfile,
  type RepoRef,
  type RepoWorkspaceInfo,
  type RepoWorkspaceSummary
} from '../../shared/repo-types'
import { getAppUserDataPath } from './app-data-root'
import { MANIFEST_FILENAME } from '../../shared/script-contract'

export interface RepoWorkspacePaths {
  taskId: string
  workspacePath: string
  repoPath: string
  metaDir: string
  packageDir: string
  profilePath: string
  handoffPath: string
}

export function getRepoWorkspacesRoot(): string {
  return join(getAppUserDataPath(), REPO_WORKSPACE_DIR_NAME)
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40) || 'repo'
}

export function createRepoTaskId(ref: RepoRef): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${sanitizeSegment(ref.repo)}-${stamp}-${suffix}`
}

export function getRepoWorkspacePaths(taskId: string): RepoWorkspacePaths {
  const workspacePath = join(getRepoWorkspacesRoot(), taskId)
  const metaDir = join(workspacePath, REPO_META_DIR_NAME)
  return {
    taskId,
    workspacePath,
    repoPath: join(workspacePath, REPO_SOURCE_DIR_NAME),
    metaDir,
    packageDir: join(workspacePath, REPO_PACKAGE_RELATIVE_PATH),
    profilePath: join(metaDir, REPO_PROFILE_FILENAME),
    handoffPath: join(metaDir, REPO_HANDOFF_FILENAME)
  }
}

export function prepareRepoWorkspace(taskId: string): RepoWorkspacePaths {
  const paths = getRepoWorkspacePaths(taskId)
  mkdirSync(paths.workspacePath, { recursive: true })
  mkdirSync(paths.metaDir, { recursive: true })
  mkdirSync(paths.packageDir, { recursive: true })
  return paths
}

export function writeWorkspaceProfile(taskId: string, profile: RepoProfile): void {
  const paths = getRepoWorkspacePaths(taskId)
  mkdirSync(paths.metaDir, { recursive: true })
  writeFileSync(paths.profilePath, JSON.stringify(profile, null, 2), UTF8)
}

export function readWorkspaceProfile(taskId: string): RepoProfile | null {
  const paths = getRepoWorkspacePaths(taskId)
  if (!existsSync(paths.profilePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(paths.profilePath, UTF8)) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as RepoProfile) : null
  } catch {
    return null
  }
}

/** 产物目录中是否已经存在可导入的脚本包 */
export function detectPackageRoot(taskId: string): string | null {
  const paths = getRepoWorkspacePaths(taskId)
  const manifestPath = join(paths.packageDir, MANIFEST_FILENAME)
  if (existsSync(manifestPath)) return paths.packageDir
  if (!existsSync(paths.packageDir)) return null
  try {
    const entries = readdirSync(paths.packageDir, { withFileTypes: true })
    const dirs = entries.filter((entry) => entry.isDirectory())
    if (dirs.length === 1) {
      const nested = join(paths.packageDir, dirs[0].name)
      if (existsSync(join(nested, MANIFEST_FILENAME))) return nested
    }
  } catch {
    /* ignore */
  }
  return null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** 供 Agent 直接消费的完整交接说明 */
export function buildHandoffDocument(
  profile: RepoProfile,
  paths: RepoWorkspacePaths,
  skillMarkdown?: string
): string {
  const languageHint =
    profile.languages[0]?.name === 'Python'
      ? 'python'
      : profile.languages.some((l) => l.name === 'JavaScript' || l.name === 'TypeScript')
        ? 'javascript'
        : '待判定'

  const lines: string[] = [
    '# 仓库 → Autoforge 脚本包 转换交接说明',
    '',
    '## 任务',
    '',
    `把仓库 \`${profile.ref.url}\`（${profile.resolvedRef}）转换成一个可以直接在 Autoforge 里导入并运行的脚本包。`,
    '',
    '## 工作区布局',
    '',
    '| 路径 | 用途 |',
    '|------|------|',
    `| \`${paths.repoPath}\` | 原始仓库源码，**只读参考**，不要在此目录写入产物 |`,
    `| \`${paths.profilePath}\` | 仓库画像 JSON（结构化分析结果） |`,
    `| \`${paths.packageDir}\` | **转换产物目录：把脚本包写到这里** |`,
    '',
    '## 仓库画像',
    '',
    `- 主要语言：${profile.languages.slice(0, 3).map((l) => `${l.name}(${l.files} 文件)`).join('、') || '未知'}`,
    `- 规模：${profile.fileCount} 个文件 / ${formatBytes(profile.totalBytes)}`,
    `- 拉取方式：${profile.fetchMethod === 'git' ? 'git clone（浅克隆）' : '归档 zip'}${
      profile.commitSha ? ` · commit ${profile.commitSha.slice(0, 8)}` : ''
    }`,
    `- 许可证：${profile.license ?? '未发现'}`,
    `- 依赖清单：${profile.manifests.join('、') || '无'}`,
    `- 入口候选：${profile.entryCandidates.join('、') || '无'}`,
    `- 运行期依赖：${profile.runtimeDependencies.slice(0, 20).join('、') || '无'}`,
    `- 可转换性：**${profile.convertibility}** — ${profile.convertibilityReason}`,
    `- 建议语言：${languageHint}`,
    ''
  ]

  if (profile.risks.length) {
    lines.push('### 风险提示', '', ...profile.risks.map((risk) => `- ${risk}`), '')
  }

  if (profile.readme) {
    lines.push('### README 摘要', '', '```markdown', profile.readme.trim(), '```', '')
  }

  lines.push(
    '## 产物硬性要求',
    '',
    `1. 在 \`${paths.packageDir}\` 下生成 \`autoforge.json\`，必填 \`autoforge: "1.0"\` 与 \`name\`。`,
    '2. 入口文件必须导出可调用函数：',
    '   - JavaScript：`export async function run(ctx) { ... }`（也接受 `main(ctx)` 或 `default`）',
    '   - Python：`async def run(ctx):` 或 `def run(ctx):`（也接受 `main(ctx)`）',
    '3. 入口必须位于包目录内；需要的仓库源码请**复制**进包目录，保持包自包含。',
    '4. 依赖只声明运行期真正需要的：JS 写进 `dependencies`（npm 包名→版本），Python 同样写入（pip 包名→版本）。',
    '5. 固定环境配置放 `env`，每次任务才变的输入放 `params`，两者禁止混用。',
    '6. 有文件产出时在返回值里回传本机绝对路径的 `outputDir`。',
    '7. 不要把 `node_modules`、`.venv`、`.git`、构建缓存复制进包目录。',
    '',
    '## 转换策略',
    '',
    '按仓库画像的 `convertibility` 选择策略：',
    '',
    '- `direct`：入口本身接近脚本，直接改写为 `run(ctx)` 契约即可。',
    '- `wrappable`：写一个薄适配入口，调用其 CLI（子进程）或库 API（import），把结果通过 `ctx.log` / 返回值回传。',
    '- `needs-build`：需要构建才能运行。优先寻找仓库中已提交的构建产物；否则在 `HANDOFF-NOTES.md` 里说明需要用户手动构建，并给出准确命令。',
    '- `unsupported`：不要强行生成脚本包。改为在 `HANDOFF-NOTES.md` 中说明原因，并给出替代建议（如改用 Docker、或包装其 CLI）。',
    '',
    '## 完成后的自检',
    '',
    '1. `autoforge.json` 能被 JSON 解析，`entry` 指向真实存在的文件。',
    '2. 入口函数名与签名符合上面的要求。',
    '3. 包目录内不存在 `.git` / `node_modules` / `.venv`。',
    '4. 把转换决策与遗留问题写入 `HANDOFF-NOTES.md`（可选但推荐）。',
    '',
    '## 导入方式',
    '',
    '产物写好后，有两种导入方式：',
    '',
    `- 在 Autoforge 的「从仓库导入」窗口中点击「导入产物」（应用会读取 \`${paths.packageDir}\`）。`,
    `- 或通过 MCP 调用 \`autoforge_import_script\`，传入 \`sourcePath\` = \`${paths.packageDir}\`，并带 \`confirm: true\`。`,
    ''
  )

  if (skillMarkdown?.trim()) {
    lines.push('---', '', '# 附：转换技能说明（repo-to-autoforge）', '', skillMarkdown.trim(), '')
  }

  return lines.join('\n')
}

/** 简短提示词，用户可直接粘贴给 Agent */
export function buildHandoffPrompt(profile: RepoProfile, paths: RepoWorkspacePaths): string {
  return [
    `请把仓库 ${profile.ref.url}（分支 ${profile.resolvedRef}）转换为 Autoforge 脚本包。`,
    '',
    `完整交接说明（请先读）：${paths.handoffPath}`,
    `原始仓库（只读参考）：${paths.repoPath}`,
    `产物目录（把脚本包写到这里）：${paths.packageDir}`,
    '',
    '要求：入口必须导出 run(ctx) 契约；包必须自包含；只声明运行期依赖；不要复制 node_modules/.git/.venv。',
    '完成后用 autoforge_import_script（confirm: true）导入该产物目录，或提示我在 Autoforge 里点击「导入产物」。'
  ].join('\n')
}

export function writeWorkspaceHandoff(taskId: string, document: string): string {
  const paths = getRepoWorkspacePaths(taskId)
  mkdirSync(paths.metaDir, { recursive: true })
  writeFileSync(paths.handoffPath, document, UTF8)
  return paths.handoffPath
}

export function readWorkspaceHandoff(taskId: string): string | null {
  const paths = getRepoWorkspacePaths(taskId)
  if (!existsSync(paths.handoffPath)) return null
  try {
    return readFileSync(paths.handoffPath, UTF8)
  } catch {
    return null
  }
}

export function listRepoWorkspaces(): RepoWorkspaceSummary[] {
  const root = getRepoWorkspacesRoot()
  if (!existsSync(root)) return []

  const results: RepoWorkspaceSummary[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const taskId = entry.name
    const profile = readWorkspaceProfile(taskId)
    if (!profile) continue
    results.push({
      taskId,
      provider: profile.ref.provider,
      repo: `${profile.ref.owner}/${profile.ref.repo}`,
      resolvedRef: profile.resolvedRef,
      workspacePath: join(root, taskId),
      packageReady: detectPackageRoot(taskId) !== null,
      createdAt: readWorkspaceCreatedAt(join(root, taskId))
    })
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function readWorkspaceCreatedAt(path: string): string {
  try {
    const stat = statSync(path)
    const time = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime
    return time.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

export function deleteRepoWorkspace(taskId: string): boolean {
  const paths = getRepoWorkspacePaths(taskId)
  if (!existsSync(paths.workspacePath)) return false
  try {
    rmSync(paths.workspacePath, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export function toWorkspaceInfo(
  paths: RepoWorkspacePaths,
  profile: RepoProfile,
  handoffPrompt: string
): RepoWorkspaceInfo {
  return {
    taskId: paths.taskId,
    profile,
    workspacePath: paths.workspacePath,
    repoPath: paths.repoPath,
    packageDir: paths.packageDir,
    handoffPrompt,
    handoffPath: paths.handoffPath,
    packageReady: detectPackageRoot(paths.taskId) !== null,
    turns: [],
    createdAt: new Date().toISOString()
  }
}
