import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  AiProject,
  AiProjectCreateInput,
  AiProjectStatus,
  AiProjectSummary,
  AiProjectTurn,
  AiProjectTurnInput,
  AiProjectTurnStatus
} from '../../../shared/ai-workspace-types'
import type { SqliteDatabase } from '../database'

interface AiProjectRow {
  id: string
  name: string
  root_path: string
  language: AiProject['language']
  profile_id: string
  imported_script_id: string | null
  pinned: number
  status: AiProjectStatus
  created_at: string
  updated_at: string
}

interface AiProjectTurnRow {
  id: string
  project_id: string
  role: AiProjectTurn['role']
  content: string
  status: AiProjectTurnStatus
  changes: string | null
  checks: string | null
  imported_script_id: string | null
  created_at: string
}

const PROJECT_TRANSITIONS: Record<AiProjectStatus, AiProjectStatus[]> = {
  ready: ['generating'],
  generating: ['applying', 'checking', 'ready', 'error', 'interrupted'],
  applying: ['checking', 'error', 'interrupted'],
  checking: ['applying', 'generating', 'importing', 'blocked', 'error', 'interrupted', 'ready'],
  importing: ['ready', 'blocked', 'error', 'interrupted'],
  blocked: ['generating', 'checking', 'interrupted'],
  error: ['generating', 'checking'],
  interrupted: ['generating']
}

const TURN_TRANSITIONS: Record<AiProjectTurnStatus, AiProjectTurnStatus[]> = {
  running: ['complete', 'cancelled', 'error'],
  complete: [],
  cancelled: [],
  error: []
}

function canonicalRoot(rootPath: string): string {
  try {
    return realpathSync.native(resolve(rootPath))
  } catch {
    throw new Error('项目目录不存在')
  }
}

function projectFromRow(row: AiProjectRow): AiProject {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    language: row.language,
    profileId: row.profile_id,
    importedScriptId: row.imported_script_id ?? undefined,
    pinned: row.pinned === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseJsonList(value: string | null): unknown[] | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function turnFromRow(row: AiProjectTurnRow): AiProjectTurn {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    content: row.content,
    status: row.status,
    changes: parseJsonList(row.changes),
    checks: parseJsonList(row.checks),
    importedScriptId: row.imported_script_id ?? undefined,
    createdAt: row.created_at
  }
}

export class AiWorkspaceRepository {
  constructor(private readonly db: SqliteDatabase, private readonly now = () => new Date().toISOString()) {}

  listProjects(): AiProject[] {
    const rows = this.db.prepare('SELECT * FROM ai_projects ORDER BY pinned DESC, updated_at DESC, id').all() as unknown as AiProjectRow[]
    return rows.map(projectFromRow)
  }

  listProjectSummaries(): AiProjectSummary[] {
    return this.listProjects().map(({ id, name, rootPath, language, status, updatedAt, pinned }) => ({
      id, name, rootPath, language, status, updatedAt, pinned
    }))
  }

  getProject(id: string): AiProject | null {
    const row = this.db.prepare('SELECT * FROM ai_projects WHERE id = ?').get(id) as AiProjectRow | undefined
    return row ? projectFromRow(row) : null
  }

  createProject(input: AiProjectCreateInput): AiProject {
    const rootPath = canonicalRoot(input.rootPath)
    const existing = this.db.prepare('SELECT id FROM ai_projects WHERE root_path = ?').get(rootPath)
    if (existing) throw new Error('项目目录已存在')
    const createdAt = this.now()
    this.db.prepare(`
      INSERT INTO ai_projects (
        id, name, root_path, language, profile_id, imported_script_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)
    `).run(input.id, input.name.trim(), rootPath, input.language, input.profileId, input.importedScriptId ?? null, createdAt, createdAt)
    return this.getProject(input.id)!
  }

  updateProject(id: string, patch: Partial<Pick<AiProject, 'name' | 'profileId' | 'importedScriptId' | 'status' | 'pinned'>>): AiProject | null {
    const current = this.getProject(id)
    if (!current) return null
    if (patch.status && patch.status !== current.status && !PROJECT_TRANSITIONS[current.status].includes(patch.status)) {
      throw new Error('项目状态转换无效')
    }
    const next = {
      name: patch.name?.trim() ?? current.name,
      profileId: patch.profileId ?? current.profileId,
      importedScriptId: patch.importedScriptId ?? current.importedScriptId ?? null,
      status: patch.status ?? current.status,
      pinned: patch.pinned ?? current.pinned,
      updatedAt: this.now()
    }
    this.db.prepare(`
      UPDATE ai_projects SET name = ?, profile_id = ?, imported_script_id = ?, status = ?, pinned = ?, updated_at = ?
      WHERE id = ?
    `).run(next.name, next.profileId, next.importedScriptId, next.status, next.pinned ? 1 : 0, next.updatedAt, id)
    return this.getProject(id)
  }

  setProjectPinned(id: string, pinned: boolean): AiProject | null {
    return this.updateProject(id, { pinned })
  }

  removeProject(id: string): boolean {
    return this.db.prepare('DELETE FROM ai_projects WHERE id = ?').run(id).changes > 0
  }

  listTurns(projectId: string): AiProjectTurn[] {
    const rows = this.db.prepare(`
      SELECT * FROM ai_project_turns WHERE project_id = ? ORDER BY created_at, id
    `).all(projectId) as unknown as AiProjectTurnRow[]
    return rows.map(turnFromRow)
  }

  appendTurn(projectId: string, turn: AiProjectTurnInput): AiProjectTurn {
    this.db.prepare(`
      INSERT INTO ai_project_turns (
        id, project_id, role, content, status, changes, checks, imported_script_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      turn.id,
      projectId,
      turn.role,
      turn.content,
      turn.status,
      turn.changes ? JSON.stringify(turn.changes) : null,
      turn.checks ? JSON.stringify(turn.checks) : null,
      turn.importedScriptId ?? null,
      turn.createdAt
    )
    const row = this.db.prepare('SELECT * FROM ai_project_turns WHERE id = ?').get(turn.id) as unknown as AiProjectTurnRow
    return turnFromRow(row)
  }

  updateTurn(
    projectId: string,
    turnId: string,
    patch: Partial<Pick<AiProjectTurn, 'content' | 'status' | 'changes' | 'checks' | 'importedScriptId'>>
  ): AiProjectTurn | null {
    const currentRow = this.db.prepare('SELECT * FROM ai_project_turns WHERE id = ? AND project_id = ?').get(turnId, projectId) as AiProjectTurnRow | undefined
    if (!currentRow) return null
    const current = turnFromRow(currentRow)
    if (patch.status && patch.status !== current.status && !TURN_TRANSITIONS[current.status].includes(patch.status)) {
      throw new Error('对话状态转换无效')
    }
    this.db.prepare(`
      UPDATE ai_project_turns SET content = ?, status = ?, changes = ?, checks = ?, imported_script_id = ?
      WHERE id = ? AND project_id = ?
    `).run(
      patch.content ?? current.content,
      patch.status ?? current.status,
      patch.changes === undefined ? currentRow.changes : JSON.stringify(patch.changes),
      patch.checks === undefined ? currentRow.checks : JSON.stringify(patch.checks),
      patch.importedScriptId ?? current.importedScriptId ?? null,
      turnId,
      projectId
    )
    const row = this.db.prepare('SELECT * FROM ai_project_turns WHERE id = ?').get(turnId) as unknown as AiProjectTurnRow
    return turnFromRow(row)
  }
}
