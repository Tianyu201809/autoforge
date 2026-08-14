import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')

test('assigns and selects successful dropped imports in a visible view', () => {
  assert.match(source, /activeCategoryKey/)
  assert.match(source, /categoryKey: categoryKey \?\? 'local'/)
  assert.match(source, /if \(!imported\) return/)
  assert.match(source, /setNavFilter\('all'\)/)
  assert.match(source, /searchQuery\.value = ''/)
  assert.match(source, /resetListFilter\(\)/)
  assert.match(source, /setListPage\(Math\.floor\(importedIndex \/ listPageSize\.value\) \+ 1\)/)
  assert.match(source, /selectScript\(imported\)/)
})
