import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const sidebarSource = readFileSync(new URL('./Sidebar.vue', import.meta.url), 'utf8')

describe('Sidebar category actions', () => {
  it('uses the application prompt dialog for category names', () => {
    assert.match(sidebarSource, /import \{ askPrompt \} from '\.\.\/composables\/usePromptDialog'/)
    assert.doesNotMatch(sidebarSource, /window\.prompt/)
  })
})
