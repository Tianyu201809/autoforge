import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isFilePathDropTarget } from './file-path-drop'

describe('isFilePathDropTarget', () => {
  it('accepts editable text inputs and textareas', () => {
    assert.equal(
      isFilePathDropTarget({ tagName: 'INPUT', type: 'text', disabled: false, readOnly: false } as HTMLInputElement),
      true
    )
    assert.equal(
      isFilePathDropTarget({ tagName: 'TEXTAREA', disabled: false, readOnly: false } as HTMLTextAreaElement),
      true
    )
  })

  it('rejects non-text, disabled, and readonly controls', () => {
    assert.equal(
      isFilePathDropTarget({ tagName: 'INPUT', type: 'number', disabled: false, readOnly: false } as HTMLInputElement),
      false
    )
    assert.equal(
      isFilePathDropTarget({ tagName: 'INPUT', type: 'search', disabled: false, readOnly: false } as HTMLInputElement),
      false
    )
    assert.equal(
      isFilePathDropTarget({ tagName: 'INPUT', type: 'password', disabled: false, readOnly: false } as HTMLInputElement),
      false
    )
    assert.equal(
      isFilePathDropTarget({ tagName: 'INPUT', type: 'text', disabled: true, readOnly: false } as HTMLInputElement),
      false
    )
    assert.equal(
      isFilePathDropTarget({ tagName: 'TEXTAREA', disabled: false, readOnly: true } as HTMLTextAreaElement), false)
  })
})
