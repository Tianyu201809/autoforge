import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const source = readFileSync(new URL('./ModelProfilesView.vue', import.meta.url), 'utf8')

describe('AI model settings view', () => {
  it('offers provider and endpoint editing with connection testing', () => {
    assert.match(source, /provider/)
    assert.match(source, /baseUrl/)
    assert.match(source, /model/)
    assert.match(source, /测试连接/)
  })

  it('keeps credentials write-only and exposes their configured state', () => {
    assert.match(source, /type="password"/)
    assert.match(source, /hasApiKey/)
    assert.match(source, /find\(\(profile\) => profile\.id === state\.editingProfileId\.value\)\?\.hasCredentials/)
    assert.match(source, /保存/)
    assert.match(source, /清除密钥/)
  })
})
