import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LlmProfile, LlmStreamEvent } from '../../../shared/ai-types'
import type { ModelCredentials } from './provider-contract'
import { createModelProfileService } from './model-profile-service'

const profile = (id: string, provider: LlmProfile['provider'] = 'openai'): LlmProfile => ({
  id,
  name: `Profile ${id}`,
  provider,
  baseUrl: 'https://api.example.test/v1',
  model: 'model-test',
  timeoutSeconds: 30,
  extraHeaderNames: [],
  createdAt: '2026-11-22T00:00:00.000Z',
  updatedAt: '2026-11-22T00:00:00.000Z'
})

function setup(stream: (credentials: ModelCredentials) => AsyncIterable<LlmStreamEvent> = async function* () {
  yield { type: 'text_delta', text: 'OK' }
  yield { type: 'complete', finishReason: 'stop' }
}) {
  let state: { profiles: LlmProfile[]; activeProfileId?: string } = { profiles: [] }
  const storedCredentials = new Map<string, ModelCredentials>()
  const service = createModelProfileService({
    load: () => state,
    save: (next) => { state = next },
    credentials: {
      get: (id) => storedCredentials.get(id) ?? null,
      set: (id, value) => { storedCredentials.set(id, value) },
      delete: (id) => { storedCredentials.delete(id) },
      isPersistent: () => true
    },
    providers: {
      openai: { stream: ({ credentials }) => stream(credentials) },
      anthropic: { stream: ({ credentials }) => stream(credentials) },
      gemini: { stream: ({ credentials }) => stream(credentials) },
      'openai-compatible': { stream: ({ credentials }) => stream(credentials) }
    },
    now: () => '2026-11-22T01:00:00.000Z'
  })
  return { service, storedCredentials, readState: () => state }
}

test('keeps profile metadata and secret credentials in separate stores', () => {
  const { service, storedCredentials, readState } = setup()
  service.upsertProfile({ profile: { ...profile('first'), createdAt: undefined, updatedAt: undefined } })
  service.setCredentials('first', { apiKey: 'secret', extraHeaders: { 'X-Team': 'alpha' } })

  assert.equal(readState().profiles[0].name, 'Profile first')
  assert.equal(JSON.stringify(readState()).includes('secret'), false)
  assert.deepEqual(storedCredentials.get('first'), { apiKey: 'secret', extraHeaders: { 'X-Team': 'alpha' } })
  assert.equal(service.listProfiles().profiles[0].hasApiKey, true)
})

test('selects another profile when the active profile is deleted', () => {
  const { service } = setup()
  service.upsertProfile({ profile: { ...profile('first'), createdAt: undefined, updatedAt: undefined } })
  service.upsertProfile({ profile: { ...profile('second'), createdAt: undefined, updatedAt: undefined } })
  service.setActiveProfile('first')

  assert.equal(service.deleteProfile('first'), true)
  assert.equal(service.listProfiles().activeProfileId, 'second')
})

test('redacts provider errors from connection test results', async () => {
  const { service } = setup(async function* () {
    yield { type: 'text_delta', text: 'partial output' }
    throw new Error('request failed with secret-key and response body')
  })
  service.upsertProfile({ profile: { ...profile('first'), createdAt: undefined, updatedAt: undefined } })
  service.setCredentials('first', { apiKey: 'secret-key', extraHeaders: {} })

  const result = await service.testProfile('first')
  assert.equal(result.ok, false)
  assert.equal(result.message.includes('secret-key'), false)
  assert.equal(result.message.includes('response body'), false)
})

test('rejects connection tests for unknown profiles', async () => {
  const { service } = setup()
  await assert.rejects(() => service.testProfile('missing'), /模型配置不存在/)
})
