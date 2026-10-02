import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path'
import { UTF8 } from '../../shared/encoding'
import { MANIFEST_FILENAME, validateManifest, type ScriptManifest } from '../../shared/script-contract'
import type { ConversionTurn } from '../../shared/conversion-conversation'
import { formatConversionHistory } from '../../shared/conversion-conversation'
import { REPO_PACKAGE_NEXT_DIR_NAME, type RepoProfile } from '../../shared/repo-types'
import type {
  ConversionPlan,
  ConversionPlanCopy,
  ConversionPlanEnvVar,
  ConversionPlanFile,
  ConversionPlanSkeleton,
  LlmConversionLogLine,
  LlmConversionPhase,
  LlmConversionProgress,
  LlmConversionResult,
  LlmProfile,
  PlanFileSpec
} from '../../shared/llm-types'
import {
  MAX_COPY_FILES,
  MAX_COPY_TOTAL_BYTES,
  MAX_PLAN_COPIES,
  MAX_PLAN_FILES,
  MAX_PLAN_FILE_BYTES,
  MAX_PLAN_TOTAL_BYTES
} from '../../shared/llm-types'
import { buildRepoDigest } from './repo-digest'
import { promoteStagedPackage } from './repo-workspace'
import { assertSafeBuildCommands, runBuildCommands } from './repo-build-runner'
import type { createLlmClient } from './llm-client'

/** 产物目录中禁止出现的路径片段 */
const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.autoforge'])
/** 复制时跳过的目录 */
const COPY_IGNORED_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache', 'coverage'])
const ALLOWED_LANGUAGES = new Set(['javascript', 'python'])

export class ConversionPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversionPlanError'
  }
}

/** 校验相对路径，确保只能落在指定根目录内 */
export function assertSafeRelativePath(rawPath: string, label: string): string {
  const input = rawPath?.trim()
  if (!input) throw new ConversionPlanError(`${label}为空`)

  const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '')
  if (normalized.startsWith('/')) throw new ConversionPlanError(`${label}不允许绝对路径：${input}`)
  if (/^[a-zA-Z]:/.test(normalized)) throw new ConversionPlanError(`${label}不允许盘符路径：${input}`)

  const segments = normalized.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) throw new ConversionPlanError(`${label}无效：${input}`)
  for (const segment of segments) {
    if (segment === '..') throw new ConversionPlanError(`${label}不允许上级目录：${input}`)
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      throw new ConversionPlanError(`${label}不允许指向依赖或元数据目录：${input}`)
    }
  }

  return segments.join(posix.sep)
}

/** 校验模型给出的脚本包内相对路径 */
export function assertSafePackagePath(rawPath: string): string {
  return assertSafeRelativePath(rawPath, '文件路径')
}

/** 解析并校验最终落盘路径仍在包目录内 */
export function resolveUnder(root: string, relativePath: string, label: string): string {
  const safeRelative = assertSafeRelativePath(relativePath, label)
  const base = resolve(root)
  const target = resolve(base, safeRelative.split(posix.sep).join(sep))
  if (target !== base && !target.startsWith(base + sep)) {
    throw new ConversionPlanError(`${label}越出根目录：${relativePath}`)
  }
  return target
}

export function resolvePackageFilePath(packageDir: string, relativePath: string): string {
  return resolveUnder(packageDir, relativePath, '文件路径')
}

function extractJsonObject(raw: string): unknown {
  const text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new ConversionPlanError('模型输出中没有找到 JSON 对象')
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConversionPlanError(`模型输出的 JSON 无法解析：${message}`)
  }
}

/** 去掉模型可能额外包上的 Markdown 代码块围栏 */
export function stripCodeFence(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').trim()
  const fenced = text.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/)
  if (fenced) return fenced[1]
  return text
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function normalizeSchemaField(raw: unknown, index: number): ConversionPlanEnvVar {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const key = asString(item.key).trim()
  if (!key) throw new ConversionPlanError(`第 ${index + 1} 个字段缺少 key`)
  const options = Array.isArray(item.options)
    ? item.options
        .map((option) => {
          if (typeof option === 'string') return { label: option, value: option }
          const obj = (option && typeof option === 'object' ? option : {}) as Record<string, unknown>
          const value = asString(obj.value ?? obj.label)
          return value ? { label: asString(obj.label ?? value), value } : null
        })
        .filter((option): option is { label: string; value: string } => option !== null)
    : undefined
  return {
    key,
    label: asString(item.label).trim() || key,
    description: asString(item.description).trim() || undefined,
    type: asString(item.type).trim() || undefined,
    default: item.default === undefined || item.default === null ? undefined : asString(item.default),
    secret: item.secret === true,
    options: options?.length ? options : undefined
  }
}

