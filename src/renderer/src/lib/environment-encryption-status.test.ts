import assert from 'node:assert/strict'
import { test } from 'node:test'
import { environmentEncryptionNotice, environmentReadable } from './environment-encryption-status'

test('returns the plaintext notice when encryption is unavailable', () => {
  assert.equal(environmentEncryptionNotice(false), '当前未能加密，变量以明文留在本机数据库')
})

test('returns null when encryption is available', () => {
  assert.equal(environmentEncryptionNotice(true), null)
})

test('environmentReadable is false only when variablesReadable is false', () => {
  assert.equal(environmentReadable({ variablesReadable: false }), false)
  assert.equal(environmentReadable({ variablesReadable: true }), true)
  assert.equal(environmentReadable({}), true)
})
