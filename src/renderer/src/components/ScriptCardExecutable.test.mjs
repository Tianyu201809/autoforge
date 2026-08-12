import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./ScriptCard.vue', import.meta.url), 'utf8')

test('disables native export before invoking preview', () => {
  assert.match(source, /script\.language === 'executable'/)
  assert.match(source, /原生程序包暂不支持导出/)
})