/** 规范化 env / params 字段数组，供转换与修复共用 */
export function normalizeSchemaFields(raw: unknown): ConversionPlanEnvVar[] {
  return Array.isArray(raw) ? raw.map(normalizeSchemaField) : []
}

function normalizeDependencies(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, string> = {}
  for (const [name, version] of Object.entries(raw as Record<string, unknown>)) {
    const key = name.trim()
    if (!key) continue
    result[key] = asString(version).trim() || '*'
  }
  return result
}

function normalizeMetadata(parsed: Record<string, unknown>): Omit<ConversionPlanSkeleton, 'files'> {
  const language = asString(parsed.language).trim().toLowerCase()
  if (!ALLOWED_LANGUAGES.has(language)) {
    throw new ConversionPlanError(`不支持的目标语言：${language || '(空)'}，只能是 javascript 或 python`)
  }
  const name = asString(parsed.name).trim()
  if (!name) throw new ConversionPlanError('计划缺少 name')

  return {
    summary: asString(parsed.summary).trim() || `将 ${name} 转换为 Autoforge 脚本包`,
    language: language as ConversionPlanSkeleton['language'],
    entry: assertSafePackagePath(asString(parsed.entry).trim()),
    name,
    description: asString(parsed.description).trim() || undefined,
    category: asString(parsed.category).trim() || 'local',
    icon: asString(parsed.icon).trim() || undefined,
    dependencies: normalizeDependencies(parsed.dependencies),
    env: Array.isArray(parsed.env) ? parsed.env.map(normalizeSchemaField) : [],
    params: Array.isArray(parsed.params) ? parsed.params.map(normalizeSchemaField) : [],
    buildCommands: Array.isArray(parsed.buildCommands)
      ? parsed.buildCommands.map((command) => asString(command).trim()).filter(Boolean)
      : [],
    notes: asString(parsed.notes).trim() || undefined,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((warning) => asString(warning).trim()).filter(Boolean)
      : []
  }
}

/**
 * 解析阶段一的计划骨架。
 *
 * 骨架不含代码正文，因此体积小、不易触发输出截断，也不会出现 JSON 字符串转义问题。
 */
export function parsePlanSkeleton(raw: string): ConversionPlanSkeleton {
  const parsed = extractJsonObject(raw) as Record<string, unknown>
  const metadata = normalizeMetadata(parsed)

  const rawFiles = Array.isArray(parsed.files) ? parsed.files : []
  if (rawFiles.length === 0) throw new ConversionPlanError('计划没有包含任何文件')
  if (rawFiles.length > MAX_PLAN_FILES) {
    throw new ConversionPlanError(`计划文件数过多（${rawFiles.length}，上限 ${MAX_PLAN_FILES}）`)
  }

  const files: PlanFileSpec[] = []
  const seen = new Set<string>()
  for (const entry of rawFiles) {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const path = assertSafePackagePath(asString(item.path))
    if (path === MANIFEST_FILENAME) continue
    if (seen.has(path)) throw new ConversionPlanError(`计划中存在重复文件：${path}`)
    seen.add(path)

    const source = asString(item.source).trim().toLowerCase() === 'copy' ? 'copy' : 'generate'
    const spec: PlanFileSpec = {
      path,
      purpose: asString(item.purpose).trim() || '未说明用途',
      source
    }
    if (source === 'copy') {
      const copyFrom = asString(item.copyFrom).trim()
      if (!copyFrom) throw new ConversionPlanError(`文件 ${path} 声明为复制，但缺少 copyFrom`)
      spec.copyFrom = assertSafeRelativePath(copyFrom, '复制源路径')
    }
    files.push(spec)
  }

  if (files.length === 0) throw new ConversionPlanError('计划没有包含有效文件')
  return { ...metadata, files }
}

/** 阶段二：把单个文件的纯文本输出规范化为文件内容 */
export function parseFileContent(raw: string, expectedPath: string): string {
  const content = stripCodeFence(raw)
  if (!content.trim()) {
    throw new ConversionPlanError(`文件 ${expectedPath} 的内容为空`)
  }
  const bytes = Buffer.byteLength(content, UTF8)
  if (bytes > MAX_PLAN_FILE_BYTES) {
    throw new ConversionPlanError(
      `文件 ${expectedPath} 超过单文件上限（${Math.round(bytes / 1024)} KB，上限 ${MAX_PLAN_FILE_BYTES / 1024} KB）`
    )
  }
  return content
}

