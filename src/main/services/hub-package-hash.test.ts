import assert from 'node:assert/strict'
import { createHash } from 'crypto'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test } from 'node:test'
import { assertPackageHash, sha256FileHex } from './hub-package-hash'

test('hashes file bytes and rejects a mismatched header', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-hash-'))
  const file = join(dir, 'package.zip')
  writeFileSync(file, 'zip-bytes')
  const expected = createHash('sha256').update('zip-bytes').digest('hex')
  assert.equal(sha256FileHex(file), expected)
  assert.doesNotThrow(() => assertPackageHash(expected, expected.toUpperCase(), expected))
  assert.throws(() => assertPackageHash(expected, null))
  assert.throws(() => assertPackageHash(expected, 'ab', expected))
  assert.throws(() => assertPackageHash(expected, expected, 'cd'))
})
