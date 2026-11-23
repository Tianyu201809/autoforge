import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { LlmProviderAdapter, LlmRequest } from './provider-contract'
import type { LlmStreamEvent } from '../../../shared/ai-types'
import type { AiProject, AiProjectTurn } from '../../../shared/ai-workspace-types'
import { createProjectWorkspace } from './project-workspace'
import { createAgentService } from './agent-service'
import type { AgentServiceOptions } from './agent-service'

function createHarness(
  stream: (request: LlmRequest, call: number) => AsyncIterable<LlmStreamEvent>,
  overrides: Partial<AgentServiceOptions> = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-agent-'))
  const projects = new Map<string, AiProject>()
  const turns = new Map<string, AiProjectTurn[]>()
  let nextId = 0
  const repository = {
    createProject(input: { id: string; name: string; rootPath: string; language: AiProject['language']; profileId: string }) {
      const now = '2026-11-22T00:00:00.000Z'
      const project: AiProject = { ...input, pinned: false, status: 'ready', createdAt: now, updatedAt: now }
      projects.set(project.id, project)
      turns.set(project.id, [])
      return project
    },
    listProjects: () => [...projects.values()],
    listProjectSummaries: () => [...projects.values()].map(({ id, name, rootPath, language, status, updatedAt }) => ({ id, name, rootPath, language, status, updatedAt })),
    getProject: (id: string) => projects.get(id) ?? null,
    updateProject(id: string, patch: Partial<AiProject>) {
      const project = projects.get(id)
      if (!project) return null
      const next = { ...project, ...patch, updatedAt: '2026-11-22T00:01:00.000Z' }
      projects.set(id, next)
      return next
    },
    removeProject: (id: string) => projects.delete(id),
    listTurns: (id: string) => turns.get(id) ?? [],
    appendTurn(id: string, turn: Omit<AiProjectTurn, 'projectId'>) {
      const saved = { ...turn, projectId: id }
      turns.get(id)?.push(saved)
      return saved
    },
    updateTurn(projectId: string, turnId: string, patch: Partial<AiProjectTurn>) {
      const list = turns.get(projectId) ?? []
      const index = list.findIndex((turn) => turn.id === turnId)
      if (index < 0) return null
      list[index] = { ...list[index], ...patch }
      return list[index]
    }
  }
  const calls: LlmRequest[] = []
  const adapter: LlmProviderAdapter = {
    stream: async function* (request) {
      calls.push(request)
      yield* stream(request, calls.length)
    }
  }
  const imported: string[] = []
  const baseOptions: AgentServiceOptions = {
    repository,
    profiles: {
      resolveProvider: () => ({
        profile: {
          id: 'profile-1', name: 'Test', provider: 'openai', baseUrl: 'https://api.example.test/v1', model: 'test',
          timeoutSeconds: 60, extraHeaderNames: [], createdAt: '2026-11-22', updatedAt: '2026-11-22'
        },
        credentials: { apiKey: 'secret', extraHeaders: {} },
        adapter
      })
    },
    workspace: createProjectWorkspace((id) => projects.get(id)?.rootPath ?? null),
    checks: {
      checkScriptPackage: async () => ({ status: 'passed' as const, code: 'package_valid', message: 'ok', diagnostics: [] }),
      checkScriptSyntax: async () => ({ status: 'passed' as const, code: 'syntax_valid', message: 'ok', diagnostics: [] })
    },
    registry: {
      importFromPath: () => {
        imported.push('new-script')
        return { id: 'new-script', name: 'Demo' }
      },
      updateFromProject: () => {
        imported.push('existing-script')
        return { id: 'existing-script', name: 'Demo' }
      },
      getById: () => undefined
    },
    idFactory: () => `id-${++nextId}`,
    now: () => '2026-11-22T00:00:00.000Z'
  }
  const serviceOptions: AgentServiceOptions = { ...baseOptions, ...overrides }
  const service = createAgentService(serviceOptions)
  return { root, service, serviceOptions, projects, turns, calls, imported }
}

