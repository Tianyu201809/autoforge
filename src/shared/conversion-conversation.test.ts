import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  normalizeInterruptedConversation,
  readConversionConversation,
  summarizeAssistantTurn
} from './conversion-conversation'

test('非法或空内容读成空对话', () => {
  assert.deepEqual(readConversionConversation(''), { turns: [] })
  assert.deepEqual(readConversionConversation('{'), { turns: [] })
})

test('上次未完成的助手轮次改为失败', () => {
  const normalized = normalizeInterruptedConversation({
    turns: [
      { id: 'u1', role: 'user', content: '只要导出', status: 'complete', createdAt: 't' },
      { id: 'a1', role: 'assistant', content: '', status: 'running', createdAt: 't' }
    ]
  })
  assert.equal(normalized.turns[1].status, 'error')
  assert.equal(normalized.turns[1].error, '上次转换未完成')
})

test('助手摘要只包含结果，不包含思考', () => {
  const text = summarizeAssistantTurn({
    summary: '做成 CSV 导出',
    files: ['index.mjs', 'autoforge.json'],
    warnings: ['需要构建']
  })
  assert.match(text, /做成 CSV 导出/)
  assert.match(text, /index\.mjs/)
  assert.match(text, /需要构建/)
  assert.doesNotMatch(text, /思考/)
})
