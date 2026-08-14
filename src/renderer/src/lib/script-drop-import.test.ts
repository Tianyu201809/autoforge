import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bindScriptDropImportZone, resolveDropImportPath } from './script-drop-import'

test('accepts a dropped directory whose name contains a dot', () => {
  assert.equal(
    resolveDropImportPath(['C:\\tools\\release.v1']),
    'C:\\tools\\release.v1'
  )
})

test('binds drop events in the renderer and forwards the resolved path', () => {
  const listeners = new Map<string, EventListener>()
  const element = {
    addEventListener(name: string, listener: EventListener) { listeners.set(name, listener) },
    removeEventListener(name: string) { listeners.delete(name) }
  } as unknown as HTMLElement
  const paths: string[] = []
  const file = { name: 'release.v1' } as File
  const event = {
    dataTransfer: { files: [file], dropEffect: 'none' },
    preventDefault() {},
    stopPropagation() {}
  } as unknown as DragEvent

  const unbind = bindScriptDropImportZone(
    element,
    () => 'C:\\tools\\release.v1',
    { onPath: (sourcePath) => paths.push(sourcePath) }
  )
  listeners.get('drop')!(event)

  assert.deepEqual(paths, ['C:\\tools\\release.v1'])
  unbind()
  assert.equal(listeners.size, 0)
})

test('tracks nested file drag events and clears state after drop', () => {
  const listeners = new Map<string, EventListener>()
  const states: boolean[] = []
  const element = {
    addEventListener(name: string, listener: EventListener) { listeners.set(name, listener) },
    removeEventListener(name: string) { listeners.delete(name) }
  } as unknown as HTMLElement
  const file = { name: 'script' } as File
  const event = {
    dataTransfer: { files: [file], types: ['Files'] },
    preventDefault() {},
    stopPropagation() {}
  } as unknown as DragEvent

  const unbind = bindScriptDropImportZone(
    element,
    () => 'C:\\scripts\\script',
    {
      onPath() {},
      onDragStateChange: (active) => states.push(active)
    }
  )

  listeners.get('dragenter')!(event)
  listeners.get('dragenter')!(event)
  listeners.get('dragleave')!(event)
  listeners.get('drop')!(event)

  assert.deepEqual(states, [true, false])
  unbind()
})