function isEntryCovered(entry: string, files: ConversionPlanFile[], copies: ConversionPlanCopy[]): boolean {
  if (files.some((file) => file.path === entry)) return true
  return copies.some((copy) => entry === copy.to || entry.startsWith(copy.to.replace(/\/+$/, '') + '/'))
}

/** 把阶段一骨架与阶段二内容合并后做完整校验 */
export function parseConversionPlan(raw: string): ConversionPlan {
  const parsed = extractJsonObject(raw) as Record<string, unknown>
  const metadata = normalizeMetadata(parsed)

  const rawFiles = Array.isArray(parsed.files) ? parsed.files : []
  if (rawFiles.length > MAX_PLAN_FILES) {
    throw new ConversionPlanError(`计划文件数过多（${rawFiles.length}，上限 ${MAX_PLAN_FILES}）`)
  }

  const files: ConversionPlanFile[] = []
  const seen = new Set<string>()
  let totalBytes = 0
  for (const entry of rawFiles) {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const path = assertSafePackagePath(asString(item.path))
    if (path === MANIFEST_FILENAME) continue
    if (seen.has(path)) throw new ConversionPlanError(`计划中存在重复文件：${path}`)
    seen.add(path)

    const content = asString(item.content)
    const bytes = Buffer.byteLength(content, UTF8)
    if (bytes > MAX_PLAN_FILE_BYTES) {
      throw new ConversionPlanError(`文件 ${path} 超过单文件上限（${Math.round(bytes / 1024)} KB）`)
    }
    totalBytes += bytes
    if (totalBytes > MAX_PLAN_TOTAL_BYTES) {
      throw new ConversionPlanError('计划总大小超过上限（4 MB）')
    }
    files.push({ path, content })
  }

  const rawCopies = Array.isArray(parsed.copies) ? parsed.copies : []
  if (rawCopies.length > MAX_PLAN_COPIES) {
    throw new ConversionPlanError(`复制条目过多（${rawCopies.length}，上限 ${MAX_PLAN_COPIES}）`)
  }
  const copies: ConversionPlanCopy[] = rawCopies.map((entry) => {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    return {
      from: assertSafeRelativePath(asString(item.from), '复制源路径'),
      to: assertSafePackagePath(asString(item.to))
    }
  })

  if (files.length === 0 && copies.length === 0) {
    throw new ConversionPlanError('计划没有包含任何文件或复制条目')
  }
  if (!isEntryCovered(metadata.entry, files, copies)) {
    throw new ConversionPlanError(`入口文件 ${metadata.entry} 既不在 files 中，也不在任何 copies 的复制目标内`)
  }

  return { ...metadata, files, copies }
}

/** 由计划生成 autoforge.json（经 validateManifest 校验） */
export function buildManifestFromPlan(plan: ConversionPlan): ScriptManifest {
  const raw: Record<string, unknown> = {
    autoforge: '1.0',
    name: plan.name,
    description: plan.description ?? plan.summary,
    version: '1.0.0',
    language: plan.language,
    entry: plan.entry,
    category: plan.category ?? 'local',
    env: plan.env,
    params: plan.params,
    dependencies: plan.dependencies
  }
  if (plan.icon) raw.icon = plan.icon

  const result = validateManifest(raw)
  if (!result.ok) throw new ConversionPlanError(`生成的清单未通过校验：${result.error}`)
  return result.manifest
}

interface CopyStats {
  files: number
  bytes: number
}

