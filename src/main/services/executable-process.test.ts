import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  createExecutableSpawnOptions,
  runExecutableScript
} from './executable-script-runner'

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
