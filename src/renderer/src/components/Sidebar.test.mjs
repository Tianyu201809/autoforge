import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const sidebarSource = readFileSync(new URL('./Sidebar.vue', import.meta.url), 'utf8')

describe('Sidebar category actions', () => {
  it('uses the application prompt dialog for category names', () => {
    assert.match(sidebarSource, /import \{ askPrompt \} from '\.\.\/composables\/usePromptDialog'/)
    assert.doesNotMatch(sidebarSource, /window\.prompt/)
  })

  it('aligns top-level categories and uses a pencil for management', () => {
    assert.match(sidebarSource, /import \{[^}]*Pencil[^}]*\} from 'lucide-vue-next'/)
    assert.doesNotMatch(sidebarSource, /import \{[^}]*Plus[^}]*\} from 'lucide-vue-next'/)
    assert.match(sidebarSource, /<Pencil class="w-3\.5 h-3\.5" :stroke-width="1\.5" \/>/)
    assert.match(sidebarSource, /flex-1 min-h-0 overflow-y-auto overscroll-contain/)
    assert.match(sidebarSource, /overflow-y-auto overscroll-contain -mx-1/)
    assert.doesNotMatch(sidebarSource, /overflow-y-auto overscroll-contain -mx-1 px-1/)
  })
})
