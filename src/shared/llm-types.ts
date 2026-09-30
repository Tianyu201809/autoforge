/**
 * 应用内 LLM 转换引擎的共享类型。
 *
 * 设计要点：
 * - API Key 不进入 AppConfig / SQLite，而是按 profileId 存入独立凭据存储（safeStorage 加密）
 * - 模型输出被约束为结构化 ConversionPlan，由主进程校验并写盘，不让模型直接写文件
 */

export type LlmProviderKind = 'openai-compatible'

/** 持久化在 AppConfig 中的 LLM 配置（不含任何密钥） */
export interface LlmProfile {
  id: string
  /** 显示名，例如「DeepSeek 生产」 */
  name: string
  kind: LlmProviderKind
  /** OpenAI 兼容接口基础地址，例如 https://api.deepseek.com/v1 */
  baseUrl: string
  /** 模型名，例如 deepseek-chat */
  model: string
  temperature?: number
  maxOutputTokens?: number
  /** 单次请求超时（秒） */
  timeoutSeconds?: number
  /** 额外请求头（JSON 对象字符串），用于自建网关 */
  extraHeaders?: string
  createdAt: string
  updatedAt: string
}

/** 返回给渲染进程的视图对象，附带密钥存在性（不回显密钥） */
export interface LlmProfileView extends LlmProfile {
  hasApiKey: boolean
}

export interface LlmProfileListResult {
  profiles: LlmProfileView[]
  activeProfileId: string | null
  /** 凭据是否可持久化加密；false 表示仅存内存，重启后需重填 */
  credentialPersistent: boolean
  /** 是否允许在转换工作区执行依赖安装与构建命令 */
  allowBuild: boolean
}

export interface LlmTestResult {
  ok: boolean
  /** 成功时返回模型回显的简短内容 */
  message: string
  /** 往返耗时（毫秒） */
  latencyMs?: number
  /** 模型返回的可用模型数（若接口支持） */
  modelCount?: number
}

export interface LlmUpsertProfileInput {
  profile: Omit<LlmProfile, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }
  /** 传入则更新密钥；传空字符串表示清除密钥；不传表示保持不变 */
  apiKey?: string
}

/** 模型产出的转换计划（经 JSON Schema 约束与主进程校验） */
export interface ConversionPlanFile {
  /** 相对脚本包目录的路径 */
  path: string
  content: string
}

/** 从仓库原样复制的文件或目录（构建产物由此进入脚本包） */
export interface ConversionPlanCopy {
  /** 仓库内的相对路径（文件或目录） */
  from: string
  /** 脚本包内的相对路径 */
  to: string
}

export interface ConversionPlanEnvVar {
  key: string
  label: string
  description?: string
  type?: string
  default?: string
  secret?: boolean
  options?: Array<{ label: string; value: string }>
}

/** 阶段一：计划骨架中的文件条目（不含正文） */
export interface PlanFileSpec {
  /** 相对脚本包目录的路径 */
  path: string
  /** 这个文件的作用 */
  purpose: string
  /** generate：由模型生成正文；copy：从仓库原样复制 */
  source: 'generate' | 'copy'
  /** source 为 copy 时，仓库内的相对路径 */
  copyFrom?: string
}

/** 阶段一：模型只输出计划骨架，不含代码正文，因此体积小、不易截断 */
export interface ConversionPlanSkeleton {
  summary: string
  language: 'javascript' | 'python'
  entry: string
  name: string
  description?: string
  category?: string
  icon?: string
  dependencies: Record<string, string>
  env: ConversionPlanEnvVar[]
  params: ConversionPlanEnvVar[]
  files: PlanFileSpec[]
  buildCommands: string[]
  notes?: string
  warnings?: string[]
}

export interface ConversionPlan {
  /** 一句话说明这次转换做了什么 */
  summary: string
  /** 目标语言；executable 不可由模型产出 */
  language: 'javascript' | 'python'
  /** 入口文件（相对脚本包目录） */
  entry: string
  name: string
  description?: string
  category?: string
  icon?: string
  /** npm 或 pip 运行期依赖 */
  dependencies: Record<string, string>
  env: ConversionPlanEnvVar[]
  params: ConversionPlanEnvVar[]
  /** 由模型生成正文的文件（含入口与适配代码） */
  files: ConversionPlanFile[]
  /** 从仓库原样复制的文件或目录 */
  copies: ConversionPlanCopy[]
  /** 需要在 repo/ 中先执行的构建命令（需用户授权） */
  buildCommands: string[]
  /** 模型给出的转换说明与遗留问题 */
  notes?: string
  warnings?: string[]
}

