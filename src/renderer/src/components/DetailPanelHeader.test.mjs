import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const source = readFileSync(new URL('./DetailPanel.vue', import.meta.url), 'utf8')

describe('Detail panel responsive header', () => {
  it('stacks header tools when the detail panel is narrow', () => {
    assert.match(source, /class="[^"]*detail-panel[^"]*"/)
    assert.match(source, /container-type:\s*inline-size/)
    assert.match(source, /@container\s*\(max-width:\s*620px\)/)
    assert.match(source, /whitespace-nowrap shrink-0/)
  })

  it('shows the script language above the header actions', () => {
    assert.match(
      source,
      /import\s*\{\s*scriptLanguageBadge\s*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/shared\/script-language['"]/
    )
    assert.match(
      source,
      /const languageBadge = computed\(\(\) => scriptLanguageBadge\(props\.script\.language\)\)/
    )
    assert.match(source, /class="detail-panel-language-badge"/)
    assert.match(source, /\{\{ languageBadge\.label \}\}/)
    assert.match(source, /script\.language === 'python' \? 'Python [^']+' : 'JavaScript [^']+'/)
  })
})
