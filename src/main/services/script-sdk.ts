import { getAppUserDataPath } from './app-data-root'
import type { Browser } from 'playwright-core'
import type { ScriptRunContext, ScriptSdkShape } from '../../shared/script-contract'
import type { AppConfig } from '../../shared/types/script'
import { launchBrowserWithFallback } from './browser-path'

export function createScriptSdk(
  config: AppConfig,
  scriptDir: string,
  log: ScriptRunContext['log'],
  browserOptions?: { headless?: boolean },
  signal?: AbortSignal
): ScriptSdkShape {
  let browserRef: Browser | null = null

  if (signal) {
    attachBrowserCleanup(signal, () => browserRef)
  }

  return {
    browser: {
      launch: async () => {
        const { browser } = await launchBrowserWithFallback(config, log, browserOptions)
        browserRef = browser
        if (signal?.aborted) {
          void browser.close().catch(() => undefined)
          browserRef = null
          throw new Error('运行已取消')
        }
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
