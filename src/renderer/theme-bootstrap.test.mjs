import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const entries = ['index.html', 'editor.html', 'terminal.html']

for (const entry of entries) {
  test(`${entry} initializes graphite and snow before paint`, async () => {
    const source = await readFile(new URL(entry, import.meta.url), 'utf8')

    assert.match(source, /graphite:\s*'dark'/)
    assert.match(source, /snow:\s*'light'/)
    assert.match(source, /localStorage\.getItem\('autoforge-skin'\)/)
    assert.match(source, /setAttribute\('data-skin', skin\)/)
  })
}
