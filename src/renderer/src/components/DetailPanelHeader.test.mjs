import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const source = readFileSync(new URL('./DetailPanel.vue', import.meta.url), 'utf8')

describe('Detail panel responsive header', () => {
  it('keeps the title and language card together above the tools when narrow', () => {
    assert.match(source, /class="[^"]*detail-panel[^"]*"/)
    assert.match(source, /container-type:\s*inline-size/)
    assert.match(source, /@container\s*\(max-width:\s*620px\)/)
    assert.match(source, /whitespace-nowrap shrink-0/)
    assert.match(source, /@container[^}]*\.detail-panel-header\s*\{[^}]*display:\s*grid/s)
    assert.match(source, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+6rem/)
    assert.match(source, /\.detail-panel-header-actions\s*\{[^}]*display:\s*contents/s)
    assert.match(source, /\.detail-panel-language-badge\s*\{[^}]*grid-column:\s*2/s)
    assert.match(source, /\.detail-panel-header-tools\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s)
  })

  it('shows the script language above the header actions', () => {
    assert.match(
      source,
      /import\s*\{[^}]*scriptLanguageBadge[^}]*scriptLanguageTitle[^}]*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/shared\/script-language['"]/s
    )
    assert.match(
      source,
      /const languageBadge = computed\(\(\) => scriptLanguageBadge\(props\.script\.language\)\)/
    )
    assert.match(source, /class="detail-panel-language-badge"/)
    assert.match(source, /\{\{ languageBadge\.label \}\}/)
    assert.match(source, /scriptLanguageTitle\(script\.language\)/)
    assert.match(source, /\.detail-panel-language-badge\s*\{[^}]*width:\s*6rem/s)
    assert.match(source, /\.detail-panel-language-badge\s*\{[^}]*height:\s*3\.25rem/s)
    assert.match(source, /\.detail-panel-language-badge\s*\{[^}]*font-size:\s*1\.5rem/s)
    assert.match(source, /\.detail-panel-language-badge\s*\{[^}]*border-radius:\s*0\.75rem/s)
    assert.match(source, /\.detail-panel-language-badge\s*\{[^}]*background-color:\s*transparent/s)
    assert.match(source, /\.detail-panel-language-badge\s*\{[^}]*box-shadow:/s)
  })
})
