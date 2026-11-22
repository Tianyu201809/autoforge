import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeLlmProfile } from './provider-contract'

test('normalizes duplicate HTTP header names case-insensitively', () => {
  const profile = normalizeLlmProfile({
    id: 'profile-1',
    name: 'Compatible model',
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-1',
    timeoutSeconds: 60,
    extraHeaderNames: ['X-Tenant', 'x-tenant', 'X-Region']
  }, '2026-11-22T00:00:00.000Z')

  assert.deepEqual(profile.extraHeaderNames, ['X-Tenant', 'X-Region'])
})
