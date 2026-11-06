import { pathToFileURL } from 'url'
import {
  resolveScriptEntryFn,
  SCRIPT_ENTRY_FN_ERROR,
  type ScriptProgressInput,
  type ScriptRunContext,
  type ScriptStageInput
} from '../../shared/script-contract'
import type { HostInbound, HostOutbound, HostStartMessage } from '../../shared/script-host-protocol'
import { attachBrowserDisconnectHandler, type BrowserDisconnectEmitter } from './browser-lifecycle'

type HostPaths = { userData: string; scriptDir: string }

type HostBrowser = BrowserDisconnectEmitter & {
  process: () => { pid?: number } | null | undefined
}

const BROWSER_CLOSED_MESSAGE = '浏览器已关闭'

type HostSdk = {
  browser: {
    launch: () => Promise<HostBrowser>
  }
  paths: HostPaths
}

type HostPost = (message: unknown) => void

export async function runHostMessage(
  message: HostInbound,
  deps: {
    importModule: (entryPath: string) => Promise<Record<string, unknown>>
    post: HostPost
    signal: AbortSignal
    createSdk: (paths: HostPaths, signal: AbortSignal, post: HostPost) => HostSdk
  }
): Promise<void> {
  if (message.type !== 'start') return

  try {
    const mod = await deps.importModule(message.entryPath)
    const runFn = resolveScriptEntryFn(mod)
    if (!runFn) {
      deps.post({ type: 'error', message: SCRIPT_ENTRY_FN_ERROR } satisfies HostOutbound)
      return
    }

    const sdk = watchBrowserPid(deps.createSdk(message.paths, deps.signal, deps.post), deps.post)
    const ctx = {
      sessionId: message.sessionId,
      scriptId: message.scriptId,
      env: message.env,
      params: message.params,
      signal: deps.signal,
      log: (level: 'INFO' | 'WARN' | 'ERROR', text: string): void => {
        deps.post({ type: 'log', level, message: text } satisfies HostOutbound)
      },
      stage: (stage: ScriptStageInput): void => {
        deps.post({ type: 'stage', stage } satisfies HostOutbound)
      },
      progress: (progress: ScriptProgressInput): void => {
        deps.post({ type: 'progress', progress } satisfies HostOutbound)
      },
      sdk
    }
    const value = await runFn(ctx as ScriptRunContext)
    deps.post({ type: 'result', value } satisfies HostOutbound)
  } catch (error) {
    deps.post({ type: 'error', message: errorText(error) } satisfies HostOutbound)
  }
}

function watchBrowserPid(sdk: HostSdk, post: HostPost): HostSdk {
  return {
    paths: sdk.paths,
    browser: {
      launch: async () => {
        const browser = await sdk.browser.launch()
        const pid = readPositivePid(browser)
        if (pid !== undefined) post({ type: 'browser', pid } satisfies HostOutbound)
        attachBrowserDisconnectHandler(browser, (kind) => {
          if (kind !== 'unexpected') return
          post({ type: 'error', message: BROWSER_CLOSED_MESSAGE } satisfies HostOutbound)
        })
        return browser
      }
    }
  }
}

function readPositivePid(browser: HostBrowser): number | undefined {
  if (typeof browser?.process !== 'function') return undefined
  let proc: { pid?: number } | null | undefined
  try {
    proc = browser.process()
  } catch {
    return undefined
  }
  const pid = proc?.pid
  if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) return pid
  return undefined
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

async function importEntryModule(entryPath: string): Promise<Record<string, unknown>> {
  const loaded = await import(pathToFileURL(entryPath).href)
  return loaded as Record<string, unknown>
}

interface UtilityParentPort {
  on(event: 'message', listener: (messageEvent: { data?: unknown }) => void): void
  postMessage(message: unknown): void
}

function readParentPort(): UtilityParentPort | null {
  const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort | null }).parentPort
  if (!parentPort || typeof parentPort.on !== 'function' || typeof parentPort.postMessage !== 'function') {
    return null
  }
  return parentPort
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => typeof item === 'string')
}

