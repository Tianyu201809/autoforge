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

describe('script sidebar layout', () => {
  it('places script upload above search and navigation while keeping shortcuts at the bottom', () => {
    const uploadIndex = sidebarSource.indexOf('上传脚本')
    const searchIndex = sidebarSource.indexOf('id="sidebar-search"')
    const navigationIndex = sidebarSource.indexOf('<nav class="flex-shrink-0 px-2 space-y-0.5">')
    const shortcutsIndex = sidebarSource.indexOf('title="脚本中心"')
    assert.ok(uploadIndex > 0 && uploadIndex < searchIndex)
    assert.ok(uploadIndex < navigationIndex)
    assert.ok(shortcutsIndex > navigationIndex)
  })

  it('uses the full context sidebar width instead of keeping a second independent width', () => {
    assert.doesNotMatch(sidebarSource, /sidebarWidth|resize-handle-col/)
  })
})
