/** Autoforge 脚本包规范 — autoforge.json 字段定义 */

import type { ScriptLanguage } from './script-language'
import { resolveScriptLanguage } from './script-language'

export const AUTOFORGE_MANIFEST_VERSION = '1.0'
export const MANIFEST_FILENAME = 'autoforge.json'
export const LEGACY_MANIFEST_FILENAME = 'scriptbox.json'

export type ScriptIcon =
  | 'globe'
  | 'download-cloud'
  | 'upload'
  | 'app-window'
  | 'monitor'
  | 'folder-sync'
  | 'cloud'
  | 'server'
  | 'database'
  | 'terminal'
  | 'code'
  | 'bot'
  | 'workflow'
  | 'zap'
  | 'cpu'
  | 'settings'
  | 'wrench'
  | 'mail'
  | 'send'
  | 'bell'
  | 'key-round'
  | 'shield'
  | 'lock'
  | 'search'
  | 'link'
  | 'clock'
  | 'calendar'
  | 'file-text'
  | 'table'
  | 'file-spreadsheet'
  | 'image'
  | 'camera'
  | 'bar-chart'
  | 'map'
  | 'home'
  | 'shopping-cart'
  | 'package'

export interface EnvVarDefinition {
  /** 环境变量名，合并后通过 ctx.env[key] 注入 */
  key: string
  /** UI 展示标签 */
  label: string
  description?: string
  /** 是否必填 */
  required?: boolean
  /** 是否为敏感值（密码/token），UI 中掩码显示；仅 text 类型有效 */
  secret?: boolean
  /**
   * 值类型，默认 text。语义与 params 一致，ctx.env[key] 始终为字符串。
   * - text/textarea/number：普通字符串
   * - select/radio：单选 value 字符串
   * - checkbox：JSON 数组字符串
   * - boolean："true" / "false"
   * - attachment：JSON 数组字符串（按环境分别缓存）
   */
  type?: ParamValueType
  /** select / radio / checkbox 的候选项 */
  options?: ParamOption[]
  /** 默认值（可被环境 Profile 覆盖） */
  default?: string
}

export type ParamValueType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'boolean'
  | 'attachment'

/** select / radio / checkbox 的候选项 */
export interface ParamOption {
  label: string
  value: string
}

/** 运行业务参数 schema — 与 env 区分：params 用于每次运行的业务输入，不绑定环境 Profile */
export interface ParamDefinition {
  key: string
  label: string
  description?: string
  required?: boolean
  secret?: boolean
  /**
   * 参数类型，默认 text。
   * - text/textarea/number：值为字符串
   * - select/radio：单选，值为选项 value 字符串
   * - checkbox：多选，值为 JSON 数组字符串
   * - boolean：开关，值为 "true" / "false"
   * - attachment：可多选的文件附件，值为 JSON 数组字符串
   */
  type?: ParamValueType
  /** select / radio / checkbox 的候选项 */
  options?: ParamOption[]
  /** 默认值（可被上次运行保存值覆盖） */
  default?: string
}

export interface ScriptManifest {
  /** 规范版本，当前固定 1.0 */
  autoforge: string
  name: string
  description?: string
  version?: string
  /** 入口文件，相对脚本包根目录，默认 index.mjs */
  entry?: string
  /** 脚本语言；未声明时根据 entry 扩展名推断 */
  language?: ScriptLanguage
  category?: string
  categoryLabel?: string
  icon?: ScriptIcon
  /** 脚本声明的环境变量 schema（固定环境配置，按 Profile 区分） */
  env?: EnvVarDefinition[]
  /** 脚本声明的运行业务参数 schema（每次运行可不同） */
  params?: ParamDefinition[]
  /** npm / pip 依赖（按 language 分流安装），运行前自动安装 */
  dependencies?: Record<string, string>
  /** 浏览器启动选项（使用 sdk.browser.launch 时生效） */
  browser?: {
    /** 无头模式，默认 false（显示浏览器窗口，便于手动验证码等） */
    headless?: boolean
  }
  /** 导出 ZIP 时补充无法通过静态依赖分析发现的运行资源 */
  export?: {
    include: string[]
  }
}