function writeTool(changes: Array<{ path: string; content: string }>, expectedHashes: Record<string, string | null>): LlmStreamEvent[] {
  return [
    {
      type: 'tool_call',
      call: { id: 'call-1', name: 'write_project_files', argumentsJson: JSON.stringify({ changes, expectedHashes }) }
    },
    { type: 'complete', finishReason: 'tool_calls' }
  ]
}

test('runs a multi-step tool loop and automatically imports after both checks pass', async (t) => {
  const manifest = JSON.stringify({ autoforge: '1.0', name: 'Demo', entry: 'index.mjs', language: 'javascript' }, null, 2)
  const { root, service, projects, calls, imported } = createHarness((_request, call) => (async function* () {
    if (call === 1) yield* writeTool([
      { path: 'autoforge.json', content: manifest },
      { path: 'index.mjs', content: 'export function run() {}' }
    ], { 'autoforge.json': null, 'index.mjs': null })
    else {
      yield { type: 'text_delta', text: '脚本已生成。' }
      yield { type: 'complete', finishReason: 'stop' }
    }
  })())
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = await service.createProject({ rootPath: root, name: 'Demo', language: 'javascript', profileId: 'profile-1' })

  const turn = await service.startTurn(project.id, '创建一个脚本')
  assert.equal(calls.length, 2)
  assert.equal(imported[0], 'new-script')
  assert.equal(projects.get(project.id)?.importedScriptId, 'new-script')
  assert.equal(turn.status, 'complete')
})

test('lists saved project turns so a selected project can restore its conversation', async (t) => {
  const { root, service, serviceOptions } = createHarness(async function* () {})
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = await service.createProject({ rootPath: root, name: 'Demo', language: 'javascript', profileId: 'profile-1' })
  serviceOptions.repository.appendTurn(project.id, {
    id: 'turn-1', role: 'user', content: 'saved prompt', status: 'complete', createdAt: '2026-11-22T00:00:00.000Z'
  })

  assert.equal(service.listTurns(project.id)[0]?.content, 'saved prompt')
})

test('creates a project in a writable folder that already contains files', async (t) => {
  const { root, service } = createHarness(async function* () {})
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'README.md'), 'Existing project notes')

  const project = await service.createProject({ rootPath: root, name: 'Existing project', language: 'javascript', profileId: 'profile-1' })

  assert.equal(project.rootPath, realpathSync.native(root))
  assert.equal(project.name, 'Existing project')
})

test('renames a project and changes its pinned state through the project service', async (t) => {
  const { root, service } = createHarness(async function* () {})
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = await service.createProject({ rootPath: root, name: 'Before', language: 'javascript', profileId: 'profile-1' })

  const renamed = service.renameProject(project.id, 'After')
  const pinned = service.setProjectPinned(project.id, true)

  assert.equal(renamed?.name, 'After')
  assert.equal(pinned?.pinned, true)
})

