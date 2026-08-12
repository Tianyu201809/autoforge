import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { inspectScriptImport } from './script-import-source'
import { closeDatabase, initDatabase } from '../db/database'
import { scriptWorkspace } from './script-workspace'

const roots: string[] = []
afterEach(() => {
  closeDatabase()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function root(): string { const value = mkdtempSync(join(tmpdir(), 'autoforge-import-')); roots.push(value); return value }
function pe(): Buffer {
  const value = Buffer.alloc(512); value.write('MZ'); value.writeUInt32LE(0x80, 0x3c)
  value.write('PE\0\0', 0x80, 'binary'); value.writeUInt16LE(0x8664, 0x84); value.writeUInt16LE(2, 0x96)
  return value
}
function zip(entries: Record<string, Buffer>): string {
  const dir = root(); const archive = new AdmZip()
  for (const [name, value] of Object.entries(entries)) archive.addFile(name, value)
  const path = join(dir, 'package.zip'); archive.writeZip(path); return path
}

test('inspects a manifestless ZIP with a unique executable', () => {
  const result = inspectScriptImport(zip({ 'release/bin/tool.exe': pe() }), 'win32')
  assert.equal(result.kind, 'ready')
  assert.equal(result.candidate?.entry, 'bin/tool.exe')
})

test('returns choices for multiple executable candidates', () => {
  const dir = root(); writeFileSync(join(dir, 'a.exe'), pe()); mkdirSync(join(dir, 'bin')); writeFileSync(join(dir, 'bin', 'b.exe'), pe())
  const result = inspectScriptImport(dir, 'win32')
  assert.equal(result.kind, 'select-executable')
  if (result.kind === 'select-executable') assert.deepEqual(result.candidates.map((item) => item.entry), ['a.exe', 'bin/b.exe'])
})

test('preserves standalone JavaScript and Python quick imports', () => {
  for (const name of ['a.js', 'a.mjs', 'a.cjs', 'a.py']) {
    const path = join(root(), name); writeFileSync(path, '')
    assert.deepEqual(inspectScriptImport(path, 'win32'), { kind: 'ready' })
  }
})

test('rejects a directory without a runnable candidate', () => {
  const dir = root(); writeFileSync(join(dir, 'readme.txt'), 'nothing')
  assert.throws(() => inspectScriptImport(dir, 'win32'), /未找到当前系统可运行/)
})

test('imports a selected executable into a generated minimal package', async () => {
  const dataRoot = root()
  await initDatabase(dataRoot)
  const scriptsRoot = join(dataRoot, 'scripts')
  mkdirSync(scriptsRoot)
  ;(scriptWorkspace as unknown as { scriptsRoot: string }).scriptsRoot = scriptsRoot
  const source = root()
  writeFileSync(join(source, 'tool.exe'), pe())

  const meta = scriptWorkspace.importExecutableSource(source, source, 'tool.exe')
  const manifest = JSON.parse(
    readFileSync(join(meta.workspacePath, 'autoforge.json'), 'utf8')
  ) as Record<string, unknown>
  assert.deepEqual(manifest, {
    autoforge: '1.0', name: 'tool', version: '1.0.0', entry: 'tool.exe',
    language: 'executable', env: [], params: []
  })
})

test('rejects a stale selected executable without leaving a workspace', async () => {
  const dataRoot = root()
  await initDatabase(dataRoot)
  const scriptsRoot = join(dataRoot, 'scripts')
  mkdirSync(scriptsRoot)
  ;(scriptWorkspace as unknown as { scriptsRoot: string }).scriptsRoot = scriptsRoot
  const source = root()
  writeFileSync(join(source, 'current.exe'), pe())

  assert.throws(
    () => scriptWorkspace.importExecutableSource(source, source, 'missing.exe'),
    /候选入口已变化/
  )
  assert.deepEqual(readdirSync(scriptsRoot), [])
})
