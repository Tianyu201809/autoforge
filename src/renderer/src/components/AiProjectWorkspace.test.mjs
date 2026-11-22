import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const source = readFileSync(new URL('./AiProjectWorkspace.vue', import.meta.url), 'utf8')

describe('AI project workspace view', () => {
  it('supports folder-based project creation and model selection', () => {
    assert.match(source, /chooseProjectFolder/)
    assert.match(source, /profileId/)
    assert.match(source, /javascript/)
    assert.match(source, /python/)
  })

  it('provides conversation controls, retry, and an inspector toggle', () => {
    assert.match(source, /sendMessage/)
    assert.match(source, /cancelTurn/)
    assert.match(source, /retryChecks/)
    assert.match(source, /toggleInspector/)
  })
})
