import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createProjectWorkspace, validateProjectRoot } from './project-workspace'

function fixture(t: { after(callback: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-ai-project-'))
  const outside = mkdtempSync(join(tmpdir(), 'autoforge-ai-outside-'))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })
  return { root, outside }
}

test('accepts writable project roots with or without existing files', (t) => {
  const { root } = fixture(t)
  assert.equal(validateProjectRoot(root).empty, true)
  writeFileSync(join(root, 'existing.txt'), 'existing')
  assert.equal(validateProjectRoot(root).empty, false)
})

test('rejects a symlink selected as the project root', (t) => {
  const { root, outside } = fixture(t)
  const linkedRoot = join(root, 'linked')
  symlinkSync(outside, linkedRoot, 'junction')
  assert.throws(() => validateProjectRoot(linkedRoot), /不能是符号链接/)
})

test('rejects traversal and symlink escapes when listing, reading, and writing', async (t) => {
  const { root, outside } = fixture(t)
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  symlinkSync(outside, join(root, 'escape'), 'junction')
  const workspace = createProjectWorkspace(() => root)

  assert.throws(() => workspace.readProjectFile('project-1', '../secret.txt'), /路径无效/)
  assert.throws(() => workspace.readProjectFile('project-1', 'escape/secret.txt'), /符号链接/)
  await assert.rejects(
    () => workspace.applyProjectChanges('project-1', [{ path: 'escape/new.txt', content: 'x' }], { 'escape/new.txt': null }),
    /符号链接/
  )
})

test('rejects binary and files larger than 512 KiB when reading', (t) => {
  const { root } = fixture(t)
  writeFileSync(join(root, 'binary.dat'), Buffer.from([0x61, 0x00, 0x62]))
  writeFileSync(join(root, 'large.txt'), Buffer.alloc(512 * 1024 + 1, 0x61))
  const workspace = createProjectWorkspace(() => root)

  assert.throws(() => workspace.readProjectFile('project-1', 'binary.dat'), /二进制文件/)
  assert.throws(() => workspace.readProjectFile('project-1', 'large.txt'), /超过 512 KiB/)
})

test('detects a file changed after its hash was read', async (t) => {
  const { root } = fixture(t)
  writeFileSync(join(root, 'index.mjs'), 'original')
  const workspace = createProjectWorkspace(() => root)
  const file = (await workspace.listProjectFiles('project-1')).find((item) => item.path === 'index.mjs')!
  writeFileSync(join(root, 'index.mjs'), 'edited outside Autoforge')

  const result = await workspace.applyProjectChanges('project-1', [{ path: 'index.mjs', content: 'generated' }], {
    'index.mjs': file.sha256
  })
  assert.deepEqual(result, { applied: [], conflicts: ['index.mjs'], rollbackFailed: [] })
  assert.equal(readFileSync(join(root, 'index.mjs'), 'utf8'), 'edited outside Autoforge')
})

test('rollback preserves a concurrent external edit', async (t) => {
  const { root, outside } = fixture(t)
  writeFileSync(join(outside, 'original.txt'), 'outside')
  const workspace = createProjectWorkspace(() => root)
  queueMicrotask(() => {
    writeFileSync(join(root, 'first.txt'), 'user edit')
    symlinkSync(outside, join(root, 'escape'), 'junction')
  })

  const result = await workspace.applyProjectChanges('project-1', [
    { path: 'first.txt', content: 'generated' },
    { path: 'escape/new.txt', content: 'blocked' }
  ], { 'first.txt': null, 'escape/new.txt': null })

  assert.equal(readFileSync(join(root, 'first.txt'), 'utf8'), 'user edit')
  assert.deepEqual(result.applied, [])
  assert.ok(result.conflicts.includes('first.txt'))
  assert.ok(result.rollbackFailed.includes('first.txt'))
  assert.equal(existsSync(join(outside, 'new.txt')), false)
})
