import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const panelSource = readFileSync(new URL('./DevGuidePanel.vue', import.meta.url), 'utf8')
const skillDir = new URL('../../../../skills/autoforge-script-create/', import.meta.url)
const skill = readFileSync(new URL('SKILL.md', skillDir), 'utf8')
const prompt = readFileSync(new URL('agent-prompt.md', skillDir), 'utf8')
const reference = readFileSync(new URL('reference.md', skillDir), 'utf8')

function frontmatterDescription(markdown) {
  const end = markdown.indexOf('\n---', 3)
  const block = markdown.slice(3, end)
  const line = block.split('\n').find((item) => item.startsWith('description:'))
  return line?.slice('description:'.length).trim() ?? ''
}

describe('脚本开发指南 · 交给 Agent', () => {
  it('默认打开可复制的规则提示词，并标明确认前不写代码', () => {
    assert.match(panelSource, /ref<'agent' \| 'guide' \| 'examples'>\('agent'\)/)
    assert.match(panelSource, /复制规则提示词/)
    assert.match(panelSource, /确认前不写代码/)
    assert.match(panelSource, /agentPrompt/)
    assert.match(panelSource, /《脚本确认清单》/)
  })

  it('提示词要求多轮澄清，并在确认后才允许写脚本', () => {
    assert.match(prompt, /阶段 1 · 澄清/)
    assert.match(prompt, /阶段 2 · 确认清单/)
    assert.match(prompt, /未收到对《脚本确认清单》的明确同意之前/)
    assert.match(prompt, /不要创建或修改文件/)
    assert.match(prompt, /配置 Tab/)
    assert.match(prompt, /运行参数 Tab/)
    assert.match(prompt, /ctx\.session_id/)
    assert.match(prompt, /outputDir/)
    assert.equal(prompt.startsWith('---'), false)
  })

  it('Skill 覆盖同一套阶段，并把字段契约放在 reference', () => {
    const description = frontmatterDescription(skill)
    assert.ok(description.length > 0 && description.length <= 1024)
    assert.match(description, /确认《脚本确认清单》之前不写代码/)
    assert.match(description, /\/autoforge-script-create/)
    assert.ok(skill.split('\n').length < 500)
    assert.match(skill, /### 1 · 澄清/)
    assert.match(skill, /### 2 · 确认清单/)
    assert.match(reference, /运行参数」Tab/)
    assert.match(reference, /AUTOFORGE_PARAMS_JSON/)
    assert.match(reference, /language: "executable"/)
  })
})
