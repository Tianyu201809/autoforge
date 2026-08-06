import type { McpClientConfig } from './mcp-types'

function quoteCommandArgument(value: string): string {
  if (/^[a-zA-Z0-9_./:\\=-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

function assertServerName(serverName: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(serverName)) throw new Error('invalid MCP server name')
}

export function formatMcpCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteCommandArgument).join(' ')
}

export function formatCodexMcpToml(config: McpClientConfig, serverName = 'autoforge'): string {
  assertServerName(serverName)
  const args = config.args.map((argument) => JSON.stringify(argument)).join(', ')
  return [
    `[mcp_servers.${serverName}]`,
    `command = ${JSON.stringify(config.command)}`,
    `args = [${args}]`,
    'startup_timeout_sec = 30'
  ].join('\n')
}

export function formatCodexMcpAddCommand(config: McpClientConfig, serverName = 'autoforge'): string {
  assertServerName(serverName)
  return ['codex', 'mcp', 'add', serverName, '--', config.command, ...config.args]
    .map(quoteCommandArgument)
    .join(' ')
}

export function formatGenericMcpJson(config: McpClientConfig, serverName = 'autoforge'): string {
  return JSON.stringify({
    mcpServers: {
      [serverName]: {
        command: config.command,
        args: config.args
      }
    }
  }, null, 2)
}