test('repairs a failed syntax check before importing', async (t) => {
  const manifest = JSON.stringify({ autoforge: '1.0', name: 'Demo', entry: 'index.mjs', language: 'javascript' }, null, 2)
  let syntaxChecks = 0
  const source = 'export function {'
  const badHash = createHash('sha256').update(source).digest('hex')
  const { root, service, calls, imported } = createHarness((_request, call) => (async function* () {
    if (call === 1) yield* writeTool([
      { path: 'autoforge.json', content: manifest },
      { path: 'index.mjs', content: source }
    ], { 'autoforge.json': null, 'index.mjs': null })
    else if (call === 3) yield* writeTool([{ path: 'index.mjs', content: 'export function run() {}' }], { 'index.mjs': badHash })
    else yield { type: 'complete', finishReason: 'stop' }
  })(), {
    checks: {
      checkScriptPackage: async () => ({ status: 'passed' as const, code: 'package_valid', message: 'ok', diagnostics: [] }),
      checkScriptSyntax: async () => ++syntaxChecks === 1
        ? { status: 'failed' as const, code: 'javascript_syntax', message: 'bad syntax', diagnostics: ['SyntaxError at line 1'] }
        : { status: 'passed' as const, code: 'syntax_valid', message: 'ok', diagnostics: [] }
    }
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = await service.createProject({ rootPath: root, name: 'Demo', language: 'javascript', profileId: 'profile-1' })

  const turn = await service.startTurn(project.id, '修复语法')
  assert.equal(calls.length, 4)
  assert.equal(syntaxChecks, 2)
  assert.equal(imported[0], 'new-script')
  assert.equal(turn.status, 'complete')
})

test('allows only one running turn for a project and cancels before import', async (t) => {
  let entered!: () => void
  const providerEntered = new Promise<void>((resolve) => { entered = resolve })
  const { root, service, imported } = createHarness((request) => (async function* () {
    entered()
    await new Promise<void>((resolve) => request.signal?.addEventListener('abort', () => resolve(), { once: true }))
    yield { type: 'complete', finishReason: 'stop' }
  })())
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = await service.createProject({ rootPath: root, name: 'Demo', language: 'javascript', profileId: 'profile-1' })

  const firstTurn = service.startTurn(project.id, '等待')
  await providerEntered
  await assert.rejects(() => service.startTurn(project.id, '第二轮'), /已有正在运行的任务/)
  assert.equal(service.cancelTurn(project.id), true)
  assert.equal((await firstTurn).status, 'cancelled')
  assert.deepEqual(imported, [])
})

test('cancels after validation and does not begin the import phase', async (t) => {
  const manifest = JSON.stringify({ autoforge: '1.0', name: 'Demo', entry: 'index.mjs', language: 'javascript' }, null, 2)
  let syntaxChecks = 0
  const harness = createHarness((_request, call) => (async function* () {
    if (call === 1) yield* writeTool([
      { path: 'autoforge.json', content: manifest },
      { path: 'index.mjs', content: 'export function run() {}' }
    ], { 'autoforge.json': null, 'index.mjs': null })
    else yield { type: 'complete', finishReason: 'stop' }
  })(), {
    checks: {
      checkScriptPackage: async () => ({ status: 'passed' as const, code: 'package_valid', message: 'ok', diagnostics: [] }),
      checkScriptSyntax: async () => {
        syntaxChecks += 1
        return { status: 'passed' as const, code: 'syntax_valid', message: 'ok', diagnostics: [] }
      }
    }
  })
  const { root, imported, service } = harness
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = await service.createProject({ rootPath: root, name: 'Demo', language: 'javascript', profileId: 'profile-1' })

  const turn = await service.startTurn(project.id, '创建脚本', (event) => {
    if (event.type === 'check_result' && (event.check as { code?: string }).code === 'package_valid') {
      service.cancelTurn(project.id)
    }
  })
  assert.equal(turn.status, 'cancelled')
  assert.equal(syntaxChecks, 0)
  assert.deepEqual(imported, [])
})

test('recovers running turns as interrupted after service restart', (t) => {
  const { root, serviceOptions, turns, projects } = createHarness(async function* () { yield { type: 'complete' } })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const now = '2026-11-22T00:00:00.000Z'
  const project: AiProject = {
    id: 'recover', name: 'Recovery', rootPath: root, language: 'javascript', profileId: 'profile-1',
    pinned: false, status: 'generating', createdAt: now, updatedAt: now
  }
  projects.set(project.id, project)
  turns.set(project.id, [{ id: 'turn-running', projectId: project.id, role: 'assistant', content: '', status: 'running', createdAt: now }])

  createAgentService(serviceOptions)
  assert.equal(turns.get(project.id)?.[0].status, 'error')
  assert.equal(projects.get(project.id)?.status, 'interrupted')
})
