import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  MAX_EXTRACTED_BYTES,
  MAX_ZIP_BYTES,
  assertSafeZipEntryName,
  extractZipSecurely,
  resolveZipPackageRoot
} from './safe-zip-package'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('allows ZIP packages up to the Hub 500 MB limit', () => {
  assert.equal(MAX_ZIP_BYTES, 500 * 1024 * 1024)
  assert.equal(MAX_EXTRACTED_BYTES, 500 * 1024 * 1024)
})

function zipFile(entries: Record<string, Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-zip-test-'))
  roots.push(root)
  const zip = new AdmZip()
  for (const [name, value] of Object.entries(entries)) zip.addFile(name, value)
  const path = join(root, 'package.zip')
  zip.writeZip(path)
  return path
}

test('extracts safe entries and selects a sole top-level directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-extract-'))
  roots.push(root)
  extractZipSecurely(zipFile({ 'release/tool.exe': Buffer.from('tool') }), root)
  assert.equal(resolveZipPackageRoot(root), join(root, 'release'))
})

test('uses extraction root when there are multiple top-level entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-extract-'))
  roots.push(root)
  extractZipSecurely(zipFile({ 'a.exe': Buffer.from('a'), 'bin/b.exe': Buffer.from('b') }), root)
  assert.equal(resolveZipPackageRoot(root), root)
})

test('rejects path traversal entries', () => {
  assert.throws(() => assertSafeZipEntryName('../escape.exe'), /非法路径/)
  assert.throws(() => assertSafeZipEntryName('C:/escape.exe'), /非法路径/)
  assert.throws(() => assertSafeZipEntryName('/escape.exe'), /非法路径/)
})
