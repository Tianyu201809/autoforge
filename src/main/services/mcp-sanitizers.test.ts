import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeEnvironment, sanitizeLogLine, sanitizeScriptItem, sanitizeSession } from './mcp-sanitizers'

test('MCP sanitizers preserve public values and hide secrets', () => {
  const script = {
    id: 'script-1', name: 'Demo', description: '', workspacePath: '', category: 'local', categoryLabel: 'Local', categoryColor: '', icon: 'app-window' as const, iconColor: '', iconBg: '', iconBorder: '', version: '1.0.0', starred: false, archived: false,
    envSchema: [{ key: 'PUBLIC', label: 'Public' }, { key: 'TOKEN', label: 'Token', secret: true }], paramSchema: [{ key: 'PASSWORD', label: 'Password', secret: true }], entry: 'index.mjs', language: 'javascript' as const,
    configByEnv: { dev: { PUBLIC: 'yes', TOKEN: 'raw-token' } }, paramsByEnv: { dev: { PASSWORD: 'raw-password' } }, savedParams: { PASSWORD: 'raw-password' }, status: 'idle' as const, meta: '', activeSessionCount: 0
  }
  const sanitized = sanitizeScriptItem(script)
  assert.deepEqual(sanitized.configByEnv, { dev: { PUBLIC: 'yes' } })
  assert.deepEqual(sanitized.paramsByEnv, { dev: {} })
  assert.equal(JSON.stringify(sanitized).includes('raw-token'), false)
  assert.equal(sanitizeEnvironment({ id: 'env-1', name: 'Dev', variables: { TOKEN: 'raw-token' } }).variables.TOKEN?.present, true)
  assert.equal(sanitizeLogLine({ sessionId: 's', ts: '', level: 'INFO', message: 'token=raw-token' }).message.includes('raw-token'), false)
  assert.equal(JSON.stringify(sanitizeSession({ id: 's', scriptId: 'script-1', status: 'success', startedAt: '', result: { token: 'raw-token' } })).includes('raw-token'), false)
})
