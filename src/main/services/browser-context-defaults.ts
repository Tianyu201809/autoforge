import type { BrowserContextOptions } from 'playwright-core'

interface BrowserContextFactory {
  newContext(options?: BrowserContextOptions): Promise<unknown>
}

const VIEWPORT_EMULATION_KEYS: Array<keyof BrowserContextOptions> = [
  'viewport',
  'screen',
  'isMobile',
  'deviceScaleFactor'
]

export function withBrowserContextDefaults(
  options: BrowserContextOptions | undefined,
  headless: boolean
): BrowserContextOptions {
  const resolved = { ...options }
  const usesViewportEmulation = VIEWPORT_EMULATION_KEYS.some(
    (key) => resolved[key] !== undefined
  )

  if (!headless && !usesViewportEmulation) {
    resolved.viewport = null
  }

  return resolved
}

export function applyBrowserContextDefaults(
  browser: BrowserContextFactory,
  headless: boolean
): void {
  const originalNewContext = browser.newContext.bind(browser)
  browser.newContext = (options) => originalNewContext(withBrowserContextDefaults(options, headless))
}
