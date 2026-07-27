import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyBrowserContextDefaults,
  withBrowserContextDefaults
} from './browser-context-defaults.ts'

describe('withBrowserContextDefaults', () => {
  it('uses the actual window viewport for headed browsers', () => {
    assert.deepEqual(withBrowserContextDefaults(undefined, false), { viewport: null })
  })

  it('keeps Playwright defaults in headless mode', () => {
    assert.deepEqual(withBrowserContextDefaults(undefined, true), {})
  })

  it('preserves explicit viewport and device emulation options', () => {
    const cases = [
      { viewport: { width: 800, height: 600 } },
      { screen: { width: 1920, height: 1080 } },
      { isMobile: true },
      { deviceScaleFactor: 2 }
    ]

    for (const options of cases) {
      assert.deepEqual(withBrowserContextDefaults(options, false), options)
    }
  })
})

describe('applyBrowserContextDefaults', () => {
  it('applies defaults to newContext and newPage', async () => {
    const calls = []
    const browser = {
      async newContext(options) {
        calls.push(options)
        return options
      },
      async newPage(options) {
        return this.newContext(options)
      }
    }

    applyBrowserContextDefaults(browser, false)

    await browser.newContext()
    await browser.newPage()
    assert.deepEqual(calls, [{ viewport: null }, { viewport: null }])
  })
})
