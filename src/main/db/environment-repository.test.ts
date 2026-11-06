import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { EnvCipher } from './environment-secrets'
import { EnvironmentRepository } from './repositories/environment-repository'
import { openSqliteDatabase } from './sqlite-adapter'

function cipher(): EnvCipher {
  return {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(value, 'utf8'),
    decrypt: (value) => value.toString('utf8')
  }
}

function failingCipher(): EnvCipher {
  return {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(value, 'utf8'),
    decrypt: () => {
      throw new Error('bad')
    }
  }
}

const dir = mkdtempSync(join(tmpdir(), 'autoforge-env-repo-'))

after(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('migrates plaintext and refuses to save an unreadable row', async () => {
  const db = await openSqliteDatabase(join(dir, 'autoforge.db'))
  db.exec(`CREATE TABLE environments (id TEXT PRIMARY KEY, name TEXT, description TEXT, variables TEXT, is_default INTEGER)`)
  db.prepare('INSERT INTO environments (id, name, description, variables, is_default) VALUES (?, ?, ?, ?, ?)').run('e1', '默认', '', '{"TOKEN":"secret"}', 1)
  const repo = new EnvironmentRepository(db, cipher())
  repo.migratePlaintext()
  const stored = db.prepare('SELECT variables FROM environments WHERE id = ?').get('e1') as { variables: string }
  assert.equal(stored.variables.startsWith('enc:v1:'), true)
  assert.deepEqual(repo.getById('e1')?.variables, { TOKEN: 'secret' })

  db.prepare('UPDATE environments SET variables = ? WHERE id = ?').run('enc:v1:aaaa', 'e1')
  const broken = new EnvironmentRepository(db, failingCipher())
  assert.equal(broken.getById('e1')?.variablesReadable, false)
  assert.equal(broken.update('e1', { variables: { TOKEN: 'changed' } }), null)
  const after = db.prepare('SELECT variables FROM environments WHERE id = ?').get('e1') as { variables: string }
  assert.equal(after.variables, 'enc:v1:aaaa')
  db.close()
})

test('treats a non-string map as unreadable and does not overwrite it', async () => {
  const db = await openSqliteDatabase(join(dir, 'nested.db'))
  db.exec(`CREATE TABLE environments (id TEXT PRIMARY KEY, name TEXT, description TEXT, variables TEXT, is_default INTEGER)`)
  const storedText = '{"TOKEN":1}'
  db.prepare('INSERT INTO environments (id, name, description, variables, is_default) VALUES (?, ?, ?, ?, ?)').run(
    'e2',
    '坏映射',
    '',
    storedText,
    0
  )
  const repo = new EnvironmentRepository(db, cipher())
  assert.equal(repo.getById('e2')?.variablesReadable, false)
  repo.migratePlaintext()
  assert.equal(repo.update('e2', { variables: { TOKEN: 'changed' } }), null)
  const after = db.prepare('SELECT variables FROM environments WHERE id = ?').get('e2') as { variables: string }
  assert.equal(after.variables, storedText)
  db.close()
})
