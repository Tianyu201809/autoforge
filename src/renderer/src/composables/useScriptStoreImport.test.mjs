import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const store = readFileSync(new URL('./useScriptStore.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

test('clears dropped-import loading before executable selection and after completion', () => {
  assert.match(store, /onBeforeExecutableSelection\?: \(\) => void/)
  assert.match(store, /options\.onBeforeExecutableSelection\?\.\(\)/)
  assert.match(app, /const dropImporting = ref\(false\)/)
  assert.match(app, /async function handleDroppedImport\(sourcePath: string\): Promise<void>/)
  assert.match(app, /finally\s*\{\s*dropImporting\.value = false/s)
  assert.match(app, /:drop-importing="dropImporting"/)
})
