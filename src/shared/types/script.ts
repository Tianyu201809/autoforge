import type { EnvVarDefinition, ParamDefinition, ScriptIcon, ScriptLifecyclePhase, ScriptRunProgress } from '../script-contract'
import type { ScriptLanguage } from '../script-language'

export type ScriptStatus = 'running' | 'idle' | 'error'
export type SessionStatus = 'running' | 'success' | 'error' | 'stopped'
export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface CronConfig {
  expression: string
  enabled: boolean
}

/** 脚本用户偏好 — 与 scripts 表分离存储 */
export interface ScriptPreference {
  starred?: boolean
  archived?: boolean
  recentRunAt?: string
  schedule?: CronConfig
  defaultEnvId?: string
  /** 脚本在各环境下的 env 专属配置值 */
  configByEnv?: Record<string, Record<string, string>>
  /** 脚本在各环境下上次保存的运行参数 */
  paramsByEnv?: Record<string, Record<string, string>>
  /** @deprecated 旧版全局参数，读取时会迁移到 paramsByEnv */
  savedParams?: Record<string, string>
  /** 多实例批量运行预设槽（最多 5） */
  instanceSlots?: ScriptInstanceSlot[]
}

/** 脚本多实例批量运行的一个预设槽 */
export interface ScriptInstanceSlot {
  id: string
  name: string
  envId: string
  /** 该实例的脚本专属 env 配置（对应详情「配置」），不写回 configByEnv */
  config: Record<string, string>
  params: Record<string, string>
  browser?: { headless?: boolean }
}

/** 环境 Profile — 一组可复用的环境变量 */
export interface EnvironmentProfile {
  id: string
  name: string
  description?: string
  /** key → value，覆盖脚本 env schema 中的同名变量 */
  variables: Record<string, string>
  isDefault?: boolean
}

export interface ScriptMeta {
  id: string
  /** Hub 分配的稳定脚本 ID；普通本地导入没有该字段 */
  hubScriptId?: string
  name: string
  description: string
  /** 脚本包在 userData/scripts/{id} 下的目录 */
  workspacePath: string
  category: string
  categoryLabel: string
  categoryColor: string
  icon: ScriptIcon
  iconColor: string
  iconBg: string
  iconBorder: string
  version: string
  /** 导入/上传到 Autoforge 的时间（ISO 8601） */
  importedAt?: string
  starred: boolean
  archived: boolean
  recentRunAt?: string
  schedule?: CronConfig
  /** 从 autoforge.json 读取的环境变量 schema（固定环境值） */
  envSchema: EnvVarDefinition[]
  /** 从 autoforge.json 读取的运行业务参数 schema */
  paramSchema: ParamDefinition[]
  /** 默认执行环境 Profile ID */
  defaultEnvId?: string
  /** 各环境下的脚本专属 env 配置：envId → { KEY: value } */
  configByEnv?: Record<string, Record<string, string>>
  /** 各环境下上次保存的运行参数：envId → { KEY: value } */
  paramsByEnv?: Record<string, Record<string, string>>
  /** @deprecated 旧版全局参数，读取时会迁移到 paramsByEnv */
  savedParams?: Record<string, string>
  /** manifest 中声明的 npm 依赖 */
  dependencies?: Record<string, string>
  /** 入口文件相对路径 */
  entry: string
  /** 脚本语言（JS / Python） */
  language: ScriptLanguage
  /** 浏览器启动选项（autoforge.json browser 字段） */
  browser?: {
    headless?: boolean
  }
  /** 多实例批量运行预设槽（最多 5） */
  instanceSlots?: ScriptInstanceSlot[]
}

export interface ScriptItem extends ScriptMeta {
  status: ScriptStatus
  meta: string
  errorMeta?: string
  activeSessionId?: string
  /** 当前 running 的 session 数量 */
  activeSessionCount: number
}

export interface RunSession {
  id: string
  scriptId: string
  status: SessionStatus
  /** 本次运行使用的环境 Profile */
  envId?: string
  /** 当前生命周期阶段（平台） */
  phase?: ScriptLifecyclePhase
  /** 脚本通过 stage/progress 上报的执行阶段与进度 */
  runProgress?: ScriptRunProgress
  pid?: number
  startedAt: string
  finishedAt?: string
  exitCode?: number
  result?: unknown
  /** 批量实例槽 id（若有） */
  instanceSlotId?: string
  /** 批量实例显示名（若有） */
  instanceName?: string
}

export interface LogLine {
  sessionId: string
  ts: string
  level: LogLevel
  message: string
}

export interface AppWindowConfig {
  /** 关闭主窗口时隐藏到系统托盘，后台继续运行 */
  trayMode?: boolean
  /** 显示桌面悬浮球（类似安全卫士悬浮球） */
  floatingMode?: boolean
  /** 悬浮球上次吸附位置 */
  floatingBallPosition?: { x: number; y: number }
  /** 是否启用全局快捷键唤起主界面 */
  globalShortcutEnabled?: boolean
  /** Electron Accelerator，默认 CommandOrControl+Shift+A */
  globalShortcut?: string
}

