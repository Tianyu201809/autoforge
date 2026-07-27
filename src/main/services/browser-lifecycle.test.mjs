import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { attachBrowserDisconnectHandler } from './browser-lifecycle.ts'

describe('attachBrowserDisconnectHandler', () => {
  it('defers browser disconnect notification', () => {
    const browser = new EventEmitter()
    const scheduled = []
    let calls = 0

    attachBrowserDisconnectHandler(
      browser,
      () => {
        calls += 1
      },
      (callback) => scheduled.push(callback)
    )

    browser.emit('disconnected')
    assert.equal(calls, 0)
    assert.equal(scheduled.length, 1)

    scheduled[0]()
    assert.equal(calls, 1)
  })

  it('notifies only once', () => {
    const browser = new EventEmitter()
    const scheduled = []

    attachBrowserDisconnectHandler(browser, () => undefined, (callback) => scheduled.push(callback))

    browser.emit('disconnected')
    browser.emit('disconnected')
    assert.equal(scheduled.length, 1)
  })
})
