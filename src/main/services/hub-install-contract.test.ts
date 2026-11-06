import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildHubDownloadUrl,
  originAllowed,
  parseBridgeInstallBody
} from './hub-install-contract'

test('builds a download URL on the configured Hub origin', () => {
  assert.equal(
    buildHubDownloadUrl('https://hub.example.test/app/', 'script 1', 'tok'),
    'https://hub.example.test/api/scripts/script%201/download?installToken=tok'
  )
})

test('rejects bodies that carry a zip URL or checksum', () => {
  assert.throws(() => parseBridgeInstallBody({ hubScriptId: 'a', installToken: 't', zipUrl: 'https://evil.test/a.zip' }))
  assert.throws(() => parseBridgeInstallBody({ hubScriptId: 'a', installToken: 't', sha256: 'abc' }))
  assert.deepEqual(parseBridgeInstallBody({ hubScriptId: ' a ', installToken: ' t ' }), {
    hubScriptId: 'a',
    installToken: 't'
  })
})

test('allows only the configured Hub origin', () => {
  assert.equal(originAllowed('https://hub.example.test', 'https://hub.example.test/path'), true)
  assert.equal(originAllowed(undefined, 'https://hub.example.test'), false)
  assert.equal(originAllowed('null', 'https://hub.example.test'), false)
  assert.equal(originAllowed('https://evil.test', 'https://hub.example.test'), false)
})
