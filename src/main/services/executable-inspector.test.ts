import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { inspectExecutable } from './executable-inspector'

const root = mkdtempSync(join(tmpdir(), 'autoforge-inspector-'))
after(() => rmSync(root, { recursive: true, force: true }))

function fixture(name: string, bytes: Buffer): string {
  const path = join(root, name)
  writeFileSync(path, bytes)
  return path
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

function elf(type = 2, withInterpreter = false): Buffer {
  const value = Buffer.alloc(256)
  value.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
  value.writeUInt16LE(type, 16)
  value.writeUInt16LE(0x3e, 18)
  value.writeBigUInt64LE(64n, 32)
  value.writeUInt16LE(56, 54)
  value.writeUInt16LE(withInterpreter ? 1 : 0, 56)
  if (withInterpreter) value.writeUInt32LE(3, 64)
  return value
}

function macho(fileType = 2, bigEndian = false): Buffer {
  const value = Buffer.alloc(32)
  if (bigEndian) {
    value.writeUInt32BE(0xfeedfacf, 0)
    value.writeInt32BE(0x01000007, 4)
    value.writeUInt32BE(fileType, 12)
  } else {
    value.writeUInt32LE(0xfeedfacf, 0)
    value.writeInt32LE(0x01000007, 4)
    value.writeUInt32LE(fileType, 12)
  }
  return value
}

function fatMacho(slice: Buffer): Buffer {
  const value = Buffer.alloc(4096)
  value.writeUInt32BE(0xcafebabe, 0)
  value.writeUInt32BE(1, 4)
  value.writeInt32BE(0x01000007, 8)
  value.writeUInt32BE(3, 12)
  value.writeUInt32BE(4096 - slice.length, 16)
  value.writeUInt32BE(slice.length, 20)
  slice.copy(value, 4096 - slice.length)
  return value
}

test('recognizes PE executable and excludes DLL', () => {
  assert.equal(inspectExecutable(fixture('tool.exe', pe()))?.kind, 'executable')
  assert.equal(inspectExecutable(fixture('tool.dll', pe(0x2002)))?.kind, 'library')
})

test('recognizes ELF executable and distinguishes dynamic executables from shared objects', () => {
  assert.equal(inspectExecutable(fixture('tool', elf(2)))?.kind, 'executable')
  assert.equal(inspectExecutable(fixture('pie', elf(3, true)))?.kind, 'executable')
  assert.equal(inspectExecutable(fixture('lib.so', elf(3)))?.kind, 'library')
})

test('recognizes little- and big-endian Mach-O executables and dylibs', () => {
  assert.equal(inspectExecutable(fixture('tool-mac', macho(2)))?.kind, 'executable')
  assert.equal(inspectExecutable(fixture('tool-mac-be', macho(2, true)))?.kind, 'executable')
  assert.equal(inspectExecutable(fixture('lib.dylib', macho(6)))?.kind, 'library')
})

test('recognizes a fat Mach-O containing an executable slice', () => {
  const result = inspectExecutable(fixture('universal', fatMacho(macho(2))))
  assert.equal(result?.format, 'mach-o')
  assert.equal(result?.kind, 'executable')
})

test('returns null for text and truncated files', () => {
  assert.equal(inspectExecutable(fixture('note.txt', Buffer.from('hello'))), null)
  assert.equal(inspectExecutable(fixture('mz', Buffer.from('MZ'))), null)
})
