import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test } from 'node:test'
import { openSqliteDatabase } from './sqlite-adapter'

test('open removes a stale temp and flush writes the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-'))
  const dbPath = join(dir, 'autoforge.db')
  writeFileSync(`${dbPath}.tmp`, 'partial')
  const db = await openSqliteDatabase(dbPath)
  assert.equal(existsSync(`${dbPath}.tmp`), false)
  db.exec('CREATE TABLE t (id INTEGER)')
  db.flush()
  assert.equal(existsSync(dbPath), true)
  assert.equal(existsSync(`${dbPath}.tmp`), false)
  db.close()
})
