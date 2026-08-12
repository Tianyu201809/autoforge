import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { removePathBestEffort } from './filesystem-cleanup'

test('cleanup failures never replace the import result or original error', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-cleanup-'))
  try {
    assert.doesNotThrow(() => {
      removePathBestEffort(root, () => {
        throw new TypeError("Cannot read properties of null (reading 'isDirectory')")
      })
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
