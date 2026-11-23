import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const source = readFileSync(new URL('./AiProjectWorkspace.vue', import.meta.url), 'utf8')

describe('AI project workspace view', () => {
  it('supports folder-based project creation and model selection', () => {
    assert.match(source, /chooseProjectFolder/)
    assert.match(source, /profileId/)
    assert.match(source, /javascript/)
    assert.match(source, /python/)
  })

  it('provides conversation controls, retry, and an inspector toggle', () => {
    assert.match(source, /sendMessage/)
    assert.match(source, /cancelTurn/)
    assert.match(source, /analyzeProject/)
    assert.match(source, /AI 分析、构建并导入/)
    assert.match(source, /toggleInspector/)
    assert.match(source, /调整检查面板宽度/)
    assert.match(source, /ai-inspector--drawer/)
    assert.match(source, /aria-label="关闭检查面板"/)
  })

  it('describes the explicitly triggered build, check, and import workflow', () => {
    assert.match(source, /完成构建和全部检查后自动导入/)
    assert.match(source, /手动触发分析、构建与检查后，才会导入脚本/)
  })

  it('keeps project selection separate from rename, pin, export, and delete actions', () => {
    assert.match(source, /aria-label="项目操作"/)
    assert.match(source, /重命名项目/)
    assert.match(source, /置顶项目/)
    assert.match(source, /导出对话/)
    assert.match(source, /删除项目/)
    assert.match(source, /@click="openProjectActionsId = null; state\.openProject\(project\.id\)"/)
  })

  it('requires two independent confirmations before removing a project', () => {
    assert.equal((source.match(/await askConfirm\(/g) ?? []).length, 2)
  })
})
