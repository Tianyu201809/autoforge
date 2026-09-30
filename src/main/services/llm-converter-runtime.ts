import { net } from 'electron'
import { createLlmClient } from './llm-client'
import { createLlmConverter, type LlmConverter } from './llm-converter'
import { createScriptRepairer, type ScriptRepairer } from './llm-repair'
import { getLlmProfileService } from './llm-profile-service'
import { readRepoToAutoforgeSkill } from './repo-conversion-service'
import { applyScriptRepair, readScriptRepairContext } from './script-repair-io'

/**
 * 把 Electron 相关的依赖（net.fetch、配置服务、技能文件读取、工作区读写）装配到
 * 转换引擎与修复引擎。与 `llm-converter.ts` / `llm-repair.ts` 分离，
 * 使后两者保持纯 Node 依赖，便于单元测试。
 */
let converter: LlmConverter | null = null
let repairer: ScriptRepairer | null = null

function createClient(): ReturnType<typeof createLlmClient> {
  return createLlmClient({ request: (url, init) => net.fetch(url, init) })
}

export function getLlmConverter(): LlmConverter {
  if (!converter) {
    converter = createLlmConverter({
      client: createClient(),
      resolveProfile: (profileId) => getLlmProfileService().resolve(profileId),
      readSkillMarkdown: readRepoToAutoforgeSkill
    })
  }
  return converter
}

export function getScriptRepairer(): ScriptRepairer {
  if (!repairer) {
    repairer = createScriptRepairer({
      client: createClient(),
      resolveProfile: (profileId) => getLlmProfileService().resolve(profileId),
      readContext: (scriptId, logs) => readScriptRepairContext(scriptId, logs),
      applyChanges: (scriptId, changes) => applyScriptRepair(scriptId, changes)
    })
  }
  return repairer
}