/** 脚本必须导出的 run 函数签名（TypeScript 侧描述，运行时 duck-type 校验） */
export interface ScriptRunContext {
  sessionId: string
  scriptId: string
  /** 合并后的环境变量（Profile + 脚本 env schema，固定环境配置） */
  env: Record<string, string>
  /** 本次运行的业务参数（与 env 分离，来自 params schema + 运行前填写） */
  params: Record<string, string>
  signal: AbortSignal
  log: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void
  /** 报告脚本自定义执行阶段（UI 终端 / 运行状态） */
  stage: (input: import('./script-progress').ScriptStageInput) => void
  /** 报告进度；scope=task 为当前子任务，scope=total 为整批总进度 */
  progress: (input: import('./script-progress').ScriptProgressInput) => void
  sdk: ScriptSdkShape
}

export interface ScriptSdkShape {
  browser: {
    launch: () => Promise<import('playwright-core').Browser>
  }
  paths: {
    userData: string
    scriptDir: string
  }
}

export type ScriptRunFn = (ctx: ScriptRunContext) => Promise<unknown>

/** 脚本入口函数名，按优先级依次解析 */
export const SCRIPT_ENTRY_FN_NAMES = ['run', 'main'] as const

export const SCRIPT_ENTRY_FN_ERROR =
  '脚本必须导出 run(ctx)、main(ctx) 或 default 函数'

/** 从脚本模块解析入口函数：run → main → default（仅 JS） */
export function resolveScriptEntryFn(module: Record<string, unknown>): ScriptRunFn | undefined {
  for (const name of SCRIPT_ENTRY_FN_NAMES) {
    const fn = module[name]
    if (typeof fn === 'function') return fn as ScriptRunFn
  }
  if (typeof module.default === 'function') return module.default as ScriptRunFn
  return undefined
}

export type {
  ScriptControlMessage,
  ScriptProgressInput,
  ScriptProgressScope,
  ScriptRunProgress,
  ScriptStageControl,
  ScriptStageInput,
  ScriptProgressControl
} from './script-progress'

export { SCRIPT_CONTROL_PREFIX, serializeScriptControl } from './script-progress'

/** 脚本执行生命周期阶段 */
export type ScriptLifecyclePhase =
  | 'queued'
  | 'validating'
  | 'installing-deps'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'stopped'

export interface ScriptLifecycleEvent {
  sessionId: string
  scriptId: string
  phase: ScriptLifecyclePhase
  message?: string
  ts: string
}

export const CATEGORY_DEFAULTS: Record<
  string,
  { label: string; color: string; iconColor: string; iconBg: string; iconBorder: string }
> = {
  browser: {
    label: '浏览器自动化',
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/15',
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    iconBorder: 'border-blue-500/20'
  },
  local: {
    label: '本地程序',
    color: 'bg-violet-500/10 text-violet-400 border border-violet-500/15',
    iconColor: 'text-violet-400',
    iconBg: 'bg-violet-500/10',
    iconBorder: 'border-violet-500/20'
  },
  scrape: {
    label: '网页抓取',
    color: 'bg-amber-500/10 text-amber-400 border-amber-500/15',
    iconColor: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
    iconBorder: 'border-amber-500/20'
  },
  file: {
    label: '文件操作',
    color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/15',
    iconColor: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    iconBorder: 'border-emerald-500/20'
  },
  system: {
    label: '系统工具',
    color: 'bg-rose-500/10 text-rose-400 border-rose-500/15',
    iconColor: 'text-rose-400',
    iconBg: 'bg-rose-500/10',
    iconBorder: 'border-rose-500/20'
  }
}

const PARAM_VALUE_TYPES: ReadonlySet<ParamValueType> = new Set([
  'text',
  'textarea',
  'number',
  'select',
  'radio',
  'checkbox',
  'boolean',
  'attachment'
])

function normalizeParamType(raw: unknown): ParamValueType {
  return typeof raw === 'string' && PARAM_VALUE_TYPES.has(raw as ParamValueType)
    ? (raw as ParamValueType)
    : 'text'
}

/** 选项支持字符串简写（["a","b"]）或 { label, value } 对象 */
function normalizeParamOptions(raw: unknown): ParamOption[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const options: ParamOption[] = []
  for (const item of raw) {
    if (typeof item === 'string' || typeof item === 'number') {
      const value = String(item)
      options.push({ label: value, value })
      continue
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      if (obj.value === undefined && obj.label === undefined) continue
      const value = String(obj.value ?? obj.label ?? '')
      const label = String(obj.label ?? obj.value ?? '')
      options.push({ label, value })
    }
  }
  return options.length ? options : undefined
}

