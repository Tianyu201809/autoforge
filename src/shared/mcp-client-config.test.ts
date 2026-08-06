import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpClientConfig } from './mcp-types'
import { formatCodexMcpAddCommand, formatCodexMcpToml, formatGenericMcpJson } from './mcp-client-config'

const config: McpClientConfig = {
  command: 'npm.cmd',
  args: ['--prefix', 'C:\\personal\\autoforge', 'run', 'mcp', '--', '--app-env', 'development'],
  appEnv: 'development',
  displayCommand: 'npm.cmd --prefix C:\\personal\\autoforge run mcp -- --app-env development'
}

test('Codex MCP config preserves the executable and every argument boundary', () => {
  const toml = formatCodexMcpToml(config)
  assert.match(toml, /^\[mcp_servers\.autoforge\]$/m)
  assert.match(toml, /^command = "npm\.cmd"$/m)
  assert.match(toml, /^args = \["--prefix", "C:\\\\personal\\\\autoforge", "run", "mcp", "--", "--app-env", "development"\]$/m)
  assert.doesNotMatch(toml, /command = "npm run mcp"/)
  assert.doesNotMatch(toml, /"--app-env development"/)
})

test('Codex CLI command quotes paths without merging MCP arguments', () => {
  assert.equal(
    formatCodexMcpAddCommand(config),
    'codex mcp add autoforge -- npm.cmd --prefix C:\\personal\\autoforge run mcp -- --app-env development'
  )
})

test('Codex CLI command preserves backslashes in a quoted Windows path', () => {
  const spacedConfig: McpClientConfig = {
    ...config,
    args: ['--prefix', 'C:\\Program Files\\Autoforge', 'run', 'mcp', '--', '--app-env', 'development']
  }
  assert.equal(
    formatCodexMcpAddCommand(spacedConfig),
    'codex mcp add autoforge -- npm.cmd --prefix "C:\\Program Files\\Autoforge" run mcp -- --app-env development'
  )
})

test('generic MCP JSON retains command and args arrays', () => {
  assert.deepEqual(JSON.parse(formatGenericMcpJson(config)), {
    mcpServers: {
      autoforge: {
        command: 'npm.cmd',
        args: ['--prefix', 'C:\\personal\\autoforge', 'run', 'mcp', '--', '--app-env', 'development']
      }
    }
  })
})
