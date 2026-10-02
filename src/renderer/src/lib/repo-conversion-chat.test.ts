import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canSendConversionMessage, workspaceDeleteConfirm } from './repo-conversion-chat'

test('第一轮允许空要求，之后必须填写，转换中不能发送', () => {
  assert.equal(canSendConversionMessage([], '', false), true)
  assert.equal(
    canSendConversionMessage(
      [{ id: 'u', role: 'user', content: '只要导出', status: 'complete', createdAt: 't' }],
      '  ',
      false
    ),
    false
  )
  assert.equal(canSendConversionMessage([], '继续', true), false)
})

test('删除确认写明路径，且不涉及已导入脚本', () => {
  const confirm = workspaceDeleteConfirm('owner/repo', 'C:/data/repo-workspaces/demo')
  assert.equal(confirm.title, '删除工作区')
  assert.equal(confirm.confirmLabel, '删除')
  assert.equal(confirm.variant, 'danger')
  assert.match(confirm.message, /C:\\data\\repo-workspaces\\demo|C:\/data\/repo-workspaces\/demo/)
  assert.match(confirm.message, /克隆/)
  assert.match(confirm.message, /已导入/)
})

test('本地工作区的删除确认写副本，不写克隆', () => {
  const confirm = workspaceDeleteConfirm('demo', 'C:/data/repo-workspaces/demo', 'local')
  assert.match(confirm.message, /工作区里的副本/)
  assert.equal(confirm.message.includes('克隆'), false)
  assert.match(confirm.message, /已导入/)
})
