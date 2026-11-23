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
    assert.match(source, /清除凭据/)
  })

  it('opens the profile form only after the user starts creating or editing a profile', () => {
    assert.match(source, /<AppFeatureModal :open="formOpen"/)
    assert.match(source, /@close="closeForm\(\)"/)
    assert.match(source, /class="model-profile-form"/)
  })

  it('shows a dedicated empty state instead of an empty profile form', () => {
    assert.match(source, /还没有模型配置/)
    assert.match(source, /v-else-if="!state\.profiles\.value\.length"/)
    assert.match(source, /v-if="state\.profiles\.value\.length" type="button" class="model-primary-button" @click="startNewProfile"/)
  })
})
