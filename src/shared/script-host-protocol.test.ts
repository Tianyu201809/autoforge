import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseHostOutbound } from './script-host-protocol'

test('accepts host messages and rejects unknown ones', () => {
  assert.deepEqual(parseHostOutbound({ type: 'log', level: 'INFO', message: 'hi' }), {
    type: 'log',
    level: 'INFO',
    message: 'hi'
  })
  assert.deepEqual(parseHostOutbound({ type: 'browser', pid: 12 }), { type: 'browser', pid: 12 })
  assert.equal(parseHostOutbound({ type: 'browser', pid: -1 }), null)
  assert.equal(parseHostOutbound({ type: 'nope' }), null)
})
