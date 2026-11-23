import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IPC } from '../../shared/ipc-channels'
import type { AiAgentEvent, AiProject, AiProjectConversationExport } from '../../shared/ai-workspace-types'
import { registerAiWorkspaceIpcHandlers } from './ai-workspace-handlers'

type Event = { sender: { send(channel: string, payload: AiAgentEvent): void } }
type Handler = (event: Event, ...args: unknown[]) => unknown

function harness() {
  const handlers = new Map<string, Handler>()
  const calls: string[] = []
  const exports: AiProjectConversationExport[] = []
  const project: AiProject = {
    id: 'project-1', name: 'Demo', rootPath: 'C:/workspace', language: 'javascript', profileId: 'profile-1',
    pinned: false, status: 'ready', createdAt: '2026-11-22T00:00:00.000Z', updatedAt: '2026-11-22T00:00:00.000Z'
  }
  const service = {
    listProjects: () => [],
    getProject: () => project,
    listTurns: () => [{ id: 'turn-1', projectId: project.id, role: 'user' as const, content: 'saved prompt', status: 'complete' as const, createdAt: '2026-11-22T00:00:00.000Z' }],
    createProject: async () => project,
    renameProject: (_id: string, name: string) => ({ ...project, name }),
    setProjectPinned: (_id: string, pinned: boolean) => ({ ...project, pinned }),
    removeProject: () => true,
    startTurn: async (_id: string, _message: string, onEvent: (event: AiAgentEvent) => void) => {
      onEvent({ type: 'assistant_delta', projectId: project.id, turnId: 'turn-1', text: 'hello' })
      return {
        id: 'turn-1', projectId: project.id, role: 'assistant' as const, content: 'hello', status: 'complete' as const,
        createdAt: '2026-11-22T00:00:00.000Z'
      }
    },
    cancelTurn: (id: string) => { calls.push(`cancel:${id}`); return true },
    retryChecks: async () => ({
      id: 'turn-2', projectId: project.id, role: 'assistant' as const, content: '', status: 'complete' as const,
      createdAt: '2026-11-22T00:00:00.000Z'
    })
  }
  const register = (channel: string, handler: Handler) => handlers.set(channel, handler)
  registerAiWorkspaceIpcHandlers(register, service, async () => null, async (exportData) => {
    exports.push(exportData)
    return null
  })
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: { send: () => undefined } }, ...args)
  return { handlers, calls, exports, invoke }
}

test('rejects malformed project payloads at the IPC boundary', async () => {
  const { invoke } = harness()
  assert.throws(() => invoke(IPC.AI_PROJECT_CREATE, { rootPath: 12 }), /项目输入无效/)
})

test('routes Agent events to the renderer that started the turn', async () => {
  const { handlers } = harness()
  const received: AiAgentEvent[] = []
  const event: Event = { sender: { send: (_channel, payload) => received.push(payload) } }

  await handlers.get(IPC.AI_PROJECT_START_TURN)!(event, 'project-1', 'Create a script')
  assert.deepEqual(received, [{ type: 'assistant_delta', projectId: 'project-1', turnId: 'turn-1', text: 'hello' }])
})

test('routes cancellation to the requested project turn', () => {
  const { invoke, calls } = harness()
  assert.equal(invoke(IPC.AI_PROJECT_CANCEL_TURN, 'project-1'), true)
  assert.deepEqual(calls, ['cancel:project-1'])
})

test('returns null when the folder picker is cancelled', async () => {
  const { invoke } = harness()
  assert.equal(await invoke(IPC.AI_PROJECT_PICK_FOLDER), null)
})

test('exposes persisted project turns for restoring a conversation', async () => {
  const { invoke } = harness()
  const turns = await invoke(IPC.AI_PROJECT_TURNS_LIST, 'project-1') as Array<{ content: string }>
  assert.equal(turns[0]?.content, 'saved prompt')
})

test('validates and routes project rename and pin operations', () => {
  const { invoke } = harness()
  assert.equal((invoke(IPC.AI_PROJECT_RENAME, 'project-1', 'Renamed') as AiProject).name, 'Renamed')
  assert.equal((invoke(IPC.AI_PROJECT_SET_PINNED, 'project-1', true) as AiProject).pinned, true)
  assert.throws(() => invoke(IPC.AI_PROJECT_RENAME, 'project-1', '  '), /项目名称/)
  assert.throws(() => invoke(IPC.AI_PROJECT_SET_PINNED, 'project-1', 'yes'), /置顶状态/)
})

test('exports the project and its turns through the save-dialog callback', async () => {
  const { invoke, exports } = harness()
  assert.equal(await invoke(IPC.AI_PROJECT_EXPORT_TURNS, 'project-1'), null)
  assert.equal(exports.length, 1)
  assert.equal(exports[0]?.turns[0]?.content, 'saved prompt')
  assert.equal('rootPath' in exports[0]!.project, false)
})
