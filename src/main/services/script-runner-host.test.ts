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

  scriptStore.setConfig({ script: { runTimeoutSeconds: 1 } })
  const logs: string[] = []
  const onLog = (line: { message: string }): void => {
    logs.push(line.message)
  }
  logBus.on('log', onLog)
  try {
    const timed = await runner.start(script.id)
    await waitFor(() => hosts.length === 4 && hosts[3].messages.length > 0)
    const timeoutHost = hosts[3]
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
