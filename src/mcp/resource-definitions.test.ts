import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTOFORGE_RESOURCE_URIS } from './resource-definitions'

test('MCP resources contain only the approved read-only templates', () => {
  assert.deepEqual([...AUTOFORGE_RESOURCE_URIS], [
    'autoforge://app/status',
    'autoforge://scripts',
    'autoforge://scripts/{scriptId}/manifest',
    'autoforge://sessions/{sessionId}',
    'autoforge://sessions/{sessionId}/logs'
  ])
})
