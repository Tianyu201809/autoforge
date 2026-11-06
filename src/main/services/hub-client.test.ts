import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HubClientError } from '../../shared/hub-types'
import { createHubClient } from './hub-client'

const credentials = {
  load: () => 'token',
  save: () => undefined,
  clear: () => undefined,
  isPersistent: () => false
}

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
    credentials,
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        zipUrl: 'https://hub.example.test/api/scripts/hub-1/download?installToken=tok',
        scriptName: 'A',
        hubScriptId: 'hub-1',
        sha256: 'abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca'
      })
    }),
    install: async (input) => {
      input.onProgress?.(progress)
      assert.equal(input.hubScriptId, 'hub-1')
      assert.equal(input.expectedSha256, 'abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca')
      return { scriptId: 'local-1', name: 'A', status: 'installed' }
    }
  })

  const result = await client.installPlugin('plugin-1', (next) => received.push(next as typeof progress))
  assert.deepEqual(result, { scriptId: 'local-1', name: 'A', status: 'installed' })
  assert.deepEqual(received, [progress])
})

test('rejects an install response whose sha256 is not 64 hex characters', async () => {
  let installed = false
  const client = createHubClient({
    getHubUrl: () => 'https://hub.example.test',
    credentials,
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        zipUrl: 'https://hub.example.test/api/scripts/hub-1/download?installToken=tok',
        scriptName: 'A',
        hubScriptId: 'hub-1',
        sha256: 'abc'
      })
    }),
    install: async () => {
      installed = true
      return { scriptId: 'local-1', name: 'A', status: 'installed' }
    }
  })

  await assert.rejects(
    () => client.installPlugin('plugin-1'),
    (error: unknown) => {
      assert.ok(error instanceof HubClientError)
      assert.equal(error.code, 'invalid_response')
      assert.equal(error.message, 'AutoforgeHub 安装响应无效')
      return true
    }
  )
  assert.equal(installed, false)
})

test('rejects an install response missing sha256', async () => {
  let installed = false
  const client = createHubClient({
    getHubUrl: () => 'https://hub.example.test',
    credentials,
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        zipUrl: 'https://hub.example.test/api/scripts/hub-1/download?installToken=tok',
        scriptName: 'A',
        hubScriptId: 'hub-1'
      })
    }),
    install: async () => {
      installed = true
      return { scriptId: 'local-1', name: 'A', status: 'installed' }
    }
  })

  await assert.rejects(
    () => client.installPlugin('plugin-1'),
    (error: unknown) => {
      assert.ok(error instanceof HubClientError)
      assert.equal(error.code, 'invalid_response')
      assert.equal(error.message, 'AutoforgeHub 安装响应无效')
      return true
    }
  )
  assert.equal(installed, false)
})
