import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test } from 'node:test'
import { removeStaleTemp, replaceFileAtomically } from './sqlite-persist'

test('replaces the target only after the temp file is synced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-replace-'))
  const target = join(dir, 'autoforge.db')
  writeFileSync(target, 'old')
  replaceFileAtomically(target, Buffer.from('new'))
  assert.equal(readFileSync(target, 'utf8'), 'new')
  assert.equal(existsSync(`${target}.tmp`), false)
})

test('removes a leftover temp file and leaves the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-tmp-'))
  const target = join(dir, 'autoforge.db')
  writeFileSync(target, 'keep')
  writeFileSync(`${target}.tmp`, 'partial')
  removeStaleTemp(target)
  assert.equal(readFileSync(target, 'utf8'), 'keep')
  assert.equal(existsSync(`${target}.tmp`), false)
})
