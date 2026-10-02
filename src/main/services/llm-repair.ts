import { validateManifest, type ScriptManifest } from '../../shared/script-contract'
import type {
  LlmConversionLogLine,
  LlmConversionProgress,
  LlmProfile,
  RepairManifestPatch,
  RepairPlanFileSpec,
  RepairPlanSkeleton,
  ScriptRepairContext,
  ScriptRepairRequest,
  ScriptRepairResult
} from '../../shared/llm-types'
import {
  MAX_REPAIR_CONTEXT_FILE_BYTES,
  MAX_REPAIR_FILES,
  MAX_REPAIR_LOG_LINES
} from '../../shared/llm-types'
import {
  assertSafePackagePath,
  ConversionPlanError,
  createDeltaReporter,
  normalizeSchemaFields,
  ENTRY_RUNTIME_CONTRACT,
  parseFileContent
} from './llm-converter'
import type { createLlmClient } from './llm-client'

/** 修复过程中禁止删除的文件 */
const PROTECTED_FILES = new Set(['autoforge.json', 'scriptbox.json'])

export interface RepairChanges {
  files: Array<{ path: string; content: string }>
  deleteFiles: string[]
  manifestPatch?: RepairManifestPatch
}

export interface RepairApplyOutcome {
  changedFiles: string[]
  deletedFiles: string[]
  manifestUpdated: boolean
}

export interface ScriptRepairDeps {
  client: ReturnType<typeof createLlmClient>
  resolveProfile: (profileId?: string) => { profile: LlmProfile; apiKey: string }
  /** 收集脚本上下文；脚本不存在时返回 null */
  readContext: (scriptId: string, logs: string[]) => ScriptRepairContext | null
  /** 把修复结果写回脚本工作区 */
  applyChanges: (scriptId: string, changes: RepairChanges) => RepairApplyOutcome
}

export interface ScriptRepairRunInput extends ScriptRepairRequest {
  onProgress?: (progress: LlmConversionProgress) => void
  onLog?: (line: LlmConversionLogLine) => void
}