/** 将清单中的 default 统一规范为字符串：布尔→"true"/"false"，数组→JSON，数字→字符串 */
function normalizeParamDefault(raw: unknown, type: ParamValueType): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (type === 'boolean') return raw === true || raw === 'true' ? 'true' : 'false'
  if (type === 'checkbox' || type === 'attachment') {
    if (Array.isArray(raw)) return JSON.stringify(raw.map((v) => String(v)))
    return typeof raw === 'string' ? raw : undefined
  }
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  return undefined
}

function normalizeSchemaField(item: Record<string, unknown>): EnvVarDefinition {
  const type = normalizeParamType(item.type)
  return {
    key: String(item.key ?? ''),
    label: String(item.label ?? item.key ?? ''),
    description: typeof item.description === 'string' ? item.description : undefined,
    required: item.required === true,
    secret: item.secret === true,
    type,
    options: normalizeParamOptions(item.options),
    default: normalizeParamDefault(item.default, type)
  }
}

export function normalizeAutoforgeManifestVersion(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') {
    return AUTOFORGE_MANIFEST_VERSION
  }
  if (raw === AUTOFORGE_MANIFEST_VERSION || raw === '1' || raw === 1) {
    return AUTOFORGE_MANIFEST_VERSION
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim()
    // 兼容 1.0 / 1.0.0 / 1.2 等所有 1.x 清单版本，写入时统一规范为 1.0
    if (/^1(\.\d+)*$/.test(normalized)) {
      return AUTOFORGE_MANIFEST_VERSION
    }
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 && raw < 2) {
    return AUTOFORGE_MANIFEST_VERSION
  }
  return null
}

export function validateManifest(raw: unknown): { ok: true; manifest: ScriptManifest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'autoforge.json 必须是 JSON 对象' }
  }
  const obj = raw as Record<string, unknown>
  const autoforgeVersion = normalizeAutoforgeManifestVersion(obj.autoforge ?? obj.scriptbox)
  if (!autoforgeVersion) {
    return { ok: false, error: `autoforge 版本必须为 "${AUTOFORGE_MANIFEST_VERSION}"` }
  }
  const nameStr =
    typeof obj.name === 'string' ? obj.name : obj.name != null ? String(obj.name) : ''
  if (!nameStr.trim()) {
    return { ok: false, error: 'name 为必填字符串' }
  }
  const entry = typeof obj.entry === 'string' ? obj.entry : 'index.mjs'
  const manifestLanguage =
    obj.language === 'python' || obj.language === 'javascript' ? obj.language : undefined
  const manifest: ScriptManifest = {
    autoforge: autoforgeVersion,
    name: nameStr.trim(),
    description: typeof obj.description === 'string' ? obj.description : undefined,
    version: typeof obj.version === 'string' ? obj.version : '1.0.0',
    entry,
    language: resolveScriptLanguage(manifestLanguage, entry),
    category: typeof obj.category === 'string' ? obj.category : 'local',
    categoryLabel: typeof obj.categoryLabel === 'string' ? obj.categoryLabel : undefined,
    icon: typeof obj.icon === 'string' ? (obj.icon as ScriptIcon) : 'app-window',
    env: Array.isArray(obj.env)
      ? (obj.env as Record<string, unknown>[]).map((item) => normalizeSchemaField(item))
      : [],
    params: Array.isArray(obj.params)
      ? (obj.params as Record<string, unknown>[]).map((item) => normalizeSchemaField(item))
      : [],
    dependencies:
      obj.dependencies && typeof obj.dependencies === 'object'
        ? (obj.dependencies as Record<string, string>)
        : undefined
  }
  if (obj.browser && typeof obj.browser === 'object') {
    const browser = obj.browser as Record<string, unknown>
    if (typeof browser.headless === 'boolean') {
      manifest.browser = { headless: browser.headless }
    }
  }
  if (obj.export && typeof obj.export === 'object') {
    const exportConfig = obj.export as Record<string, unknown>
    if (exportConfig.include !== undefined && !Array.isArray(exportConfig.include)) {
      return { ok: false, error: 'export.include 必须是字符串数组' }
    }
    if (Array.isArray(exportConfig.include)) {
      if (!exportConfig.include.every((item) => typeof item === 'string' && item.trim())) {
        return { ok: false, error: 'export.include 必须只包含非空字符串' }
      }
      manifest.export = { include: exportConfig.include.map((item) => String(item).trim()) }
    }
  }
  return { ok: true, manifest }
}
