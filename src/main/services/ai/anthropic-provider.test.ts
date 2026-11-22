import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LlmProfile } from '../../../shared/ai-types'
import type { ModelCredentials } from './provider-contract'

const anthropicModule = import('./anthropic-provider').catch(() => null)

const profile: LlmProfile = {
  id: 'anthropic-1',
  name: 'Anthropic',
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.test/v1',
  model: 'claude-sonnet-test',
  timeoutSeconds: 60,
  extraHeaderNames: [],
  createdAt: '2026-11-22T00:00:00.000Z',
  updatedAt: '2026-11-22T00:00:00.000Z'
}

const credentials: ModelCredentials = { apiKey: 'anthropic-secret', extraHeaders: {} }

function sseResponse(...events: Array<{ event: string; data: Record<string, unknown> }>): Response {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

test('sends Anthropic authentication and maps message text and usage', async () => {
  const module = await anthropicModule
  assert.ok(module, 'Anthropic provider module should be available')
  let request: { url: string; init: RequestInit } | undefined
  const adapter = module.createAnthropicProvider({
    request: async (url: string, init: RequestInit) => {
      request = { url, init }
      return sseResponse(
        { event: 'message_start', data: { type: 'message_start', message: { usage: { input_tokens: 5 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } } },
        { event: 'message_stop', data: { type: 'message_stop' } }
      )
    }
  })
  const events = []
  for await (const event of adapter.stream({
    profile,
    credentials,
    messages: [{ role: 'system', content: 'Be concise' }, { role: 'user', content: 'Hi' }],
    tools: []
  })) events.push(event)

  assert.equal(request?.url, 'https://api.anthropic.test/v1/messages')
  const headers = new Headers(request?.init.headers)
  assert.equal(headers.get('x-api-key'), 'anthropic-secret')
  assert.equal(headers.get('anthropic-version'), '2023-06-01')
  const body = JSON.parse(String(request?.init.body)) as { system?: string }
  assert.equal(body.system, 'Be concise')
  assert.deepEqual(events, [
    { type: 'text_delta', text: 'Hello' },
    { type: 'usage', promptTokens: 5, completionTokens: 2 },
    { type: 'complete', finishReason: 'end_turn' }
  ])
})

test('assembles Anthropic tool input JSON deltas into one call', async () => {
  const module = await anthropicModule
  assert.ok(module, 'Anthropic provider module should be available')
  const adapter = module.createAnthropicProvider({
    request: async () => sseResponse(
      { event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'read_file', input: {} } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"src/a.js"}' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
      { event: 'message_stop', data: { type: 'message_stop' } }
    )
  })
  const calls = []
  for await (const event of adapter.stream({ profile, credentials, messages: [{ role: 'user', content: 'read file' }], tools: [] })) {
    if (event.type === 'tool_call') calls.push(event.call)
  }

  assert.deepEqual(calls, [{ id: 'tool-1', name: 'read_file', argumentsJson: '{"path":"src/a.js"}' }])
})

test('does not leak credentials from Anthropic error responses', async () => {
  const module = await anthropicModule
  assert.ok(module, 'Anthropic provider module should be available')
  const adapter = module.createAnthropicProvider({
    request: async () => new Response('anthropic-secret backend trace', { status: 401 })
  })

  await assert.rejects(
    async () => {
      for await (const _event of adapter.stream({ profile, credentials, messages: [], tools: [] })) void _event
    },
    (error: Error) => {
      assert.equal(error.message.includes('anthropic-secret'), false)
      assert.equal(error.message.includes('backend trace'), false)
      return true
    }
  )
})
