import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { MIGRATION_001 } from '../migrations/001-initial'
import { MIGRATION_007 } from '../migrations/007-ai-workspace'
import { openSqliteDatabase } from '../sqlite-adapter'
import { AiWorkspaceRepository } from './ai-workspace-repository'

async function setup(t: { after(callback: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-ai-workspace-'))
  const data = join(root, 'data')
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot)
  const db = await openSqliteDatabase(join(data, 'test.db'))
  db.exec(MIGRATION_001)
  db.exec(MIGRATION_007)
  const repository = new AiWorkspaceRepository(db)
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { repository, projectRoot }
}

test('persists project metadata and conversation turns', async (t) => {
  const { repository, projectRoot } = await setup(t)
  const project = repository.createProject({
    id: 'project-1', name: 'Demo', rootPath: projectRoot, language: 'javascript', profileId: 'profile-1'
  })
  repository.appendTurn(project.id, {
    id: 'turn-1', role: 'user', content: 'Create a scraper', status: 'complete', createdAt: '2026-11-22T01:00:00Z'
  })

  assert.deepEqual(repository.getProject('project-1'), project)
  assert.equal(repository.listTurns('project-1')[0].content, 'Create a scraper')
})

test('rejects duplicate canonical project roots', async (t) => {
  const { repository, projectRoot } = await setup(t)
  repository.createProject({ id: 'project-1', name: 'One', rootPath: projectRoot, language: 'javascript', profileId: 'profile-1' })

  assert.throws(() => repository.createProject({
    id: 'project-2', name: 'Two', rootPath: join(projectRoot, '..', basename(projectRoot)), language: 'python', profileId: 'profile-1'
  }), /项目目录已存在/)
})

test('orders turns by creation time', async (t) => {
  const { repository, projectRoot } = await setup(t)
  repository.createProject({ id: 'project-1', name: 'Demo', rootPath: projectRoot, language: 'python', profileId: 'profile-1' })
  repository.appendTurn('project-1', { id: 'turn-later', role: 'assistant', content: 'second', status: 'complete', createdAt: '2026-11-22T02:00:00Z' })
  repository.appendTurn('project-1', { id: 'turn-earlier', role: 'user', content: 'first', status: 'complete', createdAt: '2026-11-22T01:00:00Z' })

  assert.deepEqual(repository.listTurns('project-1').map((turn) => turn.id), ['turn-earlier', 'turn-later'])
})

test('validates project status transitions', async (t) => {
  const { repository, projectRoot } = await setup(t)
  repository.createProject({ id: 'project-1', name: 'Demo', rootPath: projectRoot, language: 'javascript', profileId: 'profile-1' })

  assert.throws(() => repository.updateProject('project-1', { status: 'importing' }), /项目状态转换无效/)
  assert.equal(repository.updateProject('project-1', { status: 'generating' })?.status, 'generating')
})

test('resumes generation after a check phase so the agent can repair files', async (t) => {
  const { repository, projectRoot } = await setup(t)
  repository.createProject({ id: 'project-1', name: 'Demo', rootPath: projectRoot, language: 'javascript', profileId: 'profile-1' })
  repository.updateProject('project-1', { status: 'generating' })
  repository.updateProject('project-1', { status: 'applying' })
  repository.updateProject('project-1', { status: 'checking' })

  assert.equal(repository.updateProject('project-1', { status: 'generating' })?.status, 'generating')
})

test('allows a generated project to enter its validation phase', async (t) => {
  const { repository, projectRoot } = await setup(t)
  repository.createProject({ id: 'project-1', name: 'Demo', rootPath: projectRoot, language: 'javascript', profileId: 'profile-1' })
  repository.updateProject('project-1', { status: 'generating' })

  assert.equal(repository.updateProject('project-1', { status: 'checking' })?.status, 'checking')
})

test('removes project rows without deleting the selected folder', async (t) => {
  const { repository, projectRoot } = await setup(t)
  writeFileSync(join(projectRoot, 'keep.txt'), 'user data')
  repository.createProject({ id: 'project-1', name: 'Demo', rootPath: projectRoot, language: 'javascript', profileId: 'profile-1' })
  repository.appendTurn('project-1', { id: 'turn-1', role: 'user', content: 'hi', status: 'complete', createdAt: '2026-11-22T01:00:00Z' })

  assert.equal(repository.removeProject('project-1'), true)
  assert.equal(repository.getProject('project-1'), null)
  assert.deepEqual(repository.listTurns('project-1'), [])
  assert.equal(readFileSync(join(projectRoot, 'keep.txt'), 'utf8'), 'user data')
})
