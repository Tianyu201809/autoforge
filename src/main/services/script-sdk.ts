import { getAppUserDataPath } from './app-data-root'
import type { Browser } from 'playwright-core'
import type { ScriptRunContext, ScriptSdkShape } from '../../shared/script-contract'
import type { AppConfig } from '../../shared/types/script'
import { launchBrowserWithFallback } from './browser-path'

export function createScriptSdk(
  config: AppConfig,
  scriptDir: string,
  log: ScriptRunContext['log'],
  browserOptions?: { headless?: boolean }
): ScriptSdkShape {
  let browserRef: Browser | null = null

  return {
    browser: {
      launch: async () => {
        const { browser } = await launchBrowserWithFallback(config, log, browserOptions)
        browserRef = browser
        return browser
      }
    },
    paths: {
      userData: getAppUserDataPath(),
      scriptDir
    }
  }
}

export function attachBrowserCleanup(signal: AbortSignal, getBrowser: () => Browser | null): void {
  signal.addEventListener('abort', () => {
    const browser = getBrowser()
    if (browser) void browser.close().catch(() => undefined)
  })
}