/** 把仓库内的文件或目录复制进脚本包 */
export function copyFromRepo(
  repoDir: string,
  packageDir: string,
  copy: ConversionPlanCopy,
  stats: CopyStats
): void {
  const source = resolveUnder(repoDir, copy.from, '复制源路径')
  if (!existsSync(source)) {
    throw new ConversionPlanError(`复制源不存在：${copy.from}（构建是否成功？）`)
  }

  const sourceStat = statSync(source)
  const targetIsDirectoryHint = /[/\\]$/.test(copy.to) || sourceStat.isDirectory()
  const target = resolvePackageFilePath(
    packageDir,
    targetIsDirectoryHint && sourceStat.isFile() ? `${copy.to}/${basename(source)}` : copy.to
  )

  const account = (bytes: number): void => {
    stats.files += 1
    stats.bytes += bytes
    if (stats.files > MAX_COPY_FILES) {
      throw new ConversionPlanError(`复制文件数超过上限（${MAX_COPY_FILES}）`)
    }
    if (stats.bytes > MAX_COPY_TOTAL_BYTES) {
      throw new ConversionPlanError(`复制总大小超过上限（${MAX_COPY_TOTAL_BYTES / 1024 / 1024} MB）`)
    }
  }

  if (sourceStat.isFile()) {
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
    account(sourceStat.size)
    return
  }
  if (!sourceStat.isDirectory()) {
    throw new ConversionPlanError(`复制源类型不支持：${copy.from}`)
  }

  mkdirSync(target, { recursive: true })
  const walk = (currentDir: string): void => {
    for (const child of readdirSync(currentDir, { withFileTypes: true })) {
      if (child.isSymbolicLink()) continue
      const absolute = join(currentDir, child.name)
      if (child.isDirectory()) {
        if (COPY_IGNORED_DIRS.has(child.name)) continue
        walk(absolute)
        continue
      }
      if (!child.isFile()) continue
      const relativePath = relative(source, absolute)
      const destination = join(target, relativePath)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(absolute, destination)
      account(statSync(absolute).size)
    }
  }
  walk(source)
}

const SKELETON_CONTRACT = [
  '## 输出格式',
  '',
  '只输出一个 JSON 对象（不要输出 Markdown 代码块以外的任何文字）。**不要输出任何文件正文。**',
  '',
  '```json',
  '{',
  '  "summary": "一句话说明这次转换做了什么",',
  '  "language": "javascript | python",',
  '  "entry": "相对脚本包目录的入口文件，必须出现在 files 中或落在某个 copies 的 to 之内",',
  '  "name": "脚本显示名",',
  '  "description": "脚本说明",',
  '  "category": "browser | local | scrape | file | system",',
  '  "icon": "可选，如 terminal / file-text / globe",',
  '  "dependencies": { "npm包名或pip包名": ">=1.0.0" },',
  '  "env": [{ "key": "API_URL", "label": "接口地址", "type": "text", "default": "", "secret": false }],',
  '  "params": [{ "key": "QUERY", "label": "查询词", "type": "text", "default": "" }],',
  '  "files": [',
  '    { "path": "index.mjs", "purpose": "适配入口，包装仓库 CLI", "source": "generate" },',
  '    { "path": "vendor/dist/app.js", "purpose": "构建产物", "source": "copy", "copyFrom": "dist/app.js" }',
  '  ],',
  '  "buildCommands": ["npm install", "npm run build"],',
  '  "notes": "转换决策说明",',
  '  "warnings": ["遗留问题"]',
  '}',
  '```',
  '',
  '硬性约束：',
  '',
  '1. `files[].path` 是脚本包内的相对路径；禁止绝对路径、`..`、`.git`、`node_modules`、`.venv`。',
  '2. `source` 只能是 `generate` 或 `copy`：',
  '   - `generate`：稍后你会被要求**逐个**输出这些文件的完整内容。只放你真正要写的代码（适配入口、小型胶水文件）。',
  '   - `copy`：应用会从仓库目录原样复制，**你不需要输出内容**。必须提供 `copyFrom`（仓库内相对路径，可以是文件或目录）。',
  '3. **构建产物一律用 `copy`，不要试图复述它们的内容。** 例如 `dist/`、`build/`、`out/`、`lib/` 下的文件，'
    + '以及任何压缩过、体积大或由工具生成的文件。',
  '4. 需要复用仓库源码时，优先用 `copy`（复制 `vendor/` 前缀下的路径），只有在需要改写时才用 `generate`。',
  '5. `dependencies` 只列**运行期**依赖，不要包含构建工具与测试框架。',
  '6. 固定环境配置放 `env`，每次任务才变的输入放 `params`。',
  '7. 需要先构建才能运行时，把构建命令写进 `buildCommands`；命令必须来自仓库实际配置，不要编造。',
  '8. `generate` 的文件不要超过 12 个，尽量精简。'
].join('\n')

