import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./ScriptCard.vue', import.meta.url), 'utf8')

test('keeps the export action available for native packages', () => {
  assert.doesNotMatch(source, /原生程序包暂不支持导出/)
  assert.match(source, /:disabled="exporting"/)
  assert.match(source, /if \(exporting\.value\) return/)
})
