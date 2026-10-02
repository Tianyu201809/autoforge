import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  describeConversionChanges,
  formatConversionHistory,
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

test('转换结果会列出入口、复制文件和清单', () => {
  const changes = describeConversionChanges({
    entry: 'index.mjs',
    files: [{ path: 'index.mjs', content: 'export {}\n' }],
    copies: [{ from: 'dist/app.js', to: 'vendor/app.js' }]
  })
  assert.equal(changes[0]?.note, '脚本入口')
  assert.equal(changes[0]?.lines, 2)
  assert.equal(changes[1]?.kind, 'copy')
  assert.match(changes[1]?.note ?? '', /dist\/app\.js/)
  assert.equal(changes[2]?.path, 'autoforge.json')
})

test('读回对话时保留修改点', () => {
  const raw = JSON.stringify({
    turns: [
      {
        id: 'a',
        role: 'assistant',
        content: '做成导出',
        status: 'complete',
        createdAt: 't',
        changes: [{ path: 'index.mjs', kind: 'generate', note: '脚本入口', lines: 4 }]
      }
    ]
  })
  const loaded = readConversionConversation(raw)
  assert.equal(loaded.turns[0]?.changes?.[0]?.path, 'index.mjs')
  assert.equal(loaded.turns[0]?.changes?.[0]?.lines, 4)
})

test('历史只保留用户原话和助手摘要', () => {
  const text = formatConversionHistory([
    { id: 'u', role: 'user', content: '只要导出 CSV', status: 'complete', createdAt: 't' },
    {
      id: 'a',
      role: 'assistant',
      content: '做成 CSV 导出',
      thinking: '内部推理不该出现',
      status: 'complete',
      createdAt: 't'
    }
  ])
  assert.match(text, /只要导出 CSV/)
  assert.match(text, /做成 CSV 导出/)
  assert.doesNotMatch(text, /内部推理不该出现/)
})
