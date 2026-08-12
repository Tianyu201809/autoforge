import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('entry picker renders radio candidates and emits the selected relative path', () => {
  const source = readFileSync(new URL('./ExecutableEntryPickerModal.vue', import.meta.url), 'utf8')
  assert.match(source, /v-for="candidate in candidates"/)
  assert.match(source, /type="radio"/)
  assert.match(source, /candidate\.entry/)
  assert.match(source, /candidate\.format/)
  assert.match(source, /formatBytes\(candidate\.size\)/)
  assert.match(source, /emit\('confirm', selectedEntry\.value\)/)
})
