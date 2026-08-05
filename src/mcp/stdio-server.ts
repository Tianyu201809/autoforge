import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { appEnv, type AppEnv } from '../shared/app-env'
import { createAutoforgeMcpServer } from './tool-definitions'
import { McpControlClient, McpControlClientError } from './control-client'

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function resolveArgs(argv: string[]): { appEnv: AppEnv; endpoint?: string; runtimeDirectory?: string } {
  const requested = readArg(argv, '--app-env')
  const selected: AppEnv = requested === 'development' ? 'development' : requested === 'production' ? 'production' : appEnv
  return {
    appEnv: selected,
    endpoint: readArg(argv, '--endpoint'),
    runtimeDirectory: readArg(argv, '--runtime-directory')
  }
}

export async function runStdioServer(argv = process.argv.slice(2)): Promise<void> {
  const options = resolveArgs(argv)
  const client = new McpControlClient()
  try {
    await client.connect(options)
  } catch (error) {
    if (!(error instanceof McpControlClientError) || error.code !== 'app_not_ready') {
      process.stderr.write(`[autoforge-mcp] ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  const server = createAutoforgeMcpServer(client)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  const close = (): void => {
    void client.close()
    void server.close()
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/stdio-server.ts') || process.argv[1]?.replace(/\\/g, '/').endsWith('/stdio-server.js')) {
  void runStdioServer()
}
