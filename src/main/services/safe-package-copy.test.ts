import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { copyPackageDirectory } from './safe-package-copy'
import { rawFilesystem } from './raw-filesystem'

test('copies regular package resources and skips directory links', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-safe-copy-'))
  try {
    const source = join(root, 'source')
    const outside = join(root, 'outside')
    const target = join(root, 'target')
    mkdirSync(join(source, 'assets'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(source, 'tool.exe'), 'binary')
    writeFileSync(join(source, 'assets', 'config.json'), '{}')
    writeFileSync(join(outside, 'private.txt'), 'outside')
    symlinkSync(outside, join(source, 'linked-dir'), 'junction')

    copyPackageDirectory(source, target)

    assert.equal(readFileSync(join(target, 'tool.exe'), 'utf8'), 'binary')
    assert.equal(readFileSync(join(target, 'assets', 'config.json'), 'utf8'), '{}')
    assert.equal(existsSync(join(target, 'linked-dir')), false)
  } finally {
    rawFilesystem.rmSync(root, { recursive: true, force: true })
  }
})

test('keeps the required entry when an optional resource path conflicts', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-safe-copy-conflict-'))
  try {
    const source = join(root, 'source')
    const target = join(root, 'target')
    mkdirSync(join(source, 'assets'), { recursive: true })
    mkdirSync(target)
    writeFileSync(join(source, 'tool.exe'), 'binary')
    writeFileSync(join(source, 'assets', 'config.json'), '{}')
    writeFileSync(join(target, 'assets'), 'conflict')

    const result = copyPackageDirectory(source, target, { requiredEntry: 'tool.exe' })

    assert.equal(readFileSync(join(target, 'tool.exe'), 'utf8'), 'binary')
    assert.deepEqual(result.skippedPaths, ['assets'])
  } finally {
    rawFilesystem.rmSync(root, { recursive: true, force: true })
  }
})

test('copies ASAR archives as opaque files under Electron', () => {
  const fixture = join(process.cwd(), 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar')
  if (!existsSync(fixture)) return
  const root = mkdtempSync(join(tmpdir(), 'autoforge-safe-copy-asar-'))
  try {
    const source = join(root, 'source')
    const target = join(root, 'target')
    mkdirSync(join(source, 'resources'), { recursive: true })
    rawFilesystem.copyFileSync(fixture, join(source, 'resources', 'app.asar'))

    const result = copyPackageDirectory(source, target)

    assert.deepEqual(result.skippedPaths, [])
    assert.deepEqual(
      rawFilesystem.readFileSync(join(target, 'resources', 'app.asar')),
      rawFilesystem.readFileSync(join(source, 'resources', 'app.asar'))
    )
  } finally {
    rawFilesystem.rmSync(root, { recursive: true, force: true })
  }
})
