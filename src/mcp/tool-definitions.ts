import { z } from 'zod'
import type { McpControlClient } from './control-client'
import { McpControlClientError } from './control-client'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAutoforgeResources } from './resource-definitions'

export interface AutoforgeToolDefinition {
  name: string
  description: string
  schema: Record<string, z.ZodTypeAny>
  method: string
  map?: (args: Record<string, unknown>) => unknown
}

const confirm = z.boolean()
const id = z.string().min(1)
const stringMap = z.record(z.string(), z.string())

export const AUTOFORGE_TOOL_DEFINITIONS: AutoforgeToolDefinition[] = [
  { name: 'autoforge_list_scripts', description: 'List Autoforge scripts and their current status.', schema: { query: z.string().optional(), status: z.enum(['all', 'running', 'idle', 'error']).optional(), archived: z.boolean().optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(100).optional(), sortBy: z.enum(['name', 'recentRun', 'importedAt']).optional(), sortOrder: z.enum(['asc', 'desc']).optional() }, method: 'scripts.list' },
  { name: 'autoforge_get_script', description: 'Get one Autoforge script, including schema metadata.', schema: { scriptId: id }, method: 'scripts.get' },
  { name: 'autoforge_list_script_files', description: 'List files in an Autoforge script workspace.', schema: { scriptId: id }, method: 'scripts.list-files' },
  { name: 'autoforge_read_script_file', description: 'Read a bounded script workspace file.', schema: { scriptId: id, relativePath: z.string().min(1), limit: z.number().int().positive().max(4 * 1024 * 1024).optional() }, method: 'scripts.read-file' },
  { name: 'autoforge_list_environments', description: 'List environment profiles without exposing secret values.', schema: { offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(100).optional() }, method: 'environments.list' },
  { name: 'autoforge_get_environment', description: 'Read one environment profile with secret values masked.', schema: { envId: id, scriptId: id.optional() }, method: 'environments.get' },
  { name: 'autoforge_list_sessions', description: 'List in-memory execution sessions.', schema: { scriptId: id.optional() }, method: 'sessions.list', map: (args) => args.scriptId ? args : args },
  { name: 'autoforge_get_session', description: 'Get one execution session.', schema: { sessionId: id }, method: 'sessions.get' },
  { name: 'autoforge_get_session_logs', description: 'Read incremental execution logs using a cursor.', schema: { sessionId: id, cursor: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(2000).optional() }, method: 'sessions.logs' },
  { name: 'autoforge_wait_for_session', description: 'Wait for a running execution to reach a terminal state.', schema: { sessionId: id, timeoutMs: z.number().int().positive().max(60000).optional() }, method: 'sessions.wait' },
  { name: 'autoforge_get_execution_history', description: 'Query persisted execution history.', schema: { scriptId: id.optional(), scriptName: z.string().optional(), date: z.string().optional(), days: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional(), status: z.string().optional(), trigger: z.string().optional() }, method: 'history.query' },
  { name: 'autoforge_start_script', description: 'Start a script asynchronously and return its session.', schema: { scriptId: id, envId: id.optional(), params: stringMap.optional(), persistParams: z.boolean().optional(), browserOverride: z.object({ headless: z.boolean().optional() }).optional(), confirm: z.boolean().optional() }, method: 'scripts.start' },
  { name: 'autoforge_stop_session', description: 'Stop one running execution session.', schema: { sessionId: id }, method: 'sessions.stop' },
  { name: 'autoforge_stop_script', description: 'Stop all running sessions for a script.', schema: { scriptId: id }, method: 'scripts.stop' },
  { name: 'autoforge_create_script', description: 'Create and validate a new script package. Requires confirm=true.', schema: { manifest: z.record(z.string(), z.unknown()), files: z.array(z.object({ path: z.string().min(1), content: z.string(), encoding: z.enum(['utf8', 'base64']).optional() })), confirm }, method: 'scripts.create' },
  { name: 'autoforge_import_script', description: 'Import an absolute local script file or directory. Requires confirm=true.', schema: { sourcePath: z.string().min(1), confirm }, method: 'scripts.import' },
  { name: 'autoforge_write_script_file', description: 'Atomically write a script workspace file. Requires confirm=true.', schema: { scriptId: id, relativePath: z.string().min(1), content: z.string(), encoding: z.enum(['utf8', 'base64']).optional(), confirm }, method: 'scripts.write-file' },
  { name: 'autoforge_update_script_meta', description: 'Update script metadata. Requires confirm=true.', schema: { scriptId: id, patch: z.record(z.string(), z.unknown()), confirm }, method: 'scripts.update-meta' },
  { name: 'autoforge_delete_script', description: 'Stop and delete a script. Requires confirm=true.', schema: { scriptId: id, confirm }, method: 'scripts.delete' },
  { name: 'autoforge_create_environment', description: 'Create an environment profile. Requires confirm=true.', schema: { profile: z.record(z.string(), z.unknown()), confirm }, method: 'environments.create' },
  { name: 'autoforge_update_environment', description: 'Update an environment profile. Requires confirm=true.', schema: { envId: id, patch: z.record(z.string(), z.unknown()), confirm }, method: 'environments.update' },
  { name: 'autoforge_delete_environment', description: 'Delete an environment profile. Requires confirm=true.', schema: { envId: id, confirm }, method: 'environments.delete' },
  { name: 'autoforge_set_script_env', description: 'Persist script environment values. Secret values are write-only. Requires confirm=true.', schema: { scriptId: id, envId: id, values: stringMap, confirm }, method: 'scripts.set-env' },
  { name: 'autoforge_set_script_params', description: 'Persist script parameters. Secret values are write-only. Requires confirm=true.', schema: { scriptId: id, envId: id, values: stringMap, confirm }, method: 'scripts.set-params' }
]

function successResult(value: unknown): CallToolResult {
  const payload = value && typeof value === 'object' ? value : { value }
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>
  }
}

function errorResult(error: unknown): CallToolResult {
  const value = error instanceof McpControlClientError
    ? { code: error.code, message: error.message, retryable: error.retryable, details: error.details }
    : { code: 'internal', message: error instanceof Error ? error.message : String(error), retryable: false }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value
  }
}

export function createAutoforgeMcpServer(client: McpControlClient): McpServer {
  const server = new McpServer({ name: 'autoforge', version: '1.23.1' })
  for (const definition of AUTOFORGE_TOOL_DEFINITIONS) {
    server.registerTool(definition.name, {
      description: definition.description,
      inputSchema: definition.schema
    }, async (args) => {
      try {
        const mapped = definition.map ? definition.map(args as Record<string, unknown>) : args
        const value = await client.request(definition.method, mapped)
        return successResult(value)
      } catch (error) {
        return errorResult(error)
      }
    })
  }
  registerAutoforgeResources(server, client)
  return server
}
