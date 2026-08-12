import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertExecutableParamKeys,
  buildExecutableEnvironment,
  normalizeExecutableParamKey
} from './executable-environment'

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

test('injects env, normalized params, JSON, and reserved metadata', () => {
  const result = buildExecutableEnvironment({
    baseEnv: { PATH: 'keep', AUTOFORGE_SESSION_ID: 'old' },
    env: { API_URL: 'https://example.test', AUTOFORGE_SCRIPT_ID: 'bad' },
    params: { 'order-id': '42' },
    sessionId: 's1',
    scriptId: 'x1',
    scriptDir: 'C:\\scripts\\x1'
  })
  assert.equal(result.PATH, 'keep')
  assert.equal(result.API_URL, 'https://example.test')
  assert.equal(result.AUTOFORGE_PARAM_ORDER_ID, '42')
  assert.equal(result.AUTOFORGE_PARAMS_JSON, '{"order-id":"42"}')
  assert.equal(result.AUTOFORGE_SESSION_ID, 's1')
  assert.equal(result.AUTOFORGE_SCRIPT_ID, 'x1')
})
