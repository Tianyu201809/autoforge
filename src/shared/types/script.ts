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
}

export interface ScriptItem extends ScriptMeta {
  status: ScriptStatus
  meta: string
  errorMeta?: string
  activeSessionId?: string
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

export interface AppConfig {
  browser?: {
    executablePath?: string
  }
  /** 全局脚本工作区根目录（默认 userData/scripts） */
  scriptsDirectory?: string
  logLevel?: LogLevel
  window?: AppWindowConfig
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
  date?: string
  days?: number
}

export interface CategoryDefinition {
  id: string
  key: string
  label: string
  colorPreset: string
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
}

export type ScriptStatusFilter = 'all' | 'running' | 'idle' | 'error'
export type ScriptSortBy = 'name' | 'recentRun'

export interface ScriptListFilter {
  status: ScriptStatusFilter
  categoryKey: string | null
  starredOnly: boolean
  scheduledOnly: boolean
}

export interface NavItem {
  id: string
  label: string
  icon: 'layout-grid' | 'play-circle' | 'star' | 'clock' | 'archive'
  count?: number
  badge?: string
  active?: boolean
}

export type NavFilter = 'all' | 'running' | 'starred' | 'recent' | 'archived'

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

export interface ScriptFileContent {
  path: string
  content: string
  binary: boolean
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
