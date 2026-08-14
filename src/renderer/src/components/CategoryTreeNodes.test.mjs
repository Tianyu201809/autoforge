import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const treeSource = readFileSync(new URL('./CategoryTreeNodes.vue', import.meta.url), 'utf8')

test('aligns category content while preserving hierarchy controls', () => {
  assert.match(treeSource, /paddingLeft: `\$\{4 \+ depth \* 12\}px`/)
  assert.doesNotMatch(treeSource, /paddingLeft: `\$\{8 \+ depth \* 12\}px`/)
  assert.doesNotMatch(
    treeSource,
    /class="w-3\.5 h-3\.5 flex items-center justify-center flex-shrink-0"/
  )
  assert.match(treeSource, /v-if="node\.children\.length"/)
  assert.match(treeSource, /class="absolute w-3\.5 h-3\.5 flex items-center justify-center"/)
  assert.match(treeSource, /left: `\$\{depth \* 12 - 10\}px`/)
})