const FILE_SYSTEM_PROMPT = [
  '你是 Autoforge 脚本包代码生成器。用户会指定一个文件路径，你只需输出**该文件的完整内容**。',
  '',
  '规则：',
  '',
  '1. 只输出文件内容本身：不要解释、不要用 Markdown 代码块包裹、不要输出 JSON、不要重复文件路径。',
  '2. 入口文件必须导出 `run(ctx)`：JavaScript 用 `export async function run(ctx) { ... }`，'
    + 'Python 用 `def run(ctx):` 或 `async def run(ctx):`。',
  '3. 所有文件路径必须基于 `ctx.sdk.paths.scriptDir`（JS）或 `ctx.sdk.paths.script_dir`（Python）解析，'
    + '不要硬编码绝对路径。',
  '4. 需要读取同包内的其他文件时，用相对当前文件的相对路径（JS 可用 `new URL(..., import.meta.url)`）。',
  '5. 不要写占位符、`TODO`、`...` 或伪代码，必须是完整可运行的实现。',
  '6. 日志用 `ctx.log("INFO", msg)`；有产物时在返回值里给出 `outputDir` 绝对路径。'
].join('\n')

export interface LlmConverterDeps {
  client: ReturnType<typeof createLlmClient>
  /** 解析要使用的配置与其密钥；缺省时使用默认配置 */
  resolveProfile: (profileId?: string) => { profile: LlmProfile; apiKey: string }
  /** 读取 repo-to-autoforge 技能正文 */
  readSkillMarkdown: () => string | undefined
}

export interface ConvertWithLlmInput {
  taskId: string
  repoDir: string
  packageDir: string
  repoProfile: RepoProfile
  profileId?: string
  /** 用户已授权执行构建命令（还需全局 allowBuild 开启） */
  allowBuild: boolean
  instruction?: string
  /** 本轮之前已完成的对话。思考过程不会进入提示词。 */
  history?: ConversionTurn[]
  signal?: AbortSignal
  /** 截至目前的完整思考文本，含各次模型调用的标签 */
  onReasoning?: (thinking: string) => void
  onProgress?: (progress: LlmConversionProgress) => void
  onLog?: (line: LlmConversionLogLine) => void
}

export interface LlmConverter {
  convert: (input: ConvertWithLlmInput) => Promise<LlmConversionResult>
}

/**
 * 把流式增量节流为进度上报，避免每个 token 都触发一次 IPC。
 * 既保证界面能看到「已接收 N KB」的实时反馈，又不会刷爆事件通道。
 */
export function createDeltaReporter(
  report: (progress: Omit<LlmConversionProgress, 'taskId'>) => void,
  phase: LlmConversionPhase,
  label: string,
  intervalMs = 300,
  stepChars = 4_096
): (delta: string, totalChars: number) => void {
  let lastAt = 0
  let lastChars = 0
  return (_delta, totalChars) => {
    const now = Date.now()
    if (now - lastAt < intervalMs && totalChars - lastChars < stepChars) return
    lastAt = now
    lastChars = totalChars
    report({
      phase,
      message: `${label} · 已接收 ${(totalChars / 1024).toFixed(1)} KB`
    })
  }
}

/** 单次模型调用因输出上限停下后，最多再续写这么多次 */
const OUTPUT_CONTINUATION_LIMIT = 8
const SKELETON_DIGEST_BUDGETS = [120_000, 40_000, 12_000]
const FILE_DIGEST_BUDGETS = [60_000, 20_000, 8_000]

/** 接口明确拒绝是因为提示词超过上下文，而不是输出被截断 */
export function isPromptLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /context[_ ]length|maximum context|too many tokens|token limit|max(?:imum)? tokens|context window|超出.{0,12}(?:token|长度|上限)|上下文.{0,8}(?:过长|超限|超出)/i.test(
    message
  )
}

/** 把续写片段接回已有正文，并去掉模型重复的重叠部分 */
export function joinContinuation(existing: string, next: string): string {
  if (!existing) return next
  if (!next) return existing
  if (next.startsWith(existing)) return next
  const limit = Math.min(existing.length, next.length, 800)
  for (let size = limit; size >= 16; size -= 1) {
    if (existing.endsWith(next.slice(0, size))) return existing + next.slice(size)
  }
  return existing + next
}

/**
 * 只保留最新一次文本，并限制上报频率。
 * 思考过程每个 token 都上报时，主进程写盘和界面重绘会把程序卡住。
 */
