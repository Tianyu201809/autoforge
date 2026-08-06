import assert from 'node:assert/strict'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import test from 'node:test'
import type { AutoforgeControlFacade } from './autoforge-control-facade'
import { McpAuditService } from './mcp-audit'
import { getMcpClientConfig, McpControlServer } from './mcp-control-server'
import { RunEventStore } from './run-event-store'
import { McpControlClient, McpControlClientError } from '../../mcp/control-client'

function fakeScript() {
  return {
    id: 'script-1',
    name: 'Demo',
    description: '',
    workspacePath: '',
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
    envSchema: [{ key: 'TOKEN', label: 'Token', secret: true }],
    paramSchema: [],
    entry: 'index.mjs',
    language: 'javascript' as const,
    status: 'idle' as const,
    meta: '',
    activeSessionCount: 0
  }
}

test('MCP control server authenticates and routes requests', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'autoforge-mcp-server-'))
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\autoforge-test-${process.pid}-${Date.now()}` : join(runtime, 'mcp.sock')
  const eventStore = new RunEventStore()
  const facade = {
    listScripts: () => ({ scripts: [fakeScript()], total: 1 }),
    getScript: () => fakeScript(),
    listScriptFiles: () => ({ entryPath: 'index.mjs', manifestPath: 'autoforge.json', files: ['index.mjs'] }),
    readScriptFile: () => ({ path: 'index.mjs', content: 'export default {}', binary: false, encoding: 'utf8' as const }),
    createScript: () => fakeScript(),
    importScript: () => fakeScript(),
    writeScriptFile: () => fakeScript(),
    updateScriptMeta: () => fakeScript(),
    deleteScript: () => true,
    listEnvironments: () => [],
    getEnvironment: () => null,
    createEnvironment: () => ({ id: 'env-1', name: 'Dev', variables: {} }),
    updateEnvironment: () => null,
    deleteEnvironment: () => true,
    setScriptEnv: () => fakeScript(),
    setScriptParams: () => fakeScript(),
    startScript: async () => ({ id: 'session-1', scriptId: 'script-1', status: 'running', startedAt: new Date().toISOString() }),
    stopSession: () => null,
    stopScript: () => undefined,
    listSessions: () => [],
    getSession: () => undefined,
    queryHistory: () => ({ records: [], total: 0, hasMore: false }),
    getConfig: () => ({})
  } as unknown as AutoforgeControlFacade
  const server = new McpControlServer({
    appVersion: '1.23.1',
    appEnv: 'development',
    facade,
    eventStore,
    audit: new McpAuditService(runtime),
    endpoint,
    runtimeDirectory: runtime
  })
  server.attachEventStore()
  await server.start()
  const client = new McpControlClient()
  await client.connect({ appEnv: 'development', runtimeDirectory: runtime })
  const list = await client.request<{ scripts: Array<{ id: string }>; total: number }>('scripts.list')
  assert.equal(list.total, 1)
  assert.equal(list.scripts[0]?.id, 'script-1')
  await assert.rejects(() => client.request('scripts.delete', { scriptId: 'script-1' }), (error: unknown) => error instanceof McpControlClientError && error.code === 'confirmation_required')
  const deleted = await client.request<{ deleted: boolean }>('scripts.delete', { scriptId: 'script-1', confirm: true })
  assert.equal(deleted.deleted, true)
  await client.close()
  await server.stop()
  eventStore.dispose()
})

test('development MCP config is directly executable outside the Autoforge workspace', () => {
  const config = getMcpClientConfig('development')
  assert.equal(config.command, process.platform === 'win32' ? 'npm.cmd' : 'npm')
  assert.deepEqual(config.args.slice(0, 2), ['--prefix', process.cwd()])
  assert.deepEqual(config.args.slice(-5), ['run', 'mcp', '--', '--app-env', 'development'])
})
