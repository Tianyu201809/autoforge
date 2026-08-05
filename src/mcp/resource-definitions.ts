import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpControlClient } from './control-client'

export const AUTOFORGE_RESOURCE_URIS = [
  'autoforge://app/status',
  'autoforge://scripts',
  'autoforge://scripts/{scriptId}/manifest',
  'autoforge://sessions/{sessionId}',
  'autoforge://sessions/{sessionId}/logs'
] as const

function jsonResource(uri: URL, value: unknown) {
  return {
    contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(value) }]
  }
}

export function registerAutoforgeResources(server: McpServer, client: McpControlClient): void {
  server.registerResource('autoforge_app_status', 'autoforge://app/status', { description: 'Autoforge MCP status' }, async (uri) => {
    return jsonResource(uri, await client.request('app.status'))
  })
  server.registerResource('autoforge_scripts', 'autoforge://scripts', { description: 'Autoforge script list' }, async (uri) => {
    return jsonResource(uri, await client.request('scripts.list'))
  })
  server.registerResource(
    'autoforge_script_manifest',
    new ResourceTemplate('autoforge://scripts/{scriptId}/manifest', { list: undefined }),
    { description: 'Autoforge script manifest' },
    async (uri, variables) => {
      const scriptId = String(variables.scriptId ?? '')
      const manifest = await client.request('scripts.read-file', { scriptId, relativePath: 'autoforge.json' })
      return jsonResource(uri, manifest)
    }
  )
  server.registerResource(
    'autoforge_session',
    new ResourceTemplate('autoforge://sessions/{sessionId}', { list: undefined }),
    { description: 'Autoforge execution session' },
    async (uri, variables) => jsonResource(uri, await client.request('sessions.get', { sessionId: String(variables.sessionId ?? '') }))
  )
  server.registerResource(
    'autoforge_session_logs',
    new ResourceTemplate('autoforge://sessions/{sessionId}/logs', { list: undefined }),
    { description: 'Autoforge execution session logs' },
    async (uri, variables) => jsonResource(uri, await client.request('sessions.logs', { sessionId: String(variables.sessionId ?? ''), cursor: 0, limit: 2000 }))
  )
}

export function createAutoforgeResourceServer(client: McpControlClient): McpServer {
  const server = new McpServer({ name: 'autoforge', version: '1.23.1' })
  registerAutoforgeResources(server, client)
  return server
}
