import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LlmProfile } from '../../../shared/ai-types'
import type { ModelCredentials } from './provider-contract'

const geminiModule = import('./gemini-provider').catch(() => null)

const profile: LlmProfile = {
  id: 'gemini-1',
  name: 'Gemini',
  provider: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.test/v1beta',
  model: 'gemini-test-flash',
  timeoutSeconds: 60,
  extraHeaderNames: [],
  createdAt: '2026-11-22T00:00:00.000Z',
  updatedAt: '2026-11-22T00:00:00.000Z'
}

const credentials: ModelCredentials = { apiKey: 'gemini-secret', extraHeaders: {} }

function sseResponse(...data: Record<string, unknown>[]): Response {
  return new Response(data.map((item) => `data: ${JSON.stringify(item)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

test('uses Gemini stream endpoint and API key header', async () => {
  const module = await geminiModule
  assert.ok(module, 'Gemini provider module should be available')
  let request: { url: string; init: RequestInit } | undefined
  const adapter = module.createGeminiProvider({
    request: async (url: string, init: RequestInit) => {
      request = { url, init }
      return sseResponse({ candidates: [{ content: { parts: [{ text: 'Hello' }] } }] })
    }
  })
  const events = []
  for await (const event of adapter.stream({ profile, credentials, messages: [{ role: 'user', content: 'Hi' }], tools: [] })) {
    events.push(event)
  }

  assert.equal(
    request?.url,
    'https://generativelanguage.googleapis.test/v1beta/models/gemini-test-flash:streamGenerateContent?alt=sse'
  )
  const headers = new Headers(request?.init.headers)
  assert.equal(headers.get('x-goog-api-key'), 'gemini-secret')
  assert.deepEqual(events, [
    { type: 'text_delta', text: 'Hello' },
    { type: 'complete', finishReason: undefined }
  ])
})

test('maps Gemini function calls, usage, and finish reason', async () => {
  const module = await geminiModule
  assert.ok(module, 'Gemini provider module should be available')
  const adapter = module.createGeminiProvider({
    request: async () => sseResponse({
      candidates: [{
        content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'src/main.js' } } }] },
        finishReason: 'STOP'
      }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 }
    })
  })
  const events = []
  for await (const event of adapter.stream({ profile, credentials, messages: [{ role: 'user', content: 'read file' }], tools: [] })) {
    events.push(event)
  }

  assert.equal(events[0]?.type, 'tool_call')
  assert.equal(events[0]?.type === 'tool_call' ? events[0].call.name : '', 'read_file')
  assert.equal(events[0]?.type === 'tool_call' ? events[0].call.argumentsJson : '', '{"path":"src/main.js"}')
  assert.equal(events[1]?.type, 'usage')
  assert.deepEqual(events.at(-1), { type: 'complete', finishReason: 'STOP' })
})
