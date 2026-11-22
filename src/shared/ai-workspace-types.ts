export type AiProjectLanguage = 'javascript' | 'python'
export type AiProjectStatus =
  | 'ready'
  | 'generating'
  | 'applying'
  | 'checking'
  | 'importing'
  | 'blocked'
  | 'error'
  | 'interrupted'
export type AiProjectTurnRole = 'user' | 'assistant'
export type AiProjectTurnStatus = 'running' | 'complete' | 'cancelled' | 'error'

export interface AiProject {
  id: string
  name: string
  rootPath: string
  language: AiProjectLanguage
  profileId: string
  importedScriptId?: string
  status: AiProjectStatus
  createdAt: string
  updatedAt: string
}

export interface AiProjectTurn {
  id: string
  projectId: string
  role: AiProjectTurnRole
  content: string
  status: AiProjectTurnStatus
  changes?: unknown[]
  checks?: unknown[]
  importedScriptId?: string
  createdAt: string
}

export type AiProjectSummary = Pick<AiProject, 'id' | 'name' | 'rootPath' | 'language' | 'status' | 'updatedAt'>

export interface AiProjectCreateInput {
  id: string
  name: string
  rootPath: string
  language: AiProjectLanguage
  profileId: string
  importedScriptId?: string
}

export interface AiProjectTurnInput {
  id: string
  role: AiProjectTurnRole
  content: string
  status: AiProjectTurnStatus
  changes?: unknown[]
  checks?: unknown[]
  importedScriptId?: string
  createdAt: string
}

export interface ProjectRootInfo {
  canonicalPath: string
  writable: true
  empty: true
}

export interface ProjectFile {
  path: string
  sha256: string
  size: number
  kind: 'text' | 'binary'
}

export interface ProjectFileContent extends ProjectFile {
  content: string
}

export interface ProjectChange {
  path: string
  content: string
}

export interface ProjectChangeResult {
  applied: string[]
  conflicts: string[]
  rollbackFailed: string[]
}

export type AiAgentEvent =
  | { type: 'assistant_delta'; projectId: string; turnId: string; text: string }
  | { type: 'tool_started'; projectId: string; turnId: string; toolName: string }
  | { type: 'tool_finished'; projectId: string; turnId: string; toolName: string; result: string }
  | { type: 'file_changes'; projectId: string; turnId: string; changes: ProjectChangeResult }
  | { type: 'check_result'; projectId: string; turnId: string; check: unknown }
  | { type: 'import_result'; projectId: string; turnId: string; ok: boolean; scriptId?: string; message: string }
  | { type: 'turn_finished'; projectId: string; turnId: string; status: AiProjectTurnStatus }
