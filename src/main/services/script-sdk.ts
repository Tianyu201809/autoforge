import { getAppUserDataPath } from './app-data-root'
import type { Browser } from 'playwright-core'
import type { ScriptRunContext, ScriptSdkShape } from '../../shared/script-contract'
import type { AppConfig } from '../../shared/types/script'
import { launchBrowserWithFallback } from './browser-path'
import { attachBrowserDisconnectHandler } from './browser-lifecycle'
import { applyBrowserContextDefaults } from './browser-context-defaults'

export function createScriptSdk(
  config: AppConfig,
  scriptDir: string,
  log: ScriptRunContext['log'],
  browserOptions?: { headless?: boolean },
  signal?: AbortSignal,
  onBrowserDisconnected?: () => void
): ScriptSdkShape {
  let browserRef: Browser | null = null

  if (signal) {
    attachBrowserCleanup(signal, () => browserRef)
  }

  return {
    browser: {
      launch: async () => {
        const { browser, plan } = await launchBrowserWithFallback(config, log, browserOptions)
        browserRef = browser
        applyBrowserContextDefaults(browser, plan.headless)
        if (onBrowserDisconnected) {
          attachBrowserDisconnectHandler(browser, (kind) => {
            browserRef = null
            if (kind === 'unexpected') onBrowserDisconnected()
          })
        }
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
