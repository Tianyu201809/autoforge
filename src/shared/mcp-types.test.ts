import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpClientConfig, McpStatus, SanitizedEnvironment } from './mcp-types'

test('MCP status and client config remain token-free DTOs', () => {
  const status: McpStatus = {
    enabled: true,
    running: true,
    appVersion: '1.23.1',
    appEnv: 'development',
    transport: 'unix-socket',
    endpoint: '/tmp/autoforge.sock',
    connectionCount: 1
  }
  const config: McpClientConfig = {
    command: 'Autoforge',
    args: ['--mcp-stdio', '--app-env', 'development'],
    appEnv: 'development',
    displayCommand: 'Autoforge --mcp-stdio --app-env development'
  }
  const sanitized: SanitizedEnvironment = {
    id: 'env-1',
    name: 'dev',
    variables: { API_URL: 'https://example.test', TOKEN: { present: true } },
    variableKeys: ['API_URL', 'TOKEN']
  }

  assert.equal('token' in status, false)
  assert.equal('token' in config, false)
  assert.deepEqual(sanitized.variables.TOKEN, { present: true })
})
