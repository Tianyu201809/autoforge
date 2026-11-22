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
