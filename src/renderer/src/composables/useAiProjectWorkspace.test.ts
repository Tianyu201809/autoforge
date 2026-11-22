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
    createdAt: 'now', updatedAt: 'now'
  }
  const calls: Array<{ method: string; value?: unknown }> = []
  const listeners = new Set<(event: AiAgentEvent) => void>()
  let folder: string | null = root
  let projects: AiProjectSummary[] = []
  const turn: AiProjectTurn = { id: 'turn-a', projectId: project.id, role: 'assistant', content: 'Done.', status: 'complete', checks: [], createdAt: 'now' }
  const api = {
    pickProjectFolder: async () => folder,
    listProjects: async () => projects,
    getProject: async (id: string) => id === project.id ? project : null,
    listProjectTurns: async () => [],
    createProject: async (input: Omit<AiProject, 'id' | 'status' | 'createdAt' | 'updatedAt'>) => {
      calls.push({ method: 'createProject', value: input })
      projects = [{ id: project.id, name: input.name, rootPath: input.rootPath, language: input.language, status: 'ready', updatedAt: 'now' }]
      return project
    },
    removeProject: async (id: string) => { calls.push({ method: 'removeProject', value: id }); projects = []; return true },
    startTurn: async (id: string, message: string) => { calls.push({ method: 'startTurn', value: message }); return turn },
    cancelTurn: async (id: string) => { calls.push({ method: 'cancelTurn', value: id }); return true },
    retryChecks: async () => turn,
    onAgentEvent: (callback: (event: AiAgentEvent) => void) => { listeners.add(callback); return () => listeners.delete(callback) },
    listProfiles: async (): Promise<LlmProfileListResult> => ({ profiles, activeProfileId: 'profile-a', credentialPersistent: true }),
    listPresets: async () => [],
    emit: (event: AiAgentEvent) => listeners.forEach((listener) => listener(event)),
    setFolder: (value: string | null) => { folder = value }
  }
  return { api, calls, listeners, project, turn }
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
