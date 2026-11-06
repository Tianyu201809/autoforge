import { pathToFileURL } from 'url'
import {
  resolveScriptEntryFn,
  SCRIPT_ENTRY_FN_ERROR,
  type ScriptProgressInput,
  type ScriptRunContext,
  type ScriptStageInput
} from '../../shared/script-contract'
import type { HostInbound, HostOutbound } from '../../shared/script-host-protocol'

type HostPaths = { userData: string; scriptDir: string }

type HostBrowser = {
  process: () => { pid?: number } | null | undefined
}

type HostSdk = {
  browser: {
    launch: () => Promise<HostBrowser>
  }
  paths: HostPaths
}

type HostPost = (message: unknown) => void

type ScriptSdkFactory = typeof import('./script-sdk').createScriptSdk

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
  return value as HostInbound
}

const HOST_SDK_CONFIG_ERROR =
  '宿主进程无法调用 createScriptSdk：启动消息没有 AppConfig 与浏览器 headless 设置，且该函数会读取 Electron 的 userData'

type LoadedScriptSdk = { factory: ScriptSdkFactory | null; error: unknown }

async function loadScriptSdk(): Promise<LoadedScriptSdk> {
  try {
    const loaded = await import('./script-sdk')
    return { factory: loaded.createScriptSdk, error: null }
  } catch (error) {
    return { factory: null, error }
  }
}

function createUtilitySdk(paths: HostPaths, loaded: LoadedScriptSdk): HostSdk {
  return {
    paths,
    browser: {
      launch: async () => {
        if (loaded.error) throw loaded.error
        if (typeof loaded.factory !== 'function') {
          throw new Error('宿主进程未能加载 createScriptSdk')
        }
        throw new Error(HOST_SDK_CONFIG_ERROR)
      }
    }
  }
}

async function runParentStart(
  parentPort: UtilityParentPort,
  signal: AbortSignal,
  message: HostInbound
): Promise<void> {
  const loaded = await loadScriptSdk()
  try {
    await runHostMessage(message, {
      importModule: importEntryModule,
      post: (outbound) => parentPort.postMessage(outbound),
      signal,
      createSdk: (paths) => createUtilitySdk(paths, loaded)
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
