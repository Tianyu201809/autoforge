import assert from 'node:assert/strict'
import { test } from 'node:test'

const providerContract = import('./provider-contract').catch(() => null)

async function contract() {
  const value = await providerContract
  assert.ok(value, 'provider contract module must be available')
  return value
}

const profileInput = {
  id: '  profile-1  ',
  name: '  DeepSeek  ',
  provider: 'openai-compatible' as const,
  baseUrl: ' HTTPS://API.EXAMPLE.COM/v1/ ',
  model: ' deepseek-chat ',
  timeoutSeconds: 60,
  extraHeaderNames: ['X-Tenant'],
  presetId: 'deepseek'
}

test('normalizes provider profiles', async () => {
  const { normalizeLlmProfile } = await contract()
  const profile = normalizeLlmProfile(profileInput, '2026-11-22T00:00:00.000Z')

  assert.deepEqual(profile, {
    id: 'profile-1',
    name: 'DeepSeek',
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    model: 'deepseek-chat',
    timeoutSeconds: 60,
    extraHeaderNames: ['X-Tenant'],
    presetId: 'deepseek',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z'
  })
})

test('rejects profiles without an HTTP endpoint or model', async () => {
  const { normalizeLlmProfile } = await contract()
  assert.throws(
    () => normalizeLlmProfile({ ...profileInput, baseUrl: '' }, '2026-11-22T00:00:00.000Z'),
    /接口地址/
  )
  assert.throws(
    () => normalizeLlmProfile({ ...profileInput, model: ' ' }, '2026-11-22T00:00:00.000Z'),
    /模型名称/
  )
  assert.throws(
    () => normalizeLlmProfile({ ...profileInput, baseUrl: 'file:///tmp/model' }, '2026-11-22T00:00:00.000Z'),
    /HTTP 或 HTTPS/
  )
})

test('profile view reports credentials without exposing their values', async () => {
  const { normalizeLlmProfile, toLlmProfileView } = await contract()
  const profile = normalizeLlmProfile(profileInput, '2026-11-22T00:00:00.000Z')
  const view = toLlmProfileView(profile, {
    apiKey: 'sentinel-api-key',
    extraHeaders: { 'X-Tenant': 'sentinel-header-value' }
  })

  assert.equal(view.hasApiKey, true)
  assert.equal(view.hasCredentials, true)
  assert.deepEqual(view.extraHeaderNames, ['X-Tenant'])
  assert.equal('apiKey' in view, false)
  assert.equal('extraHeaders' in view, false)
  assert.equal(JSON.stringify(view).includes('sentinel'), false)
})

test('reports header-only credentials as configured without exposing values', async () => {
  const { normalizeLlmProfile, toLlmProfileView } = await contract()
  const profile = normalizeLlmProfile(profileInput, '2026-11-22T00:00:00.000Z')
  const view = toLlmProfileView(profile, { extraHeaders: { 'X-Tenant': 'sentinel-header-value' } })

  assert.equal(view.hasApiKey, false)
  assert.equal(view.hasCredentials, true)
  assert.equal(JSON.stringify(view).includes('sentinel-header-value'), false)
})
