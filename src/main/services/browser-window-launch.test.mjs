import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getBrowserWindowLaunchArgs } from './browser-window-launch.ts'

describe('getBrowserWindowLaunchArgs', () => {
  it('maximizes headed Chromium browsers', () => {
    assert.deepEqual(getBrowserWindowLaunchArgs('chromium', false), ['--start-maximized'])
  })

  it('does not add window arguments in headless mode', () => {
    assert.deepEqual(getBrowserWindowLaunchArgs('chromium', true), [])
  })

  it('does not add Chromium arguments to Firefox', () => {
    assert.deepEqual(getBrowserWindowLaunchArgs('firefox', false), [])
  })
})
