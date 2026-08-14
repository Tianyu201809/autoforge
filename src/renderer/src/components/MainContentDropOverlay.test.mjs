import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./MainContent.vue', import.meta.url), 'utf8')

test('renders themed release and loading states for dropped script imports', () => {
  assert.match(source, /dropImporting: boolean/)
  assert.match(source, /onDragStateChange: \(active\) => \(dropActive\.value = active\)/)
  assert.match(source, /v-if="dropActive \|\| dropImporting"/)
  assert.match(source, /松开鼠标上传脚本/)
  assert.match(source, /正在上传脚本/)
  assert.match(source, /var\(--sb-accent-solid\)/)
  assert.match(source, /role="status"/)
})
