import assert from 'node:assert/strict'
import { test } from 'node:test'
import { beginRepoConversion, cancelRepoConversion, endRepoConversion } from './repo-conversion-service'

test('取消当前转换会使信号中止', () => {
  const signal = beginRepoConversion('task-a')
  assert.equal(signal.aborted, false)
  cancelRepoConversion('task-a')
  assert.equal(signal.aborted, true)
  endRepoConversion('task-a')
})
