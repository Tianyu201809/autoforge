import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import type { ScriptManifest } from '../../shared/script-contract'
import { scriptWorkspace } from './script-workspace'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-workspace-executable-'))
  roots.push(root)
  return root
}

function pe(): Buffer {
  const value = Buffer.alloc(512)
  value.write('MZ')
  value.writeUInt32LE(0x80, 0x3c)
  value.write('PE\0\0', 0x80, 'binary')
  value.writeUInt16LE(0x8664, 0x84)
  value.writeUInt16LE(0x0002, 0x96)
  return value
}

test('resolves an undeclared executable entry by file header', () => {
  const root = makeRoot()
  writeFileSync(join(root, 'tool.exe'), pe())
  const resolved = scriptWorkspace.resolveManifestLanguage(root, {
    autoforge: '1.0',
    name: 'Tool',
    entry: 'tool.exe'
  })
  assert.equal(resolved.language, 'executable')
})

test('rejects explicit script language when entry is an executable', () => {
  const root = makeRoot()
  writeFileSync(join(root, 'tool.exe'), pe())
  assert.throws(
    () => scriptWorkspace.resolveManifestLanguage(root, {
      autoforge: '1.0',
      name: 'Tool',
      entry: 'tool.exe',
      language: 'javascript'
    }),
    /冲突/
  )
})

test('rejects native dependencies and normalized parameter collisions after inference', () => {
  const root = makeRoot()
  writeFileSync(join(root, 'tool.exe'), pe())
  const base: ScriptManifest = { autoforge: '1.0', name: 'Tool', entry: 'tool.exe' }
  assert.throws(
    () => scriptWorkspace.resolveManifestLanguage(root, { ...base, dependencies: { native: '1' } }),
    /不能声明 dependencies/
  )
  assert.throws(
    () => scriptWorkspace.resolveManifestLanguage(root, {
      ...base,
      params: [{ key: 'a-b', label: 'A' }, { key: 'a_b', label: 'B' }]
    }),
    /参数环境变量冲突/
  )
})

test('rejects an entry outside the workspace', () => {
  const root = makeRoot()
  const outside = join(root, '..', 'outside.exe')
  writeFileSync(outside, pe())
  try {
    assert.throws(
      () => scriptWorkspace.resolveManifestLanguage(root, {
        autoforge: '1.0', name: 'Tool', entry: '../outside.exe', language: 'executable'
      }),
      /非法路径/
    )
  } finally {
    rmSync(outside, { force: true })
  }
})

test('keeps ordinary JavaScript extension behavior', () => {
  const root = makeRoot()
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'index.mjs'), 'export async function run() {}')
  const resolved = scriptWorkspace.resolveManifestLanguage(root, {
    autoforge: '1.0', name: 'Script', entry: 'src/index.mjs'
  })
  assert.equal(resolved.language, 'javascript')
})