export interface ScriptRepairer {
  repair: (input: ScriptRepairRunInput) => Promise<ScriptRepairResult>
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/** 解析阶段一的修复计划骨架 */
export function parseRepairPlanSkeleton(raw: string): RepairPlanSkeleton {
  const parsed = extractJsonObject(raw) as Record<string, unknown>

  const rawFiles = Array.isArray(parsed.files) ? parsed.files : []
  if (rawFiles.length > MAX_REPAIR_FILES) {
    throw new ConversionPlanError(`一次修复的文件过多（${rawFiles.length}，上限 ${MAX_REPAIR_FILES}）`)
  }

  const files: RepairPlanFileSpec[] = []
  const seen = new Set<string>()
  for (const entry of rawFiles) {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const path = assertSafePackagePath(asString(item.path))
    if (seen.has(path)) throw new ConversionPlanError(`修复计划中存在重复文件：${path}`)
    seen.add(path)
    files.push({ path, purpose: asString(item.purpose).trim() || '未说明' })
  }

  const rawDeletes = Array.isArray(parsed.deleteFiles) ? parsed.deleteFiles : []
  const deleteFiles: string[] = []
  for (const entry of rawDeletes) {
    const path = assertSafePackagePath(asString(entry))
    if (PROTECTED_FILES.has(path)) {
      throw new ConversionPlanError(`不允许删除清单文件：${path}`)
    }
    if (files.some((file) => file.path === path)) continue
    deleteFiles.push(path)
  }

  const patch = (parsed.manifestPatch && typeof parsed.manifestPatch === 'object'
    ? parsed.manifestPatch
    : undefined) as Record<string, unknown> | undefined

  const manifestPatch: RepairManifestPatch | undefined = patch
    ? {
        dependencies:
          patch.dependencies && typeof patch.dependencies === 'object'
            ? Object.fromEntries(
                Object.entries(patch.dependencies as Record<string, unknown>)
                  .map(([name, version]) => [name.trim(), asString(version).trim() || '*'] as const)
                  .filter(([name]) => Boolean(name))
              )
            : undefined,
        entry: asString(patch.entry).trim() ? assertSafePackagePath(asString(patch.entry).trim()) : undefined,
        env: patch.env === undefined ? undefined : normalizeSchemaFields(patch.env),
        params: patch.params === undefined ? undefined : normalizeSchemaFields(patch.params),
        browser:
          patch.browser && typeof patch.browser === 'object' && typeof (patch.browser as { headless?: unknown }).headless === 'boolean'
            ? { headless: (patch.browser as { headless: boolean }).headless }
            : undefined
      }
    : undefined

  const summary = asString(parsed.summary).trim()
  const diagnosis = asString(parsed.diagnosis).trim()
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map((warning) => asString(warning).trim()).filter(Boolean)
    : []

  if (!summary) throw new ConversionPlanError('修复计划缺少 summary')
  if (files.length === 0 && deleteFiles.length === 0 && !manifestPatch) {
    const detail = [diagnosis, ...warnings].filter(Boolean).join('；')
    throw new ConversionPlanError(`模型认为无法通过修改代码解决：${detail || '未给出原因'}`)
  }

  return {
    summary,
    diagnosis: diagnosis || '未给出根因说明',
    files,
    deleteFiles,
    manifestPatch,
    notes: asString(parsed.notes).trim() || undefined,
    warnings
  }
}

/** 把清单补丁合并进当前清单（纯函数，便于测试） */
export function mergeManifestPatch(
  manifest: ScriptManifest,
  patch?: RepairManifestPatch
): ScriptManifest {
  if (!patch) return manifest

  const next: ScriptManifest = { ...manifest }

  if (patch.dependencies) {
    next.dependencies = { ...(manifest.dependencies ?? {}), ...patch.dependencies }
  }
  if (patch.entry) {
    next.entry = patch.entry
  }
  if (patch.env) {
    // 模型给出的 type 是任意字符串，随后由 validatePatchedManifest → validateManifest 归一化
    next.env = patch.env as unknown as ScriptManifest['env']
  }
  if (patch.params) {
    next.params = patch.params as unknown as ScriptManifest['params']
  }
  if (patch.browser) {
    next.browser = { ...(manifest.browser ?? {}), ...patch.browser }
  }
  return next
}

/** 校验合并后的清单仍然合法 */
export function validatePatchedManifest(manifest: ScriptManifest): ScriptManifest {
  const result = validateManifest(manifest)
  if (!result.ok) throw new ConversionPlanError(`修复后的清单未通过校验：${result.error}`)
  return result.manifest
}

function formatContext(context: ScriptRepairContext): string {
  const sections: string[] = []

  sections.push(
    [
      '## 脚本现状',
      '',
      `- 名称：${context.name}`,
      `- 语言：${context.language}`,
      `- 入口：${context.entry}`,
      ''
    ].join('\n')
  )

  sections.push(['## 当前清单（autoforge.json）', '', '```json', context.manifestText.trim(), '```', ''].join('\n'))

  if (context.recentRuns.length) {
    sections.push(
      [
        '## 最近执行记录',
        '',
        ...context.recentRuns.map((run) => {
          const parts = [`- ${run.startedAt} · ${run.status}`]
          if (run.exitCode !== undefined) parts.push(`退出码 ${run.exitCode}`)
          if (run.errorMessage) parts.push(`错误：${run.errorMessage}`)
          return parts.join('　')
        }),
        ''
      ].join('\n')
    )
  }

  if (context.logs.length) {
    sections.push(
      [
        '## 失败日志（尾部）',
        '',
        '```',
        ...context.logs.slice(-MAX_REPAIR_LOG_LINES),
        '```',
        ''
      ].join('\n')
    )
  }

  sections.push('## 当前文件', '')
  let used = 0
  for (const file of context.files) {
    const content = file.content.length > MAX_REPAIR_CONTEXT_FILE_BYTES
      ? `${file.content.slice(0, MAX_REPAIR_CONTEXT_FILE_BYTES)}\n... [已截断]`
      : file.content
    if (used + content.length > 240_000) break
    used += content.length
    sections.push(`### ${file.path}`, '', '```', content.trim(), '```', '')
  }

  return sections.join('\n')
}

const REPAIR_SKELETON_CONTRACT = [
  '## 输出格式',
  '',
  '只输出一个 JSON 对象。**不要输出任何文件正文。**',
  '',
  '```json',
  '{',
  '  "summary": "一句话说明这次改了什么",',
  '  "diagnosis": "根因判断：为什么原来的代码跑不起来",',
  '  "files": [{ "path": "index.mjs", "purpose": "修复 xxx" }],',
  '  "deleteFiles": [],',
  '  "manifestPatch": {',
  '    "dependencies": { "缺失的包名": ">=1.0.0" },',
  '    "entry": "可选，需要改入口时才给"',
  '  },',
  '  "notes": "补充说明",',
  '  "warnings": ["无法通过改代码解决的问题"]',
  '}',
  '```',
  '',
  '硬性约束：',
  '',
  '1. **先判断根因**。日志里明确指向什么就改什么，不要顺手重构无关代码。',
  '2. 只列出**确实需要重写**的文件；改动越小越好。稍后你会被要求逐个输出它们的完整内容。',
  '3. 缺少依赖时通过 `manifestPatch.dependencies` 补充，**不要**在代码里写 try/except 掩盖 ImportError。',
  '4. 入口必须保持 `run(ctx)` 契约，不要改成其他函数名。',
  '5. 如果问题无法通过改代码解决（需要用户提供凭证、需要外部服务、仓库本身不可脚本化），'
    + '把 `files` 留空并在 `warnings` 里说清楚。',
  '6. 禁止删除 `autoforge.json`；禁止绝对路径与 `..`。'
].join('\n')

const REPAIR_FILE_SYSTEM_PROMPT = [
  '你是 Autoforge 脚本包代码修复器。用户会指定一个文件路径，你只需输出**该文件修复后的完整内容**。',
  '',
  '规则：',
  '',
  '1. 只输出文件内容本身：不要解释、不要用 Markdown 代码块包裹、不要输出 JSON。',
  '2. 输出的是**整个文件**，不是补丁片段。',
  '3. 如果这个文件是入口，必须遵守下面的运行契约，不要改回独立 CLI 或 CommonJS。',
  '4. 不要引入新的未声明依赖；需要新依赖时应在计划阶段就写进 manifestPatch。',
  '5. 不要写占位符、`TODO` 或省略号。',
  '',
  ENTRY_RUNTIME_CONTRACT
].join('\n')

const REPAIR_SYSTEM_PROMPT = [
  '你是 Autoforge 脚本包的调试与修复专家。脚本在运行时失败了，你需要根据失败日志与当前代码给出最小改动的修复方案。',
  '',
  'Autoforge 脚本包的结构：`autoforge.json`（清单）+ 入口文件。',
  'JavaScript 入口是 ESM，由主进程 import 后调用 `run(ctx)`。Python 在子进程调用 `run(ctx)`。',
  '`ctx.env` / `ctx.params` 都是字符串。常驻服务必须等待 `ctx.signal`，不能用 require 或 process.exit。',
  '',
  REPAIR_SKELETON_CONTRACT
].join('\n')

export function createScriptRepairer(deps: ScriptRepairDeps): ScriptRepairer {
  async function repair(input: ScriptRepairRunInput): Promise<ScriptRepairResult> {
    const scriptId = input.scriptId?.trim()
    if (!scriptId) throw new ConversionPlanError('缺少 scriptId')

    const { profile, apiKey } = deps.resolveProfile(input.profileId)
    if (!apiKey?.trim()) {
      throw new ConversionPlanError(`配置「${profile.name}」还没有填写 API Key`)
    }

    const context = deps.readContext(scriptId, Array.isArray(input.logs) ? input.logs : [])
    if (!context) throw new ConversionPlanError('脚本不存在或工作区已被删除')

    const emitProgress = input.onProgress
    const report = (progress: Omit<LlmConversionProgress, 'taskId'>): void => {
      emitProgress?.({ taskId: scriptId, ...progress })
    }
    const log = (level: LlmConversionLogLine['level'], message: string): void => {
      input.onLog?.({ taskId: scriptId, level, message })
    }

    const chat = async (
      messages: Array<{ role: 'system' | 'user'; content: string }>,
      json: boolean,
      label: string
    ): Promise<Awaited<ReturnType<typeof deps.client.chatStream>>> =>
      deps.client.chatStream({
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey,
        messages,
        temperature: profile.temperature,
        maxOutputTokens: profile.maxOutputTokens,
        idleTimeoutSeconds: profile.timeoutSeconds,
        extraHeaders: profile.extraHeaders,
        json,
        onDelta: createDeltaReporter(report, 'generating', label)
      })

    report({ phase: 'preparing', message: '正在整理失败上下文' })
    log('INFO', `脚本：${context.name} · 入口：${context.entry} · 模型：${profile.model}`)
    log('INFO', `上下文包含 ${context.files.length} 个文件、${context.logs.length} 行日志`)

    report({ phase: 'generating', message: '正在分析失败原因' })
    const skeletonResult = await chat(
      [
        { role: 'system', content: REPAIR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            '下面的 Autoforge 脚本运行失败了，请给出修复方案。**只输出修复计划，不要输出文件正文。**',
            input.instruction?.trim() ? `\n用户补充要求：${input.instruction.trim()}` : '',
            '',
            formatContext(context)
          ]
            .filter(Boolean)
            .join('\n')
        }
      ],
      true,
      '正在分析失败原因'
    )
    if (skeletonResult.finishReason === 'length') {
      throw new ConversionPlanError('生成修复计划时输出被截断，请调大「最大输出 tokens」后重试')
    }

    report({ phase: 'validating', message: '正在校验修复计划' })
    const plan = parseRepairPlanSkeleton(skeletonResult.content)
    log('INFO', `根因判断：${plan.diagnosis}`)
    log('INFO', `计划：重写 ${plan.files.length} 个文件，删除 ${plan.deleteFiles.length} 个文件`)
    for (const warning of plan.warnings ?? []) log('WARN', warning)

    const files: Array<{ path: string; content: string }> = []
    for (const [index, spec] of plan.files.entries()) {
      const label = `正在修复 ${spec.path}（${index + 1}/${plan.files.length}）`
      report({ phase: 'generating', message: label })
      const result = await chat(
        [
          { role: 'system', content: REPAIR_FILE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              `修复目标：${plan.summary}`,
              `根因：${plan.diagnosis}`,
              `现在输出修复后的文件：${spec.path}`,
              `改动原因：${spec.purpose}`,
              input.instruction?.trim() ? `用户补充要求：${input.instruction.trim()}` : '',
              '',
              formatContext(context)
            ]
              .filter(Boolean)
              .join('\n')
          }
        ],
        false,
        label
      )
      if (result.finishReason === 'length') {
        throw new ConversionPlanError(`修复 ${spec.path} 时输出被截断，请调大「最大输出 tokens」后重试`)
      }
      const content = parseFileContent(result.content, spec.path)
      files.push({ path: spec.path, content })
      log('INFO', `重写 ${spec.path}（${Buffer.byteLength(content, 'utf8')} 字节）`)
    }

    report({ phase: 'writing', message: '正在写回脚本工作区' })
    const outcome = deps.applyChanges(scriptId, {
      files,
      deleteFiles: plan.deleteFiles,
      manifestPatch: plan.manifestPatch
    })

    for (const path of outcome.deletedFiles) log('INFO', `删除 ${path}`)
    if (outcome.manifestUpdated) log('INFO', '已更新 autoforge.json')

    report({ phase: 'complete', message: '修复完成', percent: 100 })

    return {
      scriptId,
      summary: plan.summary,
      diagnosis: plan.diagnosis,
      changedFiles: outcome.changedFiles,
      deletedFiles: outcome.deletedFiles,
      manifestUpdated: outcome.manifestUpdated,
      notes: plan.notes
    }
  }

  return { repair }
}
