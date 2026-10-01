import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  createExecutableSpawnOptions,
  runExecutableScript
} from './executable-script-runner'
import { collectDescendantPids, parentMapFromWmicCsv } from './process-tree'

const root = mkdtempSync(join(tmpdir(), 'autoforge-executable-process-'))
after(() => rmSync(root, { recursive: true, force: true }))

function input(args: string[]) {
  return { entryPath: process.execPath, argsForTest: args, cwd: root, env: process.env }
}

const callbacks = {
  log() {},
  onPid() {},
  onChild() {},
  isAborted: () => false
}

test('follows nested processes started by an exited launcher', () => {
  const parents = parentMapFromWmicCsv(
    '\r\r\nNode,ParentProcessId,ProcessId\r\r\nHOST,0,1\r\r\nHOST,1,2\r\r\nHOST,2,3\r\r\nHOST,1,4\r\r\nHOST,8,9\r\r\n'
  )
  assert.deepEqual(collectDescendantPids(1, parents).sort((a, b) => a - b), [2, 3, 4])
})

test('keeps Windows GUI executable windows visible', () => {
  const env = { PATH: 'keep' }
  const options = createExecutableSpawnOptions({
    entryPath: join(root, 'tool.exe'),
    cwd: root,
    env
  })

  assert.equal(options.cwd, root)
  assert.equal(options.env, env)
  assert.equal(options.shell, false)
  assert.equal(options.windowsHide, false)
})

test('streams stdout and stderr and returns exit code zero', async () => {
  const logs: Array<[string, string]> = []
  const outcome = await runExecutableScript(
    input(['-e', "console.log('out'); console.error('err')"]),
    { ...callbacks, log: (level, message) => logs.push([level, message]) }
  )
  assert.equal(outcome.ok, true)
  assert.equal(outcome.exitCode, 0)
  assert.deepEqual(logs, [['INFO', 'out'], ['ERROR', 'err']])
})

test('reports a non-zero exit', async () => {
  const outcome = await runExecutableScript(input(['-e', 'process.exit(7)']), callbacks)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.exitCode, 7)
  assert.match(outcome.errorMessage ?? '', /退出码 7/)
})

test('handles a process with no output', async () => {
  const outcome = await runExecutableScript(input(['-e', '']), callbacks)
  assert.equal(outcome.ok, true)
})

test('reports spawn errors', async () => {
  const outcome = await runExecutableScript(
    { entryPath: join(root, 'missing.exe'), cwd: root, env: process.env },
    callbacks
  )
  assert.equal(outcome.ok, false)
  assert.match(outcome.errorMessage ?? '', /ENOENT|找不到|not found/i)
})

test('stays running after a launcher exits while its program is still alive', { timeout: 20_000 }, async () => {
  const pidFile = join(root, 'launched-pid.txt')
  const launcher = join(root, 'launcher.mjs')
  writeFileSync(
    launcher,
    `import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  cwd: process.env.AUTOFORGE_TEST_CHILD_CWD,
  detached: true,
  stdio: 'ignore',
  windowsHide: true
})
child.unref()
writeFileSync(process.env.AUTOFORGE_TEST_PIDFILE, String(child.pid))
`
  )

  let settled = false
  let launchedPid = 0
  const outcomePromise = runExecutableScript(
    {
      entryPath: process.execPath,
      argsForTest: [launcher],
      cwd: root,
      env: {
        ...process.env,
        AUTOFORGE_TEST_PIDFILE: pidFile,
        AUTOFORGE_TEST_CHILD_CWD: tmpdir()
      }
    },
    callbacks
  ).then((outcome) => {
    settled = true
    return outcome
  })

  try {
    const started = Date.now()
    while (!launchedPid && Date.now() - started < 5_000) {
      try {
        launchedPid = Number(readFileSync(pidFile, 'utf8'))
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    assert.ok(launchedPid > 0)
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.equal(settled, false)
    spawn('taskkill', ['/PID', String(launchedPid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    const outcome = await outcomePromise
    assert.equal(outcome.ok, true)
    assert.equal(outcome.exitCode, 0)
  } finally {
    if (launchedPid) {
      spawn('taskkill', ['/PID', String(launchedPid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    }
  }
})
