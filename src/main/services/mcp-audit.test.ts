import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import test from 'node:test'
import { McpAuditService } from './mcp-audit'

test('McpAuditService writes structured entries without values', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-mcp-audit-'))
  const audit = new McpAuditService(root)
  audit.record({
    ts: new Date(0).toISOString(),
    connectionId: 'c1',
    requestId: 'r1',
    operation: 'scripts.write',
    target: 'script-1',
    confirmed: true,
    outcome: 'success'
  })
  const content = readFileSync(join(root, 'mcp-audit.jsonl'), 'utf8')
  assert.match(content, /"operation":"scripts.write"/)
  assert.doesNotMatch(content, /password|token-value/)
})

test('McpAuditService rotates oversized files', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-mcp-audit-'))
  const audit = new McpAuditService(root, 1024 * 1024)
  audit.record({
    ts: new Date(0).toISOString(),
    connectionId: 'c1',
    requestId: 'r-large',
    operation: 'scripts.write',
    target: 'x'.repeat(1_100_000),
    confirmed: true,
    outcome: 'success'
  })
  assert.ok(statSync(join(root, 'mcp-audit.jsonl.1')).size > 0)
})
