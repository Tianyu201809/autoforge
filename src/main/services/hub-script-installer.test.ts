import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { createDownloadTimeout } from './hub-script-installer'

test('download timeout refresh prevents abort while data is arriving', async () => {
  const timeout = createDownloadTimeout(30)
  await delay(15)
  timeout.refresh()
  await delay(15)
  assert.equal(timeout.signal.aborted, false)
  timeout.clear()
})

test('download timeout aborts after a stalled transfer', async () => {
  const timeout = createDownloadTimeout(10)
  await delay(25)
  assert.equal(timeout.signal.aborted, true)
  timeout.clear()
})
