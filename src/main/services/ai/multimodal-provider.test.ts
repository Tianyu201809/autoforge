import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOpenAiProvider } from './openai-provider'
import { createAnthropicProvider } from './anthropic-provider'
import { createGeminiProvider } from './gemini-provider'
import type { LlmProfile } from '../../../shared/ai-types'

for (const [name, create, expected] of [
  ['openai', createOpenAiProvider, [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } }]],
  ['anthropic', createAnthropicProvider, [{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }]],
  ['gemini', createGeminiProvider, [{ text: 'look' }, { inlineData: { mimeType: 'image/png', data: 'YWJj' } }]]
] as const) {
  test(`${name} serializes ordered native image and text parts`, async () => {
    let body: Record<string, any> = {}
    const adapter = create({ request: async (_url, init) => { body = JSON.parse(String(init.body)); return new Response('data: '+(name === 'openai' ? '[DONE]' : name === 'anthropic' ? '{"type":"message_stop"}' : '{}')+'\n\n') } })
    const profile: LlmProfile = { id:'p', name:'test', provider:name, baseUrl:'https://test.invalid/v1', model:'test', timeoutSeconds:10, extraHeaderNames:[], createdAt:'now', updatedAt:'now' }
    for await (const _event of adapter.stream({ profile, credentials: { apiKey:'test', extraHeaders:{} }, tools:[], messages:[{ role:'user', content:'look', parts:[{ type:'text', text:'look' }, { type:'image', mimeType:'image/png', data:'YWJj' }] }] })) { /* consume */ }
    assert.deepEqual(name === 'gemini' ? body.contents[0].parts : body.messages[0].content, expected)
  })
}