export function createLatestThrottle(
  emit: (text: string) => void,
  intervalMs: number
): { push: (text: string) => void; flush: () => void } {
  let pending: string | undefined
  let lastAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (pending === undefined) return
    const text = pending
    pending = undefined
    lastAt = Date.now()
    emit(text)
  }
  return {
    push(text: string) {
      pending = text
      const wait = intervalMs - (Date.now() - lastAt)
      if (wait <= 0) flush()
      else if (!timer) timer = setTimeout(flush, wait)
    },
    flush
  }
}

export function createLlmConverter(deps: LlmConverterDeps): LlmConverter {
  async function convert(input: ConvertWithLlmInput): Promise<LlmConversionResult> {
    const { taskId, repoDir, packageDir, repoProfile } = input
    const report = (progress: Omit<LlmConversionProgress, 'taskId'>): void => {
      input.onProgress?.({ taskId, ...progress })
    }
    const log = (level: LlmConversionLogLine['level'], message: string): void => {
      input.onLog?.({ taskId, level, message })
    }

    const { profile, apiKey } = deps.resolveProfile(input.profileId)
    if (!apiKey?.trim()) {
      throw new ConversionPlanError(`配置「${profile.name}」还没有填写 API Key`)
    }

    const reasoningSegments: Array<{ label: string; text: string }> = []
    const reasoningGate = createLatestThrottle((thinking) => {
      input.onReasoning?.(thinking)
    }, 400)
    const publishReasoning = (label: string, text: string): void => {
      const existing = reasoningSegments.find((item) => item.label === label)
      if (existing) existing.text = text
      else reasoningSegments.push({ label, text })
      reasoningGate.push(reasoningSegments.map((item) => `${item.label}\n${item.text}`).join('\n\n'))
    }
    const historyText = formatConversionHistory(input.history ?? [])
    const extraRequirement = input.instruction?.trim() ? `额外要求：${input.instruction.trim()}` : ''
    let loggedContext = false

    const chat = async (
      messages: Array<{ role: 'system' | 'user'; content: string }>,
      json: boolean,
      context: { phase: LlmConversionPhase; label: string; reasoningLabel: string }
    ): Promise<Awaited<ReturnType<typeof deps.client.chatStream>>> => {
      const carried = reasoningSegments.find((item) => item.label === context.reasoningLabel)?.text ?? ''
      try {
        return await deps.client.chatStream({
          baseUrl: profile.baseUrl,
          model: profile.model,
          apiKey,
          messages,
          temperature: profile.temperature,
          maxOutputTokens: profile.maxOutputTokens,
          // 流式下该值表示「多久没有新内容算卡死」，而不是整次请求的总时长
          idleTimeoutSeconds: profile.timeoutSeconds,
          extraHeaders: profile.extraHeaders,
          json,
          signal: input.signal,
          onDelta: createDeltaReporter(report, context.phase, context.label),
          onReasoning: (thinking) =>
            publishReasoning(context.reasoningLabel, carried ? `${carried}\n${thinking}` : thinking)
        })
      } finally {
        reasoningGate.flush()
      }
    }

    const continueUntilDone = async (
      messages: Array<{ role: 'system' | 'user'; content: string }>,
      json: boolean,
      context: { phase: LlmConversionPhase; label: string; reasoningLabel: string }
    ): Promise<Awaited<ReturnType<typeof deps.client.chatStream>>> => {
      let content = ''
      let last: Awaited<ReturnType<typeof deps.client.chatStream>> | undefined
      for (let part = 0; part <= OUTPUT_CONTINUATION_LIMIT; part += 1) {
        const requestMessages =
          part === 0
            ? messages
            : [
                {
                  role: 'system' as const,
                  content: json
                    ? '你正在续写被截断的 JSON。只输出剩余片段，紧接已写内容，不要重复，不要使用 Markdown。'
                    : '你正在续写被截断的文件正文。只输出剩余片段，紧接已写内容，不要重复，不要解释。'
                },
                {
                  role: 'user' as const,
                  content: `已写内容的结尾如下，请从截断处接着写：\n${content.slice(-4_000)}`
                }
              ]
        const before = reasoningSegments.find((item) => item.label === context.reasoningLabel)?.text ?? ''
        last = await chat(requestMessages, part === 0 ? json : false, context)
        content = part === 0 ? last.content : joinContinuation(content, last.content)
        if (last.reasoning) {
          const combined = before ? `${before}\n${last.reasoning}` : last.reasoning
          const current = reasoningSegments.find((item) => item.label === context.reasoningLabel)?.text
          if (current !== combined) publishReasoning(context.reasoningLabel, combined)
        }
        reasoningGate.flush()
        if (last.finishReason !== 'length') break
        if (part === OUTPUT_CONTINUATION_LIMIT) {
          log('WARN', `${context.label} 已续写 ${OUTPUT_CONTINUATION_LIMIT} 次，将使用已得到的内容继续`)
          break
        }
        log('INFO', `${context.label} 达到输出长度上限，正在续写`)
      }
      return { ...last!, content }
    }

    const chatWithDigest = async (
      buildMessages: (digest: string) => Array<{ role: 'system' | 'user'; content: string }>,
      budgets: number[],
      compact: boolean,
      json: boolean,
      context: { phase: LlmConversionPhase; label: string; reasoningLabel: string }
    ): Promise<Awaited<ReturnType<typeof deps.client.chatStream>>> => {
      let lastError: unknown
      for (let index = 0; index < budgets.length; index += 1) {
        const digest = buildRepoDigest(
          repoDir,
          repoProfile,
          compact
            ? {
                includeTree: false,
                includeReadme: false,
                maxEntryFiles: 3,
                totalBudgetChars: budgets[index]
              }
            : { totalBudgetChars: budgets[index] }
        )
        if (!loggedContext) {
          log('INFO', `已生成仓库上下文（${digest.length} 字符），模型：${profile.model}`)
          loggedContext = true
        }
        try {
          return await continueUntilDone(buildMessages(digest), json, context)
        } catch (error) {
          lastError = error
          if (!isPromptLimitError(error) || index === budgets.length - 1) throw error
          log('WARN', `${context.label} 的上下文超出模型上限，正在缩短仓库摘要后重试`)
        }
      }
      throw lastError
    }

    // ---------- 阶段一：计划骨架 ----------
    report({ phase: 'preparing', message: '正在整理仓库上下文' })
    report({ phase: 'generating', message: '正在生成转换计划' })
    const skeletonStartedAt = Date.now()
    const skeletonContext = { phase: 'generating' as const, label: '正在生成转换计划', reasoningLabel: '转换计划' }
    const skeletonResult = await chatWithDigest(
      (digest) => [
        { role: 'system', content: buildSystemPrompt(deps.readSkillMarkdown()) },
        {
          role: 'user',
          content: [
            '请为下面的仓库设计 Autoforge 脚本包的转换计划。**只输出计划骨架，不要输出任何文件正文。**',
            '',
            `仓库目录（只读参考）：${repoDir}`,
            historyText,
            extraRequirement,
            '',
            digest
          ]
            .filter(Boolean)
            .join('\n')
        }
      ],
      SKELETON_DIGEST_BUDGETS,
      false,
      true,
      skeletonContext
    )
    log(
      'INFO',
      `计划骨架返回 ${skeletonResult.content.length} 字符，耗时 ${((Date.now() - skeletonStartedAt) / 1000).toFixed(1)} 秒` +
        `${skeletonResult.streamed ? '（流式）' : ''}`
    )

    report({ phase: 'validating', message: '正在校验转换计划' })
    const skeleton = parsePlanSkeleton(skeletonResult.content)
    const generateSpecs = skeleton.files.filter((file) => file.source === 'generate')
    const copySpecs = skeleton.files.filter((file) => file.source === 'copy')
    log(
      'INFO',
      `计划通过校验：生成 ${generateSpecs.length} 个文件，复制 ${copySpecs.length} 个条目，` +
        `${Object.keys(skeleton.dependencies).length} 个依赖`
    )
    for (const warning of skeleton.warnings ?? []) log('WARN', warning)

    // ---------- 可选：构建 ----------
    let executedBuildCommands: string[] = []
    const buildCommands = assertSafeBuildCommands(skeleton.buildCommands)
    if (buildCommands.length > 0) {
      if (!input.allowBuild) {
        log('WARN', `计划包含 ${buildCommands.length} 条构建命令，但未获授权，已跳过`)
      } else {
        report({ phase: 'building', message: '正在安装依赖并执行构建' })
        log('INFO', `开始执行构建命令（共 ${buildCommands.length} 条）`)
        const buildResult = await runBuildCommands({
          rootDir: repoDir,
          commands: buildCommands,
          onLog: (level, message) => log(level, message),
          signal: input.signal
        })
        if (!buildResult.ok) {
          throw new ConversionPlanError(
            `构建失败：${buildResult.failedCommand ?? '未知命令'}（${buildResult.error ?? '未知原因'}）`
          )
        }
        executedBuildCommands = buildResult.executed
        log('INFO', '构建完成')
      }
    }

    // ---------- 阶段二：逐文件生成 ----------
    const files: ConversionPlanFile[] = []
    const planContext = [
      `计划概览：${skeleton.summary}`,
      `语言：${skeleton.language}`,
      `入口：${skeleton.entry}`,
      `运行期依赖：${Object.keys(skeleton.dependencies).join('、') || '无'}`,
      copySpecs.length
        ? `将从仓库复制：${copySpecs.map((spec) => `${spec.copyFrom} → ${spec.path}`).join('；')}`
        : '',
      ''
    ]
      .filter(Boolean)
      .join('\n')

    for (const [index, spec] of generateSpecs.entries()) {
      const label = `正在生成 ${spec.path}（${index + 1}/${generateSpecs.length}）`
      report({ phase: 'generating', message: label })
      const startedAt = Date.now()
      const result = await chatWithDigest(
        (digest) => [
          { role: 'system', content: FILE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              planContext,
              `现在输出文件：${spec.path}`,
              `用途：${spec.purpose}`,
              historyText,
              extraRequirement,
              '',
              digest
            ]
              .filter(Boolean)
              .join('\n')
          }
        ],
        FILE_DIGEST_BUDGETS,
        true,
        false,
        { phase: 'generating', label, reasoningLabel: `文件 ${spec.path}` }
      )
      const content = parseFileContent(result.content, spec.path)
      files.push({ path: spec.path, content })
      log(
        'INFO',
        `生成 ${spec.path}（${Buffer.byteLength(content, UTF8)} 字节，${((Date.now() - startedAt) / 1000).toFixed(1)} 秒）`
      )
    }

    // ---------- 合并校验 ----------
    report({ phase: 'validating', message: '正在校验转换结果' })
    const copies: ConversionPlanCopy[] = copySpecs.map((spec) => ({
      from: spec.copyFrom as string,
      to: spec.path
    }))
    const plan = parseConversionPlan(JSON.stringify({ ...skeleton, files, copies }))

    // ---------- 写盘：先写入同级暂存目录，成功后再替换正式产物 ----------
    report({ phase: 'writing', message: '正在写入脚本包' })
    const stagingDir = join(dirname(packageDir), REPO_PACKAGE_NEXT_DIR_NAME)
    let promoted = false
    let writtenFiles = 0
    try {
      if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true })
      mkdirSync(stagingDir, { recursive: true })

      for (const file of plan.files) {
        const target = resolvePackageFilePath(stagingDir, file.path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, file.content, UTF8)
        writtenFiles += 1
      }

      const copyStats: CopyStats = { files: 0, bytes: 0 }
      for (const copy of plan.copies) {
        copyFromRepo(repoDir, stagingDir, copy, copyStats)
        log('INFO', `复制 ${copy.from} → ${copy.to}`)
      }
      writtenFiles += copyStats.files

      const manifest = buildManifestFromPlan(plan)
      writeFileSync(join(stagingDir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), UTF8)
      writtenFiles += 1

      const entryPath = resolvePackageFilePath(stagingDir, plan.entry)
      if (!existsSync(entryPath)) {
        throw new ConversionPlanError(`入口文件未生成：${plan.entry}（请重新转换）`)
      }

      promoteStagedPackage(stagingDir, packageDir)
      promoted = true
    } catch (error) {
      if (!promoted && existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true })
      throw error
    }

    log('INFO', `脚本包写入完成：${writtenFiles} 个文件`)
    report({ phase: 'complete', message: '脚本包已生成', percent: 100 })

    return {
      taskId,
      plan,
      writtenFiles,
      copiedEntries: plan.copies.length,
      executedBuildCommands,
      packageReady: true
    }
  }

  return { convert }
}

function buildSystemPrompt(skillMarkdown?: string): string {
  return [
    '你是 Autoforge 脚本包转换专家。你的任务是把一个既有仓库改造成符合 Autoforge 规范的脚本包。',
    '',
    'Autoforge 脚本包最小结构：`autoforge.json`（清单）+ 入口文件（导出 run(ctx)）。',
    '运行期只支持 JavaScript（主进程 import）与 Python（子进程），没有构建阶段。',
    '',
    skillMarkdown?.trim() ? `# 转换技能说明\n\n${skillMarkdown.trim()}` : '',
    '',
    SKELETON_CONTRACT
  ]
    .filter(Boolean)
    .join('\n')
}
