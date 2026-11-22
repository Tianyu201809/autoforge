import assert from 'node:assert/strict'
import { test } from 'node:test'
import { armHostStop } from './script-host-stop'

test('kills the host after 1000ms when it is still alive', () => {
  let scheduledMs = 0
  let fire = () => undefined
  let aborted = false
  let killed = false
  const alive = true
  armHostStop({
    postAbort: () => { aborted = true },
    kill: () => { killed = true },
    hasExited: () => !alive,
    schedule: (fn, ms) => {
      scheduledMs = ms
      fire = fn
      return { cancel() { fire = () => undefined } }
    }
  })
  assert.equal(aborted, true)
  assert.equal(scheduledMs, 1000)
  assert.equal(killed, false)
  fire()
  assert.equal(killed, true)
})

test('does not kill a host that exits within the grace period', () => {
  let fire = () => undefined
  let killed = false
  armHostStop({
    postAbort: () => undefined,
    kill: () => { killed = true },
    hasExited: () => true,
    schedule: (fn) => {
      fire = fn
      return { cancel() {} }
    }
  })
  fire()
  assert.equal(killed, false)
})
