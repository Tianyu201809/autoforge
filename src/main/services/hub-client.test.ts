import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHubClient } from './hub-client'

test('forwards Hub install progress from the local installer', async () => {
  const progress = {
    hubScriptId: 'hub-1',
    phase: 'downloading' as const,
    message: '正在下载脚本包',
    percent: 42,
    downloadedBytes: 42,
    totalBytes: 100
  }
  const received: typeof progress[] = []
  const client = createHubClient({
    getHubUrl: () => 'https://hub.example.test',
    credentials: {
      load: () => 'token',
      save: () => undefined,
      clear: () => undefined,
      isPersistent: () => false
    },
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ zipUrl: 'https://cdn.example.test/a.zip', scriptName: 'A', hubScriptId: 'hub-1' })
    }),
    install: async (input) => {
      input.onProgress?.(progress)
      assert.equal(input.hubScriptId, 'hub-1')
      return { scriptId: 'local-1', name: 'A', status: 'installed' }
    }
  })

  const result = await client.installPlugin('plugin-1', (next) => received.push(next as typeof progress))
  assert.deepEqual(result, { scriptId: 'local-1', name: 'A', status: 'installed' })
  assert.deepEqual(received, [progress])
})
