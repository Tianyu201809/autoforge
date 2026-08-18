import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const treeSource = readFileSync(new URL('./CategoryTreeNodes.vue', import.meta.url), 'utf8')

test('keeps hierarchy controls in flow so they stay visible', () => {
  assert.match(treeSource, /paddingLeft: `\$\{4 \+ depth \* 12\}px`/)
  assert.doesNotMatch(treeSource, /paddingLeft: `\$\{8 \+ depth \* 12\}px`/)
  assert.match(
    treeSource,
    /class="w-3\.5 h-3\.5 flex items-center justify-center flex-shrink-0"/
  )
  assert.doesNotMatch(treeSource, /class="absolute w-3\.5 h-3\.5 flex items-center justify-center"/)
  assert.doesNotMatch(treeSource, /left: `\$\{depth \* 12 - 10\}px`/)
  assert.match(treeSource, /class="w-3 h-3 sb-text-muted"/)
})