/** 校验后的转换结果 */
export interface LlmConversionResult {
  taskId: string
  plan: ConversionPlan
  /** 实际写入的文件数（含生成的与复制的） */
  writtenFiles: number
  /** 从仓库复制的条目数 */
  copiedEntries: number
  /** 实际执行的构建命令（未授权时为空） */
  executedBuildCommands: string[]
  /** 是否已可导入 */
  packageReady: boolean
}

export type LlmConversionPhase =
  | 'preparing'
  | 'building'
  | 'generating'
  | 'writing'
  | 'validating'
  | 'complete'
  | 'error'

export interface LlmConversionProgress {
  taskId: string
  phase: LlmConversionPhase
  message: string
  percent?: number
  error?: string
}

export interface LlmConversionLogLine {
  taskId: string
  level: 'INFO' | 'WARN' | 'ERROR'
  message: string
}

export interface LlmConvertRequest {
  taskId: string
  /** 指定使用的配置；缺省时使用默认配置 */
  profileId?: string
  /** 本次是否授权执行构建命令（还需全局 allowBuild 开启） */
  allowBuild?: boolean
  /** 用户对计划的补充要求 */
  instruction?: string
}

// ---------------------------------------------------------------------------
// 导入后的修复回路
// ---------------------------------------------------------------------------

/** 交给模型修复时提供的脚本上下文（由主进程收集） */
export interface ScriptRepairContext {
  scriptId: string
  name: string
  entry: string
  language: string
  /** 当前清单原文 */
  manifestText: string
  /** 工作区内的文本文件（已按上限裁剪） */
  files: Array<{ path: string; content: string }>
  /** 最近几次执行记录 */
  recentRuns: Array<{
    status: string
    startedAt: string
    exitCode?: number
    errorMessage?: string
  }>
  /** 失败会话的日志行（渲染进程提供，主进程不持久化日志） */
  logs: string[]
}

/** 阶段一：修复计划骨架 */
export interface RepairPlanFileSpec {
  path: string
  purpose: string
}

export interface RepairManifestPatch {
  dependencies?: Record<string, string>
  entry?: string
  env?: ConversionPlanEnvVar[]
  params?: ConversionPlanEnvVar[]
  browser?: { headless?: boolean }
}

export interface RepairPlanSkeleton {
  /** 一句话说明这次改了什么 */
  summary: string
  /** 对失败原因的判断 */
  diagnosis: string
  /** 需要重写内容的文件 */
  files: RepairPlanFileSpec[]
  /** 需要删除的文件 */
  deleteFiles: string[]
  /** 需要更新的清单字段 */
  manifestPatch?: RepairManifestPatch
  notes?: string
  warnings?: string[]
}

export interface ScriptRepairRequest {
  scriptId: string
  /** 指定使用的配置；缺省时使用默认配置 */
  profileId?: string
  /** 用户的补充要求，例如「换成用 requests 库」 */
  instruction?: string
  /** 失败会话的日志行 */
  logs?: string[]
}

export interface ScriptRepairResult {
  scriptId: string
  summary: string
  diagnosis: string
  /** 被重写的文件 */
  changedFiles: string[]
  /** 被删除的文件 */
  deletedFiles: string[]
  /** 清单是否被更新 */
  manifestUpdated: boolean
  notes?: string
}

export const MAX_REPAIR_FILES = 20
export const MAX_REPAIR_CONTEXT_FILE_BYTES = 24_000
export const MAX_REPAIR_CONTEXT_TOTAL_BYTES = 120_000
export const MAX_REPAIR_LOG_LINES = 200

export const DEFAULT_LLM_TIMEOUT_SECONDS = 180
export const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 8_000
export const MAX_PLAN_FILES = 60
export const MAX_PLAN_FILE_BYTES = 512 * 1024
export const MAX_PLAN_TOTAL_BYTES = 4 * 1024 * 1024
/** 复制条数上限（一条目录复制可包含多个文件） */
export const MAX_PLAN_COPIES = 20
/** 复制进脚本包的总字节上限 */
export const MAX_COPY_TOTAL_BYTES = 50 * 1024 * 1024
/** 复制进脚本包的文件数上限 */
export const MAX_COPY_FILES = 2_000
