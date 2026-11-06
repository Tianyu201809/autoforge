import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { closeDatabase, initDatabase } from '../db/database'
import { logBus } from './log-bus'
import { scriptStore } from './script-store'

const nodeRequire = createRequire(import.meta.url)
const electronPath = nodeRequire.resolve('electron')
nodeRequire.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: {
      isPackaged: false,
      getPath() {
        return 'autoforge-test-user-data'
      },
      getAppPath() {
        return 'autoforge-test-app'
      }
    },
    BrowserWindow: {
      getAllWindows() {
        return []
      }
    },
    utilityProcess: {
      fork() {
        throw new Error('unit test must inject launchHost')
      }
    }
  }
} as NodeJS.Module

const roots: string[] = []

after(() => {
  closeDatabase()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for script host condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

type HostRecorder = {
  file: string
  messages: unknown[]
  killed: boolean
  emit: (message: unknown) => void
  exit: () => void
}

test('javascript sessions start, finish, and stop through the host process', async () => {
  const dataRoot = tempDir('autoforge-js-host-')
  await initDatabase(dataRoot)
  const workspace = tempDir('autoforge-js-script-')
  const entryPath = join(workspace, 'index.mjs')
  writeFileSync(entryPath, 'export async function run() { await new Promise(() => {}) }\n')
  const missingBrowser = join(workspace, 'missing-browser.exe')
  scriptStore.setConfig({ browser: { executablePath: missingBrowser } })
  const script = scriptStore.addScript({
    id: 'js-host-1',
    name: 'JS host',
    description: '',
    workspacePath: workspace,
    category: 'local',
    categoryLabel: '本地',
    categoryColor: '',
    icon: 'app-window',
    iconColor: '',
    iconBg: '',
    iconBorder: '',
    version: '1.0.0',
    entry: 'index.mjs',
    language: 'javascript',
    envSchema: [],
    paramSchema: [],
    importedAt: new Date().toISOString()
  })

  const hosts: HostRecorder[] = []
  const { ScriptRunnerService } = await import('./script-runner')
  const expectedHostFile = fileURLToPath(new URL('./script-host.js', new URL('./script-runner.ts', import.meta.url)))
  const runner = new ScriptRunnerService(() => null, undefined, (hostFile) => {
    let onMessage: ((message: unknown) => void) | undefined
    let onExit: (() => void) | undefined
    const host: HostRecorder = {
      file: hostFile,
      messages: [],
      killed: false,
      emit(message) {
        onMessage?.(message)
      },
      exit() {
        onExit?.()
      }
    }
    hosts.push(host)
    return {
      postMessage(message) {
        host.messages.push(message)
      },
      kill() {
        host.killed = true
      },
      onMessage(handler) {
        onMessage = handler
      },
      onExit(handler) {
        onExit = handler
      }
    }
  })

  const started = await runner.start(script.id)
  await waitFor(() => hosts.length === 1 && hosts[0].messages.length > 0)
  const host = hosts[0]
  assert.equal(host.file, expectedHostFile)
  const startMessage = host.messages[0] as {
    type?: string
    entryPath?: string
    browserPlan?: unknown
    browserLaunchError?: string
  }
  assert.equal(startMessage.type, 'start')
  assert.equal(startMessage.entryPath, entryPath)
  assert.equal(startMessage.browserPlan, undefined)
  assert.equal(startMessage.browserLaunchError, `指定的浏览器路径不存在：${missingBrowser}`)

  host.emit({ type: 'result', value: 1 })
  await waitFor(() => runner.getSession(started.id)?.status === 'success')
  assert.equal(runner.getSession(started.id)?.result, 1)
  assert.equal(host.killed, true)

  const stopped = await runner.start(script.id)
  await waitFor(() => hosts.length === 2 && hosts[1].messages.length > 0)
  const stopHost = hosts[1]
  const originalKill = process.kill.bind(process)
  let browserKillAttempted = false
  process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
    if (pid === 424242) {
      browserKillAttempted = true
      const error = new Error('ESRCH') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    }
    return originalKill(pid, signal)
  }) as typeof process.kill
  try {
    stopHost.emit({ type: 'browser', pid: 424242 })
    const stoppedSession = runner.stop(stopped.id)
    assert.equal(stoppedSession?.status, 'stopped')
    assert.equal(stopHost.killed, false)
    assert.deepEqual(stopHost.messages.at(-1), { type: 'abort' })
    stopHost.emit({ type: 'result', value: 99 })
    assert.equal(runner.getSession(stopped.id)?.status, 'stopped')
    assert.notEqual(runner.getSession(stopped.id)?.result, 99)
    await new Promise((resolve) => setTimeout(resolve, 900))
    assert.equal(stopHost.killed, false)
    await waitFor(() => stopHost.killed)
    assert.equal(browserKillAttempted, true)
    assert.equal(runner.getSession(stopped.id)?.status, 'stopped')
  } finally {
    process.kill = originalKill
  }

  const exited = await runner.start(script.id)
  await waitFor(() => hosts.length === 3 && hosts[2].messages.length > 0)
  hosts[2].exit()
  await waitFor(() => runner.getSession(exited.id)?.status === 'error')

  const keptBrowserPid = 525252
  const restoreKill = process.kill.bind(process)
  const killedPids: number[] = []
  process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
    if (pid === keptBrowserPid) {
      killedPids.push(pid)
      return true
    }
    return restoreKill(pid, signal)
  }) as typeof process.kill
  try {
    const kept = await runner.start(script.id)
    await waitFor(() => hosts.length === 4 && hosts[3].messages.length > 0)
    const keepHost = hosts[3]
    keepHost.emit({ type: 'browser', pid: keptBrowserPid })
    keepHost.emit({ type: 'result', value: 1 })
    await waitFor(() => runner.getSession(kept.id)?.status === 'success')
    assert.equal(keepHost.killed, false)
    assert.deepEqual(killedPids, [])
    keepHost.exit()
    assert.equal(runner.getSession(kept.id)?.status, 'success')
    assert.deepEqual(killedPids, [])

    const closedAfterSuccess = await runner.start(script.id)
    await waitFor(() => hosts.length === 5 && hosts[4].messages.length > 0)
    const finishedHost = hosts[4]
    finishedHost.emit({ type: 'browser', pid: keptBrowserPid })
    finishedHost.emit({ type: 'result', value: 2 })
    await waitFor(() => runner.getSession(closedAfterSuccess.id)?.status === 'success')
    assert.equal(finishedHost.killed, false)
    finishedHost.emit({ type: 'browser', pid: keptBrowserPid, closed: 'unexpected' })
    assert.equal(finishedHost.killed, true)
    assert.deepEqual(killedPids, [])
    assert.equal(runner.getSession(closedAfterSuccess.id)?.status, 'success')

    const failedWithBrowser = await runner.start(script.id)
    await waitFor(() => hosts.length === 6 && hosts[5].messages.length > 0)
    const failedHost = hosts[5]
    failedHost.emit({ type: 'browser', pid: keptBrowserPid })
    failedHost.emit({ type: 'error', message: '浏览器已关闭' })
    await waitFor(() => runner.getSession(failedWithBrowser.id)?.status === 'error')
    assert.equal(failedHost.killed, false)
    assert.deepEqual(killedPids, [])
    assert.equal(runner.getSession(failedWithBrowser.id)?.status, 'error')

    const closedThenDone = await runner.start(script.id)
    await waitFor(() => hosts.length === 7 && hosts[6].messages.length > 0)
    const intentionalHost = hosts[6]
    intentionalHost.emit({ type: 'browser', pid: keptBrowserPid })
    intentionalHost.emit({ type: 'browser', pid: keptBrowserPid, closed: 'intentional' })
    assert.equal(runner.getSession(closedThenDone.id)?.status, 'running')
    intentionalHost.emit({ type: 'result', value: 3 })
    await waitFor(() => runner.getSession(closedThenDone.id)?.status === 'success')
    assert.equal(intentionalHost.killed, true)
    assert.deepEqual(killedPids, [])

    const disconnected = await runner.start(script.id)
    await waitFor(() => hosts.length === 8 && hosts[7].messages.length > 0)
    const disconnectHost = hosts[7]
    disconnectHost.emit({ type: 'browser', pid: keptBrowserPid })
    disconnectHost.emit({ type: 'browser', pid: keptBrowserPid, closed: 'unexpected' })
    await waitFor(() => runner.getSession(disconnected.id)?.status === 'stopped')
    assert.equal(disconnectHost.killed, false)
    await waitFor(() => disconnectHost.killed, 3000)
    assert.deepEqual(killedPids, [])
    assert.equal(runner.getSession(disconnected.id)?.status, 'stopped')
  } finally {
    process.kill = restoreKill
  }

  scriptStore.setConfig({ script: { runTimeoutSeconds: 1 } })
  const logs: string[] = []
  const onLog = (line: { message: string }): void => {
    logs.push(line.message)
  }
  logBus.on('log', onLog)
  try {
    const timed = await runner.start(script.id)
    await waitFor(() => hosts.length === 9 && hosts[8].messages.length > 0)
    const timeoutHost = hosts[8]
    await waitFor(() => runner.getSession(timed.id)?.status === 'error', 5000)
    assert.equal(logs.includes('运行超时（1 秒），已自动停止'), true)
    assert.equal(timeoutHost.killed, false)
    assert.deepEqual(timeoutHost.messages.at(-1), { type: 'abort' })
    await waitFor(() => timeoutHost.killed, 3000)
    assert.equal(runner.getSession(timed.id)?.status, 'error')
  } finally {
    logBus.off('log', onLog)
  }
})

