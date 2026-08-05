import type { AppEnv } from './app-env'
import type { EnvVarDefinition, ParamDefinition, ScriptIcon, ScriptManifest } from './script-contract'
import type { ScriptLanguage } from './script-language'
import type {
  EnvironmentProfile,
  ExecutionHistoryPage,
  LogLine,
  RunSession,
  ScriptFileContent,
  ScriptItem,
  ScriptWorkspaceFilesInfo
} from './types/script'
import type { McpErrorCode, McpTransportKind } from './mcp-control-protocol'

export interface ScriptListInput {
  query?: string
  status?: 'all' | 'running' | 'idle' | 'error'
  archived?: boolean
  offset?: number
  limit?: number
  sortBy?: 'name' | 'recentRun' | 'importedAt'
  sortOrder?: 'asc' | 'desc'
}

export interface ScriptListOutput {
  scripts: ScriptItem[]
  total: number
}

export interface ReadScriptFileInput {
  scriptId: string
  relativePath: string
  limit?: number
}

export interface CreateScriptFilePayload {
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export interface CreateScriptInput {
  manifest: ScriptManifest
  files: CreateScriptFilePayload[]
}

export interface WriteScriptFileInput {
  scriptId: string
  relativePath: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export interface UpdateScriptMetaInput {
  scriptId: string
  patch: {
    name?: string
    description?: string
    icon?: ScriptIcon
    category?: string
    categoryLabel?: string
    browser?: { headless?: boolean }
  }
}

export interface GetEnvironmentInput {
  envId: string
  scriptId?: string
}

export interface SanitizedEnvironment {
  id: string
  name: string
  description?: string
  variables: Record<string, string | { present: boolean }>
  variableKeys: string[]
  isDefault?: boolean
}

export interface SetScriptValuesInput {
  scriptId: string
  envId: string
  values: Record<string, string>
}

export interface StartScriptInput {
  scriptId: string
  envId?: string
  params?: Record<string, string>
  persistParams?: boolean
  browserOverride?: { headless?: boolean }
}

export interface LogCursorPage {
  lines: LogLine[]
  nextCursor: number
  gap: boolean
}

export interface McpStatus {
  enabled: boolean
  running: boolean
  appVersion: string
  appEnv: AppEnv
  transport?: McpTransportKind
  endpoint?: string
  connectionCount: number
  lastConnectionAt?: string
}

export interface McpClientConfig {
  command: string
  args: string[]
  appEnv: AppEnv
  displayCommand: string
}

export interface McpScriptSchema {
  env: EnvVarDefinition[]
  params: ParamDefinition[]
  language: ScriptLanguage
}

export interface McpSessionLogResult extends LogCursorPage {
  sessionId: string
}

export interface McpHistoryResult extends ExecutionHistoryPage {
  scriptId?: string
}

export interface McpAuditEntry {
  ts: string
  connectionId: string
  requestId: string
  operation: string
  target?: string
  confirmed: boolean
  outcome: 'success' | 'rejected' | 'error'
  errorCode?: McpErrorCode
}

export type {
  EnvironmentProfile,
  RunSession,
  ScriptFileContent,
  ScriptItem,
  ScriptWorkspaceFilesInfo
}
