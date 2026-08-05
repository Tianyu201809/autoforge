import assert from 'node:assert/strict'
import test from 'node:test'
import type { LogLine, RunSession } from '../../shared/types/script'
import { RunEventStore } from './run-event-store'

function session(status: RunSession['status'] = 'running'): RunSession {
  return {
    id: 'session-1',
    scriptId: 'script-1',
    status,
    phase: status === 'running' ? 'running' : 'completed',
    startedAt: new Date(0).toISOString(),
    finishedAt: status === 'running' ? undefined : new Date(1).toISOString()
  }
}

function line(index: number): LogLine {
  return { sessionId: 'session-1', ts: new Date(index).toISOString(), level: 'INFO', message: `line-${index}` }
}

test('RunEventStore returns cursor pages and gap markers', () => {
  const store = new RunEventStore()
  try {
    store.updateSession(session())
    store.appendLog(line(1))
    store.appendLog(line(2))
    assert.deepEqual(store.getLogs('session-1', 0, 1).lines.map((item) => item.message), ['line-1'])
    assert.equal(store.getLogs('session-1', 0, 1).nextCursor, 1)
    assert.equal(store.getLogs('session-1', 99).gap, false)
  } finally {
    store.dispose()
  }
})

test('RunEventStore resolves terminal waits', async () => {
  const store = new RunEventStore()
  try {
    store.updateSession(session())
    const pending = store.waitForTerminal('session-1', 1_000)
    store.updateSession(session('success'))
    const result = await pending
    assert.equal(result.status, 'success')
  } finally {
    store.dispose()
  }
})

test('RunEventStore rejects waits for unknown sessions', async () => {
  const store = new RunEventStore()
  try {
    await assert.rejects(store.waitForTerminal('missing', 10), /not_found/)
  } finally {
    store.dispose()
  }
})
