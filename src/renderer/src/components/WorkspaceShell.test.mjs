import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./WorkspaceShell.vue', import.meta.url), 'utf8')
const contextSidebar = readFileSync(new URL('./WorkspaceContextSidebar.vue', import.meta.url), 'utf8')

test('uses one continuous separator to resize the full context sidebar', () => {
  assert.match(source, /\.workspace-resizer \{[\s\S]*?width: 5px;[\s\S]*?margin-inline: -2px;/)
  assert.match(source, /workspace-resizer--context-edge/)
  assert.match(source, /aria-label="调整上下文侧栏宽度"/)
  assert.match(contextSidebar, /class="workspace-context"[^>]*:style="\{ width: `\$\{width\}px` \}"/)
  assert.match(source, /\.workspace-resizer--context-edge \{[\s\S]*?width: 9px;[\s\S]*?margin-left: -4px;/)
})
