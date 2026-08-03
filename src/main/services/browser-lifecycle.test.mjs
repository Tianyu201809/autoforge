import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { attachBrowserDisconnectHandler } from './browser-lifecycle.ts'

describe('attachBrowserDisconnectHandler', () => {
  it('classifies a script-requested close as intentional', async () => {
    const browser = new EventEmitter()
    const scheduled = []
    const kinds = []
    browser.close = async () => browser.emit('disconnected')

    attachBrowserDisconnectHandler(
      browser,
      (kind) => kinds.push(kind),
      (callback) => scheduled.push(callback)
    )

    await browser.close()
    assert.deepEqual(kinds, [])
    assert.equal(scheduled.length, 1)

    scheduled[0]()
    assert.deepEqual(kinds, ['intentional'])
  })

  it('classifies an external disconnect as unexpected', () => {
    const browser = new EventEmitter()
    const scheduled = []
    const kinds = []
    browser.close = async () => undefined

    attachBrowserDisconnectHandler(
      browser,
      (kind) => kinds.push(kind),
      (callback) => scheduled.push(callback)
    )

    browser.emit('disconnected')
    assert.deepEqual(kinds, [])
    assert.equal(scheduled.length, 1)

    scheduled[0]()
    assert.deepEqual(kinds, ['unexpected'])
  })

  it('notifies only once', () => {
    const browser = new EventEmitter()
    const scheduled = []
    browser.close = async () => undefined

    attachBrowserDisconnectHandler(browser, () => undefined, (callback) => scheduled.push(callback))

    browser.emit('disconnected')
    browser.emit('disconnected')
    assert.equal(scheduled.length, 1)
  })
})
