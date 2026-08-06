import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const files = ['ScriptRunHistoryPanel.vue', 'ExecutionHistoryPanel.vue']

describe('History context menu positioning', () => {
  for (const file of files) {
    it(`${file} anchors the menu to the pointer`, () => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      assert.match(source, /contextMenu = ref<\{ recordId: string; x: number; y: number \} \| null>/)
      assert.match(source, /event\.clientX/)
      assert.match(source, /event\.clientY/)
      assert.match(source, /<Teleport to="body">/)
      assert.match(source, /left: `\$\{contextMenu\.x\}px`/)
      assert.match(source, /top: `\$\{contextMenu\.y\}px`/)
      assert.match(source, /@click="closeContextMenu"/)
    })
  }
})
