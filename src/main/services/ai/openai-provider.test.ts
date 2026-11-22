import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LlmProfile } from '../../../shared/ai-types'
import type { ModelCredentials } from './provider-contract'

const openAiModule = import('./openai-provider').catch(() => null)
const compatibleModule = import('./openai-compatible-provider').catch(() => null)

const profile: LlmProfile = {
  id: 'profile-1',
  name: 'OpenAI',
  provider: 'openai',
  baseUrl: 'https://api.example.test/v1/',
  model: 'test-model',
  timeoutSeconds: 60,
  extraHeaderNames: ['X-Tenant'],
  createdAt: '2026-11-22T00:00:00.000Z',
  updatedAt: '2026-11-22T00:00:00.000Z'
}

const credentials: ModelCredentials = {
  apiKey: 'sentinel-key',
  extraHeaders: { 'X-Tenant': 'team-1' }
}

function sseResponse(...data: string[]): Response {
  const payload = data.map((item) => `data: ${item}\n\n`).join('')
  return new Response(payload, { headers: { 'Content-Type': 'text/event-stream' } })
}

test('streams OpenAI text and usage through normalized events', async () => {
  const module = await openAiModule
  assert.ok(module, 'OpenAI provider module should be available')
  const requests: Array<{ url: string; init: RequestInit }> = []
  const adapter = module.createOpenAiProvider({
    request: async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return sseResponse(
        '{"choices":[{"delta":{"content":"hello"}}]}',
        '{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1}}',
        '[DONE]'
      )
    }
  })
  const events = []
  for await (const event of adapter.stream({ profile, credentials, messages: [{ role: 'user', content: 'hi' }], tools: [] })) {
    events.push(event)
  }

  assert.equal(requests[0].url, 'https://api.example.test/v1/chat/completions')
  assert.deepEqual(events, [
    { type: 'text_delta', text: 'hello' },
    { type: 'usage', promptTokens: 4, completionTokens: 1 },
    { type: 'complete', finishReason: 'stop' }
  ])
})

test('assembles fragmented OpenAI tool call arguments', async () => {
  const module = await openAiModule
  assert.ok(module, 'OpenAI provider module should be available')
  const initialCall = JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"path":' } }] } }]
  })
  const remainingArguments = JSON.stringify({
    choices: [{
      delta: { tool_calls: [{ index: 0, function: { arguments: '"src/index.js"}' } }] },
      finish_reason: 'tool_calls'
    }]
  })
  const adapter = module.createOpenAiProvider({
    request: async () => sseResponse(
      initialCall,
      remainingArguments,
      '[DONE]'
    )
  })
  const calls = []
  for await (const event of adapter.stream({ profile, credentials, messages: [{ role: 'user', content: 'read file' }], tools: [] })) {
    if (event.type === 'tool_call') calls.push(event.call)
  }

  assert.deepEqual(calls, [{ id: 'call-1', name: 'read_file', argumentsJson: '{"path":"src/index.js"}' }])
})

test('does not include provider response bodies or key in HTTP errors', async () => {
  const module = await openAiModule
  assert.ok(module, 'OpenAI provider module should be available')
  const adapter = module.createOpenAiProvider({
    request: async () => new Response('sentinel-key provider trace', { status: 401 })
  })

  await assert.rejects(
    async () => {
      for await (const _event of adapter.stream({ profile, credentials, messages: [], tools: [] })) void _event
    },
    (error: Error) => {
      assert.equal(error.message.includes('sentinel-key'), false)
      assert.equal(error.message.includes('provider trace'), false)
      return true
    }
  )
})

test('compatible adapter uses the configured endpoint and custom headers', async () => {
  const module = await compatibleModule
  assert.ok(module, 'compatible provider module should be available')
  const requests: Array<{ url: string; init: RequestInit }> = []
  const compatibleProfile = { ...profile, provider: 'openai-compatible' as const }
  const adapter = module.createOpenAiCompatibleProvider({
    request: async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return sseResponse('[DONE]')
    }
  })
  for await (const _event of adapter.stream({ profile: compatibleProfile, credentials, messages: [], tools: [] })) void _event

  assert.equal(requests[0].url, 'https://api.example.test/v1/chat/completions')
  const headers = new Headers(requests[0].init.headers)
  assert.equal(headers.get('authorization'), 'Bearer sentinel-key')
  assert.equal(headers.get('x-tenant'), 'team-1')
})

test('normalizes compatible endpoints and includes model presets', async () => {
  const module = await compatibleModule
  assert.ok(module, 'compatible provider module should be available')

  assert.equal(module.normalizeOpenAiEndpoint('https://api.example.test/v1/'), 'https://api.example.test/v1/chat/completions')
  assert.deepEqual(
    module.OPENAI_COMPATIBLE_PRESETS.map((preset: { id: string }) => preset.id),
    ['openai', 'deepseek', 'qwen', 'glm', 'kimi', 'siliconflow']
  )
})
