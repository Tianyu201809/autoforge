import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import test from 'node:test'
import { assertSafeWorkspacePath, readWorkspaceFileWithLimit, writeWorkspaceFileAtomic } from './mcp-workspace-io'

function script(workspacePath: string) {
  return {
    id: 'script-1',
    name: 'Demo',
    description: '',
    workspacePath,
    category: 'local',
    categoryLabel: 'Local',
    categoryColor: '',
    icon: 'app-window' as const,
    iconColor: '',
    iconBg: '',
    iconBorder: '',
    version: '1.0.0',
    starred: false,
    archived: false,
    envSchema: [],
    paramSchema: [],
    entry: 'index.mjs',
    language: 'javascript' as const
  }
}

test('MCP workspace paths reject traversal and symlink escapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-mcp-workspace-'))
  const outside = mkdtempSync(join(tmpdir(), 'autoforge-mcp-outside-'))
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  mkdirSync(join(root, 'nested'))
  symlinkSync(outside, join(root, 'escape'), 'junction')
  assert.throws(() => assertSafeWorkspacePath(root, '../secret.txt'), /path_forbidden/)
  assert.throws(() => assertSafeWorkspacePath(root, 'escape/secret.txt'), /path_forbidden/)
})

test('MCP manifest writes validate the package and roll back on failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-mcp-manifest-'))
  writeFileSync(join(root, 'index.mjs'), 'export default {}')
  writeFileSync(join(root, 'autoforge.json'), JSON.stringify({ autoforge: '1.0', name: 'Demo', entry: 'index.mjs', language: 'javascript' }))
  const meta = script(root)
  assert.throws(
    () => writeWorkspaceFileAtomic(meta, 'autoforge.json', JSON.stringify({ autoforge: '1.0', name: 'Demo', entry: 'missing.mjs', language: 'javascript' })),
    /validation_failed/
  )
})

test('MCP file reads enforce the configured size limit', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-mcp-read-'))
  writeFileSync(join(root, 'index.mjs'), '0123456789')
  assert.throws(() => readWorkspaceFileWithLimit(script(root), 'index.mjs', 4), /invalid_params/)
})
