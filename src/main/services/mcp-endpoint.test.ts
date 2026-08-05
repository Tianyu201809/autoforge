import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import test from 'node:test'
import { MCP_PROTOCOL_VERSION } from '../../shared/mcp-control-protocol'
import { createMcpEndpointDescriptor, getMcpDescriptorPath, readMcpEndpointDescriptor, removeMcpEndpointDescriptor, writeMcpEndpointDescriptor } from './mcp-endpoint'

test('MCP endpoint descriptors round-trip with a runtime-only token', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'autoforge-mcp-endpoint-'))
  const descriptor = createMcpEndpointDescriptor('1.23.1', 'development', {
    runtimeDirectory: runtime,
    endpoint: process.platform === 'win32' ? `\\\\.\\pipe\\autoforge-test-${process.pid}` : join(runtime, 'mcp.sock')
  })
  assert.equal(descriptor.protocolVersion, MCP_PROTOCOL_VERSION)
  assert.equal(descriptor.token.length, 64)
  writeMcpEndpointDescriptor(descriptor, runtime)
  assert.ok(existsSync(getMcpDescriptorPath('development', runtime)))
  assert.equal(readFileSync(getMcpDescriptorPath('development', runtime), 'utf8').includes(descriptor.token), true)
  assert.deepEqual(readMcpEndpointDescriptor('development', runtime), descriptor)
  removeMcpEndpointDescriptor('development', descriptor, runtime)
  assert.equal(readMcpEndpointDescriptor('development', runtime), null)
})
