import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertExecutableParamKeys, normalizeExecutableParamKey } from './executable-environment'

test('normalizes executable parameter keys', () => {
  assert.equal(normalizeExecutableParamKey('order-id'), 'ORDER_ID')
  assert.equal(normalizeExecutableParamKey('中文 key'), '___KEY')
})

test('rejects colliding normalized parameter keys', () => {
  assert.throws(
    () => assertExecutableParamKeys([{ key: 'a-b' }, { key: 'a_b' }]),
    /参数环境变量冲突/
  )
})
