import assert from 'node:assert/strict'
import test from 'node:test'
import { McpControlClient, McpControlClientError } from './control-client'

test('MCP control client reports app_not_ready without an endpoint', async () => {
  const client = new McpControlClient()
  await assert.rejects(
    () => client.connect({ appEnv: 'development', runtimeDirectory: `C:/autoforge-no-such-runtime-${process.pid}` }),
    (error: unknown) => error instanceof McpControlClientError && error.code === 'app_not_ready'
  )
})