function readInbound(event: { data?: unknown } | null | undefined): HostInbound | null {
  const value = event?.data
  if (!isRecord(value)) return null
  if (value.type === 'abort') return { type: 'abort' }
  if (value.type !== 'start') return null
  if (typeof value.entryPath !== 'string') return null
  if (typeof value.sessionId !== 'string') return null
  if (typeof value.scriptId !== 'string') return null
  if (!isStringRecord(value.env) || !isStringRecord(value.params)) return null
  if (!isRecord(value.paths)) return null
  if (typeof value.paths.userData !== 'string' || typeof value.paths.scriptDir !== 'string') return null
  const browserPlan = readBrowserPlan(value.browserPlan)
  const browserLaunchError =
    typeof value.browserLaunchError === 'string' && value.browserLaunchError
      ? value.browserLaunchError
      : undefined
  return {
    type: 'start',
    entryPath: value.entryPath,
    sessionId: value.sessionId,
    scriptId: value.scriptId,
    env: value.env,
    params: value.params,
    paths: {
      userData: value.paths.userData,
      scriptDir: value.paths.scriptDir
    },
    ...(browserPlan ? { browserPlan } : {}),
    ...(browserLaunchError ? { browserLaunchError } : {})
  }
}

function readBrowserPlan(value: unknown): HostStartMessage['browserPlan'] | undefined {
  if (!isRecord(value)) return undefined
  if (value.engine !== 'chromium' && value.engine !== 'firefox') return undefined
  if (typeof value.browsersPath !== 'string' || !value.browsersPath) return undefined
  if (typeof value.headless !== 'boolean') return undefined
  const plan: NonNullable<HostStartMessage['browserPlan']> = {
    browsersPath: value.browsersPath,
    engine: value.engine,
    headless: value.headless
  }
  if (typeof value.executablePath === 'string' && value.executablePath) {
    plan.executablePath = value.executablePath
  }
  if (typeof value.channel === 'string' && value.channel) {
    plan.channel = value.channel
  }
  return plan
}

const EMPTY_BROWSER_PLAN_ERROR =
  '未找到可用浏览器。请安装 Google Chrome、Microsoft Edge 或 Mozilla Firefox，或运行 npm run install:browsers 安装内置 Chromium。'

function createUtilitySdk(paths: HostPaths, message: HostStartMessage): HostSdk {
  return {
    paths,
    browser: {
      launch: async () => {
        if (message.browserLaunchError) {
          throw new Error(message.browserLaunchError)
        }
        const plan = message.browserPlan
        if (!plan) {
          throw new Error(EMPTY_BROWSER_PLAN_ERROR)
        }
        const playwright = await import('playwright-core')
        process.env.PLAYWRIGHT_BROWSERS_PATH = plan.browsersPath
        const options = {
          headless: plan.headless,
          ...(plan.executablePath ? { executablePath: plan.executablePath } : {}),
          ...(plan.channel ? { channel: plan.channel } : {})
        }
        if (plan.engine === 'firefox') {
          return playwright.firefox.launch(options)
        }
        return playwright.chromium.launch(options)
      }
    }
  }
}

async function runParentStart(
  parentPort: UtilityParentPort,
  signal: AbortSignal,
  message: HostInbound
): Promise<void> {
  if (message.type !== 'start') return
  try {
    await runHostMessage(message, {
      importModule: importEntryModule,
      post: (outbound) => parentPort.postMessage(outbound),
      signal,
      createSdk: (paths) => createUtilitySdk(paths, message)
    })
  } catch (error) {
    parentPort.postMessage({ type: 'error', message: errorText(error) } satisfies HostOutbound)
  }
}

function attachParentPort(): void {
  const parentPort = readParentPort()
  if (!parentPort) return

  const controller = new AbortController()
  parentPort.on('message', (event) => {
    const message = readInbound(event)
    if (!message) return
    if (message.type === 'abort') {
      controller.abort()
      return
    }
    void runParentStart(parentPort, controller.signal, message)
  })
}

attachParentPort()
