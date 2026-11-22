import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IPC } from '../../shared/ipc-channels'
import type { AiAgentEvent, AiProject } from '../../shared/ai-workspace-types'
import { registerAiWorkspaceIpcHandlers } from './ai-workspace-handlers'

type Event = { sender: { send(channel: string, payload: AiAgentEvent): void } }
type Handler = (event: Event, ...args: unknown[]) => unknown

function harness() {
  const handlers = new Map<string, Handler>()
  const calls: string[] = []
  const project: AiProject = {
    id: 'project-1', name: 'Demo', rootPath: 'C:/workspace', language: 'javascript', profileId: 'profile-1',
    status: 'ready', createdAt: '2026-11-22T00:00:00.000Z', updatedAt: '2026-11-22T00:00:00.000Z'
  }
  const service = {
    listProjects: () => [],
    getProject: () => project,
    createProject: async () => project,
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
  registerAiWorkspaceIpcHandlers(register, service, async () => null)
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: { send: () => undefined } }, ...args)
  return { handlers, calls, invoke }
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
