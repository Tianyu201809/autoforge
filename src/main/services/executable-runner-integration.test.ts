import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ScriptMeta } from '../../shared/types/script'
import { preflightExecutableStart, runnerKindForScript } from './script-runner'

const executable = { language: 'executable' } as ScriptMeta

test('dispatches executable scripts to the native runner', () => {
  assert.equal(runnerKindForScript(executable), 'executable')
  assert.equal(runnerKindForScript({ language: 'python' } as ScriptMeta), 'python')
  assert.equal(runnerKindForScript({ language: 'javascript' } as ScriptMeta), 'javascript')
})

test('preflights non-interactive executable trust before creating a session', () => {
  let calls = 0
  assert.throws(
    () => preflightExecutableStart(executable, false, () => {
      calls += 1
      throw new Error('需要先在 Autoforge 中手动确认运行')
    }),
    /手动确认/
  )
  assert.equal(calls, 1)
  assert.equal(preflightExecutableStart(executable, true, () => { throw new Error('no') }), undefined)
})
