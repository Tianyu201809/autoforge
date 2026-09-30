/**
 * 仓库转脚本（Repo → Autoforge Script）共享类型。
 *
 * 该能力把 GitHub / Gitee 上的既有项目拉取到本机转换工作区，
 * 由 AI（外部 Agent 经 MCP，或应用内引擎）产出符合 Autoforge 脚本包规范的产物。
 */

export type RepoProvider = 'github' | 'gitee'

/** 拉取仓库使用的传输方式 */
export type RepoTransport = 'https' | 'ssh'

/** 实际采用的拉取手段 */
export type RepoFetchMethod = 'archive' | 'git'

/** 解析后的仓库定位信息 */
export interface RepoRef {
  provider: RepoProvider
  owner: string
  repo: string
  /** 分支 / 标签 / commit；为空表示由托管方默认分支决定 */
  ref?: string
  /** 规范化后的仓库主页地址（用于展示与溯源） */
  url: string
  /** 用户输入的地址形态 */
  transport: RepoTransport
  /** 供 git clone 使用的地址；SSH 输入时保留 SSH 形式 */
  cloneUrl: string
}

export type RepoConvertibilityLevel =
  /** 本身就是一个脚本，几乎可直接作为入口 */
  | 'direct'
  /** 库 / CLI，需要写适配入口包装调用 */
  | 'wrappable'
  /** 源码需要先构建（TS / 打包器），Autoforge 无 build 生命周期 */
  | 'needs-build'
  /** 形态不适合脚本化（长期运行的 Web 服务、纯原生程序等） */
  | 'unsupported'

export interface RepoProfileEntry {
  path: string
  bytes: number
}

export interface RepoLanguageStat {
  name: string
  files: number
  bytes: number
}

/** 供 AI 与用户共同审阅的结构化仓库画像 */
export interface RepoProfile {
  ref: RepoRef
  /** 实际下载到的分支 / 标签（由压缩包顶层目录名或 git 分支推断） */
  resolvedRef: string
  /** 实际使用的拉取手段 */
  fetchMethod: RepoFetchMethod
  /** 仓库快照的 commit SHA（git 拉取可得；归档拉取通常为 null） */
  commitSha: string | null
  rootDir: string
  fileCount: number
  totalBytes: number
  license: string | null
  readme: string | null
  languages: RepoLanguageStat[]
  /** 识别到的依赖清单文件（package.json / requirements.txt 等） */
  manifests: string[]
  /** 可能的入口文件候选（相对仓库根） */
  entryCandidates: string[]
  /** 运行期依赖名（npm 包名 / pip 包名） */
  runtimeDependencies: string[]
  hasBuildScript: boolean
  hasNativeBinary: boolean
  hasWebServer: boolean
  hasMonorepo: boolean
  convertibility: RepoConvertibilityLevel
  convertibilityReason: string
  risks: string[]
  topLevel: RepoProfileEntry[]
}

export type RepoConvertPhase =
  | 'validating'
  | 'downloading'
  | 'cloning'
  | 'extracting'
  | 'analyzing'
  | 'workspace-ready'
  | 'importing'
  | 'complete'
  | 'error'
  /** 应用内 LLM 引擎：正在准备上下文 */
  | 'llm-preparing'
  /** 应用内 LLM 引擎：正在执行构建命令 */
  | 'llm-building'
  /** 应用内 LLM 引擎：正在请求模型生成转换计划 */
  | 'llm-generating'
  /** 应用内 LLM 引擎：正在写入脚本包 */
  | 'llm-writing'
  /** 应用内 LLM 引擎：校验产物 */
  | 'llm-validating'

export interface RepoConvertProgress {
  taskId: string
  phase: RepoConvertPhase
  message: string
  percent?: number
  downloadedBytes?: number
  totalBytes?: number
  error?: string
}

export interface RepoFetchRequest {
  /** 仓库地址，支持 https 与 git@ 形式，可携带 /tree/<ref> 片段 */
  url: string
  /** 分支 / 标签；为空时使用默认分支 */
  ref?: string
  /** 私有仓库访问令牌，仅本次拉取使用，不写入数据库 */
  token?: string
}

/** 转换工作区状态，交给渲染进程与 Agent 共享 */
export interface RepoWorkspaceInfo {
  taskId: string
  profile: RepoProfile
  /** 转换工作区绝对路径 */
  workspacePath: string
  /** 原始仓库目录（只读参考） */
  repoPath: string
  /** 转换产物目录，Agent 需在此写入 autoforge.json */
  packageDir: string
  /** 可直接粘贴给 Agent 的交接提示词 */
  handoffPrompt: string
  /** 交接说明文档绝对路径 */
  handoffPath: string
  /** 产物目录中是否已存在可导入的脚本包 */
  packageReady: boolean
  createdAt: string
}

export interface RepoWorkspaceSummary {
  taskId: string
  provider: RepoProvider
  repo: string
  resolvedRef: string
  workspacePath: string
  packageReady: boolean
  createdAt: string
}

export const REPO_WORKSPACE_DIR_NAME = 'repo-workspaces'
export const REPO_META_DIR_NAME = '.autoforge'
export const REPO_PACKAGE_DIR_NAME = 'package'
export const REPO_SOURCE_DIR_NAME = 'repo'
export const REPO_HANDOFF_FILENAME = 'HANDOFF.md'
export const REPO_PROFILE_FILENAME = 'profile.json'

/** 产物目录中可被直接导入的包根候选 */
export const REPO_PACKAGE_RELATIVE_PATH = `${REPO_META_DIR_NAME}/${REPO_PACKAGE_DIR_NAME}`
