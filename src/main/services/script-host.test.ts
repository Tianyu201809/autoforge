import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runHostMessage } from './script-host'

test('posts the script result and log lines', async () => {
  const posted: unknown[] = []
  const controller = new AbortController()
  await runHostMessage(
    {
      type: 'start',
      entryPath: 'entry.js',
      sessionId: 's',
      scriptId: 'script',
      env: { A: '1' },
      params: {},
      paths: { userData: 'user', scriptDir: 'dir' }
    },
    {
      importModule: async () => ({
        run: async (ctx: { log: (level: string, message: string) => void }) => {
          ctx.log('INFO', 'hello')
          return { ok: true }
        }
      }),
      post: (message) => posted.push(message),
      signal: controller.signal,
      createSdk: () => ({ browser: { launch: async () => ({ process: () => ({ pid: 1 }) }) }, paths: { userData: 'user', scriptDir: 'dir' } })
    }
  )
  assert.deepEqual(posted[0], { type: 'log', level: 'INFO', message: 'hello' })
  assert.deepEqual(posted[1], { type: 'result', value: { ok: true } })
})

test('posts an error when the entry function is missing', async () => {
  const posted: unknown[] = []
  await runHostMessage(
    {
      type: 'start',
      entryPath: 'entry.js',
      sessionId: 's',
      scriptId: 'script',
      env: {},
      params: {},
      paths: { userData: 'user', scriptDir: 'dir' }
    },
    {
      importModule: async () => ({}),
      post: (message) => posted.push(message),
      signal: new AbortController().signal,
      createSdk: () => ({ browser: { launch: async () => ({ process: () => ({ pid: 1 }) }) }, paths: { userData: 'user', scriptDir: 'dir' } })
    }
  )
  assert.equal((posted[0] as { type: string }).type, 'error')
})
