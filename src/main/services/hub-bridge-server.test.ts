import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bridgeCorsHeaders, installRejection } from './hub-bridge-server'
import { HubInstallError, installScriptFromHubZip } from './hub-script-installer'

test('reflects only the configured origin', () => {
  assert.deepEqual(bridgeCorsHeaders('https://hub.example.test', 'https://hub.example.test'), {
    'Access-Control-Allow-Origin': 'https://hub.example.test',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  assert.deepEqual(bridgeCorsHeaders('https://evil.test', 'https://hub.example.test'), {})
})

test('rejects an install whose origin or body is not allowed', () => {
  assert.deepEqual(
    installRejection('https://evil.test', 'https://hub.example.test', { hubScriptId: 'a', installToken: 't' }),
    { status: 400, error: 'invalid_request', message: '安装请求无效' }
  )
  assert.equal(
    installRejection('https://hub.example.test', 'https://hub.example.test', { hubScriptId: 'a', installToken: 't' }),
    null
  )
  assert.deepEqual(
    installRejection(undefined, 'https://hub.example.test', { hubScriptId: 'a', installToken: 't' }),
    { status: 400, error: 'invalid_request', message: '安装请求无效' }
  )
  assert.deepEqual(
    installRejection('https://hub.example.test', 'https://hub.example.test', {
      hubScriptId: 'a',
      installToken: 't',
      zipUrl: 'https://evil.test/a.zip'
    }),
    { status: 400, error: 'invalid_request', message: '安装请求无效' }
  )
})

test('turns an expired download token into invalid_request', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('expired', { status: 401, statusText: 'Unauthorized' })
  try {
    await assert.rejects(
      () => installScriptFromHubZip({
        zipUrl: 'https://hub.example.test/api/scripts/a/download?installToken=tok',
        hubScriptId: 'a'
      }),
      (err: unknown) => {
        assert.ok(err instanceof HubInstallError)
        assert.equal(err.code, 'invalid_request')
        assert.equal(err.message, '安装链接无效或已过期')
        return true
      }
    )
  } finally {
    globalThis.fetch = original
  }
})
