import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test } from 'node:test'
import { createDirtyScheduler, removeStaleTemp, replaceFileAtomically } from './sqlite-persist'

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

test('waits 300ms after the last write and flushes by 1000ms', () => {
  let now = 0
  const due: { at: number; fn: () => void }[] = []
  let flushed = 0
  const scheduler = createDirtyScheduler({
    now: () => now,
    schedule: (fn, ms) => {
      const at = now + ms
      due.push({ at, fn })
      return { cancel() { const i = due.findIndex((item) => item.fn === fn); if (i >= 0) due.splice(i, 1) } }
    },
    flush: () => { flushed += 1 }
  })
  scheduler.markDirty()
  now = 200
  scheduler.markDirty()
  assert.equal(due.at(-1)?.at, 500)
  now = 900
  scheduler.markDirty()
  assert.equal(due.at(-1)?.at, 1000)
  due.at(-1)?.fn()
  assert.equal(flushed, 1)
})

test('flushNow cancels the timer and writes immediately', () => {
  let flushed = 0
  let cancelled = false
  const scheduler = createDirtyScheduler({
    now: () => 0,
    schedule: () => ({ cancel() { cancelled = true } }),
    flush: () => { flushed += 1 }
  })
  scheduler.markDirty()
  scheduler.flushNow()
  assert.equal(cancelled, true)
  assert.equal(flushed, 1)
})
