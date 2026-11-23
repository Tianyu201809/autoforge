import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope } from 'vue'
import type { AiAgentEvent, AiProjectCreateInput, AiProject, AiProjectSummary, AiProjectTurn } from '../../../shared/ai-workspace-types'
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
  const secondProject: AiProject = { ...project, id: 'project-b', name: 'Other project', importedScriptId: undefined }
  let currentProject = project
  const calls: Array<{ method: string; value?: unknown }> = []
  const listeners = new Set<(event: AiAgentEvent) => void>()
  let folder: string | null = root
  let projects: AiProjectSummary[] = []
  let removeResult = true
  let importError = false
  let importDeferred = false
  let resolveImport: ((turn: AiProjectTurn) => void) | null = null
  const turn: AiProjectTurn = { id: 'turn-a', projectId: project.id, role: 'assistant', content: 'Done.', status: 'complete', checks: [], createdAt: 'now' }
  const api = {
    pickAttachments: async () => null,
    previewAttachment: async () => { throw new Error('not found') },
    removeAttachment: async () => true,
    pickProjectFolder: async () => folder,
    listProjects: async () => projects,
    getProject: async (id: string) => id === project.id ? project : id === secondProject.id ? secondProject : null,
    listProjectTurns: async () => [],
    createProject: async (input: Omit<AiProjectCreateInput, 'id'>) => {
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
    importProject: async (id: string) => {
      calls.push({ method: 'importProject', value: id })
      if (importError) throw new Error('import failed')
      if (importDeferred) return new Promise<AiProjectTurn>((resolve) => { resolveImport = resolve })
      listeners.forEach((listener) => {
        listener({ type: 'check_result', projectId: id, turnId: turn.id, check: { code: 'package_valid', status: 'passed' } })
        listener({ type: 'import_result', projectId: id, turnId: turn.id, ok: true, scriptId: 'script-a', message: '已导入' })
      })
      return { ...turn, importedScriptId: 'script-a' }
    },
    cancelTurn: async (id: string) => { calls.push({ method: 'cancelTurn', value: id }); return true },
    onAgentEvent: (callback: (event: AiAgentEvent) => void) => { listeners.add(callback); return () => listeners.delete(callback) },
    listProfiles: async (): Promise<LlmProfileListResult> => ({ profiles, activeProfileId: 'profile-a', credentialPersistent: true }),
    listPresets: async () => [],
    emit: (event: AiAgentEvent) => listeners.forEach((listener) => listener(event)),
    setFolder: (value: string | null) => { folder = value },
    setRemoveResult: (value: boolean) => { removeResult = value },
    setImportError: (value: boolean) => { importError = value },
    setImportDeferred: (value: boolean) => { importDeferred = value },
    resolveImport: (value: AiProjectTurn) => resolveImport?.(value)
  }
  return { api, calls, listeners, project, secondProject, turn, setRemoveResult: api.setRemoveResult, setImportError: api.setImportError, setImportDeferred: api.setImportDeferred, resolveImport: api.resolveImport }
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
  assert.equal(state.importResult.value, null)
  scope.stop()
})

test('runs import only on explicit request and collects its check and import result', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(harness.api))!
  await state.load()
  await state.openProject('project-a')

  await state.importProject()

  assert.deepEqual(harness.calls.map((call) => call.method), ['importProject'])
  assert.equal(state.checkResults.value[0]?.code, 'package_valid')
  assert.equal(state.importResult.value?.scriptId, 'script-a')
  assert.equal(state.busy.value, false)
  scope.stop()
})

test('clears import busy state and exposes errors when the explicit import fails', async () => {
  const harness = createHarness()
  harness.setImportError(true)
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(harness.api))!
  await state.load()
  await state.openProject('project-a')

  await state.importProject()

  assert.equal(state.error.value, 'import failed')
  assert.equal(state.busy.value, false)
  scope.stop()
})

test('does not offer AI message retry after a failed manual import', async () => {
  const harness = createHarness()
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(harness.api))!
  await state.openProject('project-a')
  state.turns.value = [
    { ...harness.turn, id: 'user-before-import', role: 'user', status: 'complete' },
    { ...harness.turn, status: 'error', checks: [{ code: 'build_failed', status: 'failed' }] }
  ]
  assert.equal(state.canRetry.value, false)
  await state.retryMessage()
  assert.deepEqual(harness.calls, [])
  scope.stop()
})

test('keeps an import result attached to its project when the user switches projects', async () => {
  const harness = createHarness()
  harness.setImportDeferred(true)
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(harness.api))!
  await state.openProject('project-a')
  const importing = state.importProject()
  await state.openProject('project-b')
  harness.resolveImport({ ...harness.turn, projectId: 'project-a', importedScriptId: 'script-a' })
  await importing

  assert.equal(state.activeProject.value?.id, 'project-b')
  assert.equal(state.turns.value.some((turn) => turn.projectId === 'project-a'), false)
  assert.equal(state.importResult.value, null)
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
test('sends attachment-only messages, keeps provider errors terminal and retries the saved user', async () => {
  const harness = createHarness()
  const asset = { id:'asset-1', name:'screen.png', kind:'image' as const, mimeType:'image/png', size:20 }
  const savedUser = { id:'saved-user', projectId:'project-a', role:'user' as const, content:'', attachments:[asset], status:'complete' as const, createdAt:'now' }
  const failed = { ...harness.turn, status:'error' as const, content:'Unsupported image' }
  const requests: unknown[] = []
  const api = { ...harness.api,
    pickAttachments: async () => [asset],
    previewAttachment: async () => ({ metadata:asset, dataUrl:'data:image/png;base64,YQ==' }),
    removeAttachment: async () => true,
    listProjectTurns: async () => requests.length ? [savedUser, failed] : [],
    startTurn: async (_id: string, _message: string, options: unknown) => { requests.push(options); harness.api.emit({type:'assistant_delta',projectId:'project-a',turnId:failed.id,text:'partial'}); return failed }
  }
  const scope = effectScope()
  const state = scope.run(() => useAiProjectWorkspace(api))!
  await state.openProject('project-a')
  await state.addAttachments()
  assert.equal(state.pendingAttachments.value.length, 1)
  await state.sendMessage()
  assert.deepEqual(requests[0], { attachmentIds:['asset-1'] })
  assert.equal(state.turns.value.at(-1)?.status, 'error')
  assert.equal(state.turns.value.at(-1)?.content, 'Unsupported image')
  await state.retryMessage()
  assert.deepEqual(requests[1], { retryUserTurnId:'saved-user' })
  assert.equal(state.turns.value.filter(turn => turn.role === 'user').length, 1)
  scope.stop()
})
test('bounds automatic history previews when opening a long conversation', async () => {
  const harness=createHarness()
  const previews: string[]=[]
  const attachments=Array.from({length:100},(_,i)=>({id:`a-${i}`,name:`${i}.png`,kind:'image' as const,mimeType:'image/png',size:100}))
  const api={...harness.api,listProjectTurns:async()=>[{...harness.turn,attachments}],
    previewAttachment:async(_project:string,id:string)=>{previews.push(id);return {metadata:attachments.find(a=>a.id===id)!,dataUrl:'data:image/png;base64,YQ=='}},
    pickAttachments:async()=>null,removeAttachment:async()=>true}
  const scope=effectScope();const state=scope.run(()=>useAiProjectWorkspace(api))!
  await state.openProject('project-a')
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.ok(previews.length<=8)
  assert.ok(Object.keys(state.attachmentPreviews.value).length<=8)
  scope.stop()
})