test('browser disconnect posts closed on the browser message', async () => {
  const { EventEmitter } = await import('node:events')
  const { runHostMessage } = await import('./script-host')
  const start = {
    type: 'start' as const,
    entryPath: 'entry.js',
    sessionId: 's',
    scriptId: 'script',
    env: {},
    params: {},
    paths: { userData: 'user', scriptDir: 'dir' }
  }

  const unexpected = new EventEmitter() as EventEmitter & {
    process: () => { pid: number }
    close: () => Promise<void>
  }
  unexpected.process = () => ({ pid: 7 })
  unexpected.close = async () => {
    unexpected.emit('disconnected')
  }
  const unexpectedPosted: unknown[] = []
  await runHostMessage(start, {
    importModule: async () => ({
      run: async (ctx: { sdk: { browser: { launch: () => Promise<unknown> } } }) => {
        await ctx.sdk.browser.launch()
        unexpected.emit('disconnected')
        await new Promise((resolve) => setImmediate(resolve))
        return 1
      }
    }),
    post: (message) => unexpectedPosted.push(message),
    signal: new AbortController().signal,
    createSdk: () => ({
      browser: { launch: async () => unexpected },
      paths: { userData: 'user', scriptDir: 'dir' }
    })
  })
  assert.deepEqual(unexpectedPosted[0], { type: 'browser', pid: 7 })
  assert.deepEqual(unexpectedPosted[1], { type: 'browser', pid: 7, closed: 'unexpected' })
  assert.deepEqual(unexpectedPosted[2], { type: 'result', value: 1 })

  const intentional = new EventEmitter() as EventEmitter & {
    process: () => { pid: number }
    close: () => Promise<void>
  }
  intentional.process = () => ({ pid: 8 })
  intentional.close = async () => {
    intentional.emit('disconnected')
  }
  const intentionalPosted: unknown[] = []
  await runHostMessage(start, {
    importModule: async () => ({
      run: async (ctx: { sdk: { browser: { launch: () => Promise<{ close: () => Promise<void> }> } } }) => {
        const browser = await ctx.sdk.browser.launch()
        await browser.close()
        await new Promise((resolve) => setImmediate(resolve))
        return 1
      }
    }),
    post: (message) => intentionalPosted.push(message),
    signal: new AbortController().signal,
    createSdk: () => ({
      browser: { launch: async () => intentional },
      paths: { userData: 'user', scriptDir: 'dir' }
    })
  })
  assert.deepEqual(intentionalPosted[0], { type: 'browser', pid: 8 })
  assert.deepEqual(intentionalPosted[1], { type: 'browser', pid: 8, closed: 'intentional' })
  assert.deepEqual(intentionalPosted[2], { type: 'result', value: 1 })
})