/** 小记条目 — 用户自填的快速填入片段，与全局环境变量无关 */
export interface ScratchpadEntry {
  id: string
  /** 显示标签，便于检索与识别 */
  label: string
  /** 点击后填入聚焦输入框的内容 */
  value: string
}

export interface PythonStatusInfo {
  found: boolean
  executable: string | null
  version: string | null
  minVersion: string
  error?: string
}

export interface AppConfig {
  /** AutoforgeHub 网站地址 */
  hub?: {
    url?: string
  }
  browser?: {
    executablePath?: string
  }
  /** 本机 Python 解释器（Python 脚本执行） */
  python?: {
    executablePath?: string
    minVersion?: string
    /** pip 镜像源，如 https://pypi.tuna.tsinghua.edu.cn/simple */
    pipIndexUrl?: string
  }
  /** 脚本运行超时（秒），0 表示不限制 */
  script?: {
    runTimeoutSeconds?: number
  }
  /** 外部代码编辑器，用于打开脚本工作区目录 */
  externalEditor?: {
    executablePath?: string
  }
  /** 全局脚本工作区根目录（默认 userData/scripts） */
  scriptsDirectory?: string
  logLevel?: LogLevel
  window?: AppWindowConfig
  /** 小记模块 — 独立于环境 Profile 的快速填入信息 */
  scratchpad?: ScratchpadEntry[]
}

export interface SystemMemoryInfo {
  workingSetSize: number
  peakWorkingSetSize: number
}

export interface DetectedBrowserInfo {
  id: string
  label: string
  path: string
}

export interface BrowserStatusInfo {
  bundled: boolean
  browsersPath: string
  executable: string | null
  installed: DetectedBrowserInfo[]
}

export interface ScriptStats {
  total: number
  running: number
  scheduled: number
  todayRuns: number
}

export type ExecutionTrigger = 'manual' | 'scheduled'

export interface ExecutionRecord {
  id: string
  scriptId: string
  scriptName: string
  status: SessionStatus
  envId?: string
  trigger: ExecutionTrigger
  startedAt: string
  finishedAt?: string
  exitCode?: number
  errorMessage?: string
  durationMs?: number
  /** 脚本返回的运行结果（持久化，供运行历史查看） */
  result?: unknown
}

export interface ExecutionDaySummary {
  date: string
  total: number
  success: number
  error: number
  stopped: number
  running: number
  records: ExecutionRecord[]
}

export interface ExecutionHistoryQuery {
  scriptId?: string
  scriptName?: string
  date?: string
  days?: number
  offset?: number
  limit?: number
  status?: SessionStatus | 'all'
  trigger?: ExecutionTrigger | 'all'
}

export interface ExecutionHistoryPage {
  records: ExecutionRecord[]
  total: number
  hasMore: boolean
}

export interface CategoryDefinition {
  id: string
  key: string
  label: string
  colorPreset: string
  /** 父分类 id；内置恒为 null；顶层自定义为 null */
  parentId: string | null
  builtIn?: boolean
  dotColor: string
  badgeColor: string
  iconColor: string
  iconBg: string
  iconBorder: string
}

export interface CategoryItem {
  id: string
  key: string
  name: string
  color: string
  count: number
  parentId: string | null
}

export type ScriptStatusFilter = 'all' | 'running' | 'idle' | 'error'
export type ScriptSortBy = 'name' | 'recentRun' | 'importedAt'
export type ScriptSortOrder = 'asc' | 'desc'

export interface ScriptListFilter {
  status: ScriptStatusFilter
  categoryKey: string | null
  starredOnly: boolean
  scheduledOnly: boolean
}

export interface NavItem {
  id: string
  label: string
  icon: 'layout-grid' | 'play-circle' | 'timer' | 'star' | 'clock' | 'archive'
  count?: number
  badge?: string
  active?: boolean
}

export type NavFilter = 'all' | 'running' | 'scheduled' | 'starred' | 'recent' | 'archived'

export interface ScriptContentInfo {
  entryPath: string
  content: string
  manifestPath: string
  manifestContent: string
}

export interface ScriptWorkspaceFilesInfo {
  entryPath: string
  manifestPath: string
  files: string[]
}

export interface ScriptExportResult {
  path: string
  fileName: string
  fileCount: number
  totalBytes: number
}

export interface ScriptExportPreview {
  fileCount: number
  totalBytes: number
  message: string
}

export interface ScriptFileContent {
  path: string
  content: string
  binary: boolean
  /** 文本为 utf8（可省略）；图片资源为 base64 */
  encoding?: 'utf8' | 'base64'
  /** 图片等资源的 MIME，如 image/png */
  mimeType?: string
}

export interface DependencyInstallResult {
  ok: boolean
  stdout: string
  stderr: string
}

export interface GlobalDependency {
  name: string
  version: string
}

export interface BundledExampleInfo {
  id: string
  name: string
  description: string
  version: string
  category: string
  categoryLabel: string
}

/** 开发指南 — autoforge-script-create Skill 元数据与正文 */
export interface DevGuideSkillCreateInfo {
  /** 展示用正文（已去掉 YAML frontmatter） */
  markdown: string
  /** 完整 SKILL.md 原文，供复制到 Cursor */
  raw: string
  name: string
  description: string
  path: string
}
