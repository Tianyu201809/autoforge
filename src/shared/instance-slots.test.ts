import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertSlotsWritable,
  MAX_INSTANCE_SLOTS,
  normalizeInstanceSlots
} from './instance-slots'

describe('instance-slots', () => {
  it('normalizeInstanceSlots trims and keeps browser', () => {
    const slots = normalizeInstanceSlots([
      {
        id: ' a ',
        name: ' 槽1 ',
        envId: ' default ',
        params: { x: '1' },
        browser: { headless: true }
      },
      { id: '', name: 'bad', envId: 'default' }
    ])
    assert.equal(slots.length, 1)
    assert.deepEqual(slots[0], {
      id: 'a',
      name: '槽1',
      envId: 'default',
      params: { x: '1' },
      browser: { headless: true }
    })
  })

  it('assertSlotsWritable rejects more than max', () => {
    const slots = Array.from({ length: MAX_INSTANCE_SLOTS + 1 }, (_, i) => ({
      id: `id-${i}`,
      name: `n${i}`,
      envId: 'default',
      params: {}
    }))
    assert.throws(() => assertSlotsWritable(slots), /最多保存/)
  })

  it('assertSlotsWritable rejects empty name', () => {
    assert.throws(
      () => assertSlotsWritable([{ id: '1', name: '  ', envId: 'default', params: {} }]),
      /名称不能为空/
    )
  })
})
