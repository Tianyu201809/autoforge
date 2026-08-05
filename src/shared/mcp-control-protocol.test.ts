import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MCP_LIMITS,
  parseControlMessage,
  serializeControlMessage,
  type ControlRequest,
  type ControlResponse
} from './mcp-control-protocol'

test('control protocol serializes and parses requests', () => {
  const request: ControlRequest = {
    type: 'request',
    id: '42',
    method: 'scripts.get',
    params: { scriptId: 'abc' }
  }
  const parsed = parseControlMessage(serializeControlMessage(request).trim())
  assert.deepEqual(parsed, request)
})

test('control protocol parses structured errors', () => {
  const response: ControlResponse = {
    type: 'response',
    id: '42',
    ok: false,
    error: { code: 'not_found', message: 'missing', retryable: false }
  }
  assert.deepEqual(parseControlMessage(JSON.stringify(response)), response)
})

test('control protocol rejects malformed messages', () => {
  assert.throws(() => parseControlMessage(JSON.stringify({ type: 'request', id: '' })))
  assert.throws(() => parseControlMessage(JSON.stringify({ type: 'event', event: 'unknown' })))
})

test('control limits are explicit and bounded', () => {
  assert.equal(MCP_LIMITS.maxFrameBytes, 8 * 1024 * 1024)
  assert.equal(MCP_LIMITS.maxFileBytes, 4 * 1024 * 1024)
  assert.equal(MCP_LIMITS.maxWaitTimeoutMs, 60_000)
})
