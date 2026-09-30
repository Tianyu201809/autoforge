import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const source = readFileSync(new URL('./LlmProfilesPanel.vue', import.meta.url), 'utf8')

describe('LlmProfilesPanel 构建授权开关', () => {
  it('模板把 change 事件交给专用处理器', () => {
    assert.match(source, /@change="onAllowBuildChange"/)
  })

  it('从 DOM 事件读取勾选状态，而不是取反内部状态', () => {
    // 受控 checkbox 的视觉状态由 DOM 先行切换，只有读事件才能拿到用户的真实意图
    assert.match(source, /const input = event\.target as HTMLInputElement/)
    assert.match(source, /const next = input\.checked/)
  })

  it('取消确认后显式回滚 DOM 勾选状态', () => {
    // allowBuild 未变化时 Vue 不会重渲染，不显式回滚会停留在勾选态
    assert.match(source, /if \(!confirmed\) \{[\s\S]*?input\.checked = false[\s\S]*?return/)
  })

  it('写入成功后以服务端返回的权威状态同步 DOM', () => {
    assert.match(source, /state\.value = await window\.autoforge\.llm\.setAllowBuild\(next\)/)
    assert.match(source, /input\.checked = state\.value\.allowBuild/)
  })

  it('写入失败时回滚到当前已知状态', () => {
    assert.match(source, /input\.checked = state\.value\?\.allowBuild \?\? false/)
  })

  it('开启前必须经过危险确认', () => {
    assert.match(source, /askConfirm\(\{/)
    assert.match(source, /variant: 'danger'/)
  })
})
