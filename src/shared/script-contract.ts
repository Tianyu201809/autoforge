/** Autoforge 脚本包规范 — autoforge.json 字段定义 */

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
  /** 是否为敏感值（密码/token），UI 中掩码显示 */
  secret?: boolean
  /** 默认值（可被环境 Profile 覆盖） */
  default?: string
}

export type ParamValueType = 'text' | 'attachment'

/** 运行业务参数 schema — 与 env 区分：params 用于每次运行的业务输入，不绑定环境 Profile */
export interface ParamDefinition {
  key: string
  label: string
  description?: string
  required?: boolean
  secret?: boolean
  /** 参数类型，默认 text；attachment 为可多选的文件附件，值为 JSON 数组 */
  type?: ParamValueType
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
  category?: string
  categoryLabel?: string
  icon?: ScriptIcon
  /** 脚本声明的环境变量 schema（固定环境配置，按 Profile 区分） */
  env?: EnvVarDefinition[]
  /** 脚本声明的运行业务参数 schema（每次运行可不同） */
  params?: ParamDefinition[]
  /** npm 依赖，会在脚本目录执行 npm install */
  dependencies?: Record<string, string>
  /** 浏览器启动选项（使用 sdk.browser.launch 时生效） */
  browser?: {
    /** 无头模式，默认 false（显示浏览器窗口，便于手动验证码等） */
    headless?: boolean
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

export function validateManifest(raw: unknown): { ok: true; manifest: ScriptManifest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'autoforge.json 必须是 JSON 对象' }
  }
  const obj = raw as Record<string, unknown>
  const version = obj.autoforge ?? obj.scriptbox
  if (version !== AUTOFORGE_MANIFEST_VERSION) {
    return { ok: false, error: `autoforge 版本必须为 "${AUTOFORGE_MANIFEST_VERSION}"` }
  }
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    return { ok: false, error: 'name 为必填字符串' }
  }
  const manifest: ScriptManifest = {
    autoforge: AUTOFORGE_MANIFEST_VERSION,
    name: obj.name.trim(),
    description: typeof obj.description === 'string' ? obj.description : undefined,
    version: typeof obj.version === 'string' ? obj.version : '1.0.0',
    entry: typeof obj.entry === 'string' ? obj.entry : 'index.mjs',
    category: typeof obj.category === 'string' ? obj.category : 'local',
    categoryLabel: typeof obj.categoryLabel === 'string' ? obj.categoryLabel : undefined,
    icon: typeof obj.icon === 'string' ? (obj.icon as ScriptIcon) : 'app-window',
    env: Array.isArray(obj.env) ? (obj.env as EnvVarDefinition[]) : [],
    params: Array.isArray(obj.params)
      ? (obj.params as Record<string, unknown>[]).map((item) => ({
          key: String(item.key ?? ''),
          label: String(item.label ?? item.key ?? ''),
          description: typeof item.description === 'string' ? item.description : undefined,
          required: item.required === true,
          secret: item.secret === true,
          type: item.type === 'attachment' ? ('attachment' as const) : ('text' as const),
          default: typeof item.default === 'string' ? item.default : undefined
        }))
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
  return { ok: true, manifest }
}
