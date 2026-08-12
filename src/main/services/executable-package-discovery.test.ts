import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  createExecutableManifest,
  discoverExecutableCandidates
} from './executable-package-discovery'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-discovery-'))
  roots.push(root)
  return root
}

function pe(characteristics = 0x0002): Buffer {
  const value = Buffer.alloc(512)
  value.write('MZ')
  value.writeUInt32LE(0x80, 0x3c)
  value.write('PE\0\0', 0x80, 'binary')
  value.writeUInt16LE(0x8664, 0x84)
  value.writeUInt16LE(characteristics, 0x96)
  return value
}

test('discovers current-platform executables in stable relative-path order', () => {
  const root = makeRoot()
  writeFileSync(join(root, 'b.exe'), pe())
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'bin', 'a.exe'), pe())
  writeFileSync(join(root, 'helper.dll'), pe(0x2002))
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'node_modules', 'ignored.exe'), pe())

  assert.deepEqual(
    discoverExecutableCandidates(root, 'win32').map((item) => item.entry),
    ['b.exe', 'bin/a.exe']
  )
  assert.deepEqual(discoverExecutableCandidates(root, 'darwin'), [])
})

test('does not follow executable symlinks', (context) => {
  const root = makeRoot()
  writeFileSync(join(root, 'target.exe'), pe())
  try {
    symlinkSync(join(root, 'target.exe'), join(root, 'link.exe'), 'file')
  } catch {
    context.skip('Windows 当前权限不能创建符号链接')
    return
  }
  assert.deepEqual(
    discoverExecutableCandidates(root, 'win32').map((item) => item.entry),
    ['target.exe']
  )
})

test('generates a minimal parameterless manifest', () => {
  assert.deepEqual(
    createExecutableManifest({ entry: 'bin/tool.exe', format: 'pe', platform: 'win32', size: 512 }),
    {
      autoforge: '1.0',
      name: 'tool',
      version: '1.0.0',
      entry: 'bin/tool.exe',
      language: 'executable',
      env: [],
      params: []
    }
  )
})
