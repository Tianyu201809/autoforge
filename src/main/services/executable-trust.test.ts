import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import type { ScriptMeta } from '../../shared/types/script'
import {
  ExecutableAuthorizationCancelledError,
  ExecutableTrustService,
  sha256File,
  type ExecutableTrustStore
} from './executable-trust'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function pe(): Buffer {
  const value = Buffer.alloc(512); value.write('MZ'); value.writeUInt32LE(0x80, 0x3c)
  value.write('PE\0\0', 0x80, 'binary'); value.writeUInt16LE(0x8664, 0x84); value.writeUInt16LE(2, 0x96)
  return value
}

function fixture(): { script: ScriptMeta; entryPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-trust-')); roots.push(root)
  const entryPath = join(root, 'tool.exe'); writeFileSync(entryPath, pe())
  return {
    entryPath,
    script: {
      id: 'native-1', name: 'Tool', description: '', workspacePath: root,
      category: 'local', categoryLabel: '本地', categoryColor: '', icon: 'terminal',
      iconColor: '', iconBg: '', iconBorder: '', version: '1.0.0', entry: 'tool.exe',
      language: 'executable', envSchema: [], paramSchema: []
    }
  }
}

function fakeStore(): ExecutableTrustStore & { rows: Set<string> } {
  const rows = new Set<string>()
  const key = (scriptId: string, entry: string, sha256: string): string => `${scriptId}|${entry}|${sha256}`
  return {
    rows,
    has: (scriptId, entry, sha256) => rows.has(key(scriptId, entry, sha256)),
    grant: (scriptId, entry, sha256) => { rows.add(key(scriptId, entry, sha256)) },
    deleteForScript: (scriptId) => {
      for (const value of rows) if (value.startsWith(`${scriptId}|`)) rows.delete(value)
    }
  }
}

test('prompts once and reuses trust for unchanged bytes', async () => {
  const { script } = fixture(); const store = fakeStore(); let prompts = 0
  const service = new ExecutableTrustService(store, async () => { prompts += 1; return true }, 'win32')
  await service.authorize({ script, interactive: true })
  await service.authorize({ script, interactive: true })
  assert.equal(prompts, 1)
})

test('requires a new confirmation after bytes change', async () => {
  const { script, entryPath } = fixture(); const store = fakeStore(); let prompts = 0
  const service = new ExecutableTrustService(store, async () => { prompts += 1; return true }, 'win32')
  await service.authorize({ script, interactive: true })
  appendFileSync(entryPath, Buffer.from([0]))
  await service.authorize({ script, interactive: true })
  assert.equal(prompts, 2)
})

test('rejects untrusted non-interactive runs and accepts pretrusted bytes', () => {
  const { script, entryPath } = fixture(); const store = fakeStore()
  const service = new ExecutableTrustService(store, async () => true, 'win32')
  assert.throws(() => service.requireTrusted(script), /需要先在 Autoforge 中手动确认运行/)
  store.grant(script.id, script.entry, sha256File(entryPath))
  assert.equal(service.requireTrusted(script).sha256, sha256File(entryPath))
})

test('does not grant when bytes change during confirmation', async () => {
  const { script, entryPath } = fixture(); const store = fakeStore()
  const service = new ExecutableTrustService(store, async () => {
    appendFileSync(entryPath, Buffer.from([1])); return true
  }, 'win32')
  await assert.rejects(() => service.authorize({ script, interactive: true }), /入口文件已变化/)
  assert.equal(store.rows.size, 0)
})

test('uses a distinct cancellation error without granting trust', async () => {
  const { script } = fixture(); const store = fakeStore()
  const service = new ExecutableTrustService(store, async () => false, 'win32')
  await assert.rejects(
    () => service.authorize({ script, interactive: true }),
    ExecutableAuthorizationCancelledError
  )
  assert.equal(store.rows.size, 0)
})
