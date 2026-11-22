import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const modal = readFileSync(new URL('./AppFeatureModal.vue', import.meta.url), 'utf8')

describe('shared workbench routes', () => {
  it('renders history, Hub, guide, and settings inside the current workspace view', () => {
    for (const component of ['ExecutionHistoryPanel', 'HubPluginCenterPanel', 'DevGuidePanel', 'SettingsPanel']) {
      assert.match(app, new RegExp('<' + component + '[\\s\\S]*:inline="true"'))
    }
  })

  it('keeps feature modal behavior by default and removes the overlay in inline mode', () => {
    assert.match(modal, /inline\?: boolean/)
    assert.match(modal, /:disabled="inline"/)
    assert.match(modal, /app-feature-modal-panel--inline/)
  })
})
