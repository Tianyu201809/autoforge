import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bindFilePathDropTarget } from './script-drop'

type ListenerMap = Map<string, EventListener>

function createElement(value = ''): {
  element: HTMLInputElement
  listeners: ListenerMap
  classes: Set<string>
  events: Event[]
} {
  const listeners: ListenerMap = new Map()
  const classes = new Set<string>()
  const events: Event[] = []
  const element = {
    value,
    classList: {
      add(name: string) { classes.add(name) },
      remove(name: string) { classes.delete(name) }
    },
    addEventListener(name: string, listener: EventListener) { listeners.set(name, listener) },
    removeEventListener(name: string) { listeners.delete(name) },
    dispatchEvent(event: Event) { events.push(event); return true }
  } as unknown as HTMLInputElement
  return { element, listeners, classes, events }
}

function dropEvent(): DragEvent {
  return {
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: null
  } as unknown as DragEvent
}

describe('bindFilePathDropTarget', () => {
  it('writes dropped paths in order and dispatches a bubbling input event', () => {
    const { element, listeners, events } = createElement()
    const unbind = bindFilePathDropTarget(element, () => ['C:\\one.txt', 'C:\\two.txt'])

    listeners.get('drop')!(dropEvent())

    assert.equal(element.value, 'C:\\one.txt\nC:\\two.txt')
    assert.equal(events[0]?.type, 'input')
    assert.equal(events[0]?.bubbles, true)
    unbind()
  })

  it('does not modify the element when no path is resolved', () => {
    const { element, listeners } = createElement('keep')
    bindFilePathDropTarget(element, () => [])

    listeners.get('drop')!(dropEvent())

    assert.equal(element.value, 'keep')
  })

  it('adds and removes the drag feedback class only for file drops', () => {
    const { element, listeners, classes } = createElement()
    bindFilePathDropTarget(element, () => ['C:\\one.txt'])

    listeners.get('dragover')!(dropEvent())
    assert.equal(classes.has('is-file-path-drop-target'), true)
    listeners.get('dragleave')!(new Event('dragleave'))
    assert.equal(classes.has('is-file-path-drop-target'), false)
  })
})
