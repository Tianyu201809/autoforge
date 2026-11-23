import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope } from 'vue'
import type { AiAgentEvent, AiProject, AiProjectSummary, AiProjectTurn } from '../../../shared/ai-workspace-types'
import type { LlmProfileListResult, LlmProfileView } from '../../../shared/ai-types'
import { useAiProjectWorkspace } from './useAiProjectWorkspace'

function createHarness() {
  const root = 'C:/local/work'
  const profiles: LlmProfileView[] = [{
    id: 'profile-a', name: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
    timeoutSeconds: 60, extraHeaderNames: [], createdAt: 'now', updatedAt: 'now', hasApiKey: true, hasCredentials: true
  }]
  const project: AiProject = {
    id: 'project-a', name: 'Work project', rootPath: root, language: 'javascript', profileId: 'profile-a', status: 'ready',
    pinned: false, createdAt: 'now', updatedAt: 'now'
  }
  let currentProject = project
  const calls: Array<{ method: string; value?: unknown }> = []
  const listeners = new Set<(event: AiAgentEvent) => void>()
  let folder: string | null = root
  let projects: AiProjectSummary[] = []
  let removeResult = true
  const turn: AiProjectTurn = { id: 'turn-a', projectId: project.id, role: 'assistant', content: 'Done.', status: 'complete', checks: [], createdAt: 'now' }
  const api = {
    pickProjectFolder: async () => folder,
    listProjects: async () => projects,
    getProject: async (id: string) => id === project.id ? project : null,
    listProjectTurns: async () => [],
    createProject: async (input: Omit<AiProject, 'id' | 'status' | 'createdAt' | 'updatedAt'>) => {
      calls.push({ method: 'createProject', value: input })
      projects = [{ id: project.id, name: input.name, rootPath: input.rootPath, language: input.language, status: 'ready', updatedAt: 'now', pinned: false }]
      return project
    },
    removeProject: async (id: string) => {
      calls.push({ method: 'removeProject', value: id })
      if (removeResult) projects = []
      return removeResult
    },
    renameProject: async (id: string, name: string) => {
      calls.push({ method: 'renameProject', value: { id, name } })
      projects = projects.map((item) => item.id === id ? { ...item, name } : item)
      currentProject = { ...currentProject, name }
      return currentProject
    },
    setProjectPinned: async (id: string, pinned: boolean) => {
      calls.push({ method: 'setProjectPinned', value: { id, pinned } })
      projects = projects.map((item) => item.id === id ? { ...item, pinned } : item)
      currentProject = { ...currentProject, pinned }
      return currentProject
    },
    exportProjectTurns: async (id: string) => {
      calls.push({ method: 'exportProjectTurns', value: id })
      return 'C:/exports/project.json'
    },
    startTurn: async (id: string, message: string) => { calls.push({ method: 'startTurn', value: message }); return turn },
    cancelTurn: async (id: string) => { calls.push({ method: 'cancelTurn', value: id }); return true },
    retryChecks: async () => turn,
    onAgentEvent: (callback: (event: AiAgentEvent) => void) => { listeners.add(callback); return () => listeners.delete(callback) },
    listProfiles: async (): Promise<LlmProfileListResult> => ({ profiles, activeProfileId: 'profile-a', credentialPersistent: true }),
    listPresets: async () => [],
    emit: (event: AiAgentEvent) => listeners.forEach((listener) => listener(event)),
    setFolder: (value: string | null) => { folder = value },
    setRemoveResult: (value: boolean) => { removeResult = value }
  }
  return { api, calls, listeners, project, turn, setRemoveResult: api.setRemoveResult }
}

test('creates a project from the selected folder and restores the saved project', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(harness.api, () => 'project-new'))!
  await state.load()
  await state.createProject({ name: 'Work project', language: 'javascript', profileId: 'profile-a' })

  assert.equal(harness.calls[0]?.method, 'createProject')
  assert.equal(state.activeProject.value?.id, 'project-a')
  assert.equal(state.projects.value.length, 1)
  scope.stop()
})

test('updates an active turn from events and cancels it from the workspace', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(harness.api))!
  await state.load()
  await state.openProject('project-a')
  const sending = state.sendMessage('Build a script')
  harness.api.emit({ type: 'assistant_delta', projectId: 'project-a', turnId: 'turn-a', text: 'Working' })
  assert.equal(state.streamingText.value, 'Working')
  await state.cancelTurn()
  await sending
  assert.equal(harness.calls.some((call) => call.method === 'cancelTurn'), true)
  scope.stop()
})

test('explains when a running agent prevents project removal', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(harness.api))!
  await state.load()
  await state.createProject({ name: 'Work project', language: 'javascript', profileId: 'profile-a' })
  harness.setRemoveResult(false)

  await state.removeProject('project-a')

  assert.equal(state.activeProject.value?.id, 'project-a')
  assert.equal(state.error.value, '项目当前无法移除。请等待运行中的任务完成或取消任务后重试。')
  scope.stop()
})

test('renames, pins, and exports a project through workspace operations', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(harness.api))!
  await state.load()
  await state.createProject({ name: 'Work project', language: 'javascript', profileId: 'profile-a' })

  await state.renameProject('project-a', 'Renamed project')
  await state.setProjectPinned('project-a', true)
  const exportPath = await state.exportProjectTurns('project-a')

  assert.equal(state.activeProject.value?.name, 'Renamed project')
  assert.equal(state.projects.value[0]?.pinned, true)
  assert.equal(exportPath, 'C:/exports/project.json')
  assert.deepEqual(harness.calls.slice(-3).map((call) => call.method), ['renameProject', 'setProjectPinned', 'exportProjectTurns'])
  scope.stop()
})

test('collects file, check, and automatic import results for the inspector', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(harness.api))!
  await state.load()
  await state.openProject('project-a')
  harness.api.emit({ type: 'file_changes', projectId: 'project-a', turnId: 'turn-a', changes: { applied: ['index.mjs'], conflicts: [], rollbackFailed: [] } })
  harness.api.emit({ type: 'check_result', projectId: 'project-a', turnId: 'turn-a', check: { code: 'syntax_valid', status: 'passed' } })
  harness.api.emit({ type: 'import_result', projectId: 'project-a', turnId: 'turn-a', ok: true, scriptId: 'script-a', message: '已导入' })

  assert.deepEqual(state.fileChanges.value, ['index.mjs'])
  assert.equal(state.checkResults.value.length, 1)
  assert.equal(state.importResult.value?.scriptId, 'script-a')
  scope.stop()
})

test('unsubscribes the project event listener when its scope is disposed', () => {
  const harness = createHarness()
  const scope = effectScope()
  scope.run(() => useAiProjectWorkspace(harness.api))
  assert.equal(harness.listeners.size, 1)
  scope.stop()
  assert.equal(harness.listeners.size, 0)
})
