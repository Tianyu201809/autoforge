import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest, type ScriptManifest } from '../../shared/script-contract'
import type { ScriptRepairContext } from '../../shared/llm-types'
import { ConversionPlanError } from './llm-converter'
import {
  createScriptRepairer,
  mergeManifestPatch,
  parseRepairPlanSkeleton,
  validatePatchedManifest,
  type RepairChanges
} from './llm-repair'
import type { createLlmClient } from './llm-client'

function planJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: '修复缺少依赖导致的 ImportError',
    diagnosis: 'requirements 里漏了 requests，代码直接 import 导致启动即失败',
    files: [{ path: 'index.py', purpose: '补充错误处理与依赖导入' }],
    deleteFiles: [],
    manifestPatch: { dependencies: { requests: '>=2.31.0' } },
    ...overrides
  })
}

const BASE_MANIFEST: ScriptManifest = {
  autoforge: '1.0',
  name: 'demo',
  entry: 'index.py',
  language: 'python',
  category: 'local',
  env: [],
  params: [],
  dependencies: { click: '>=8.0.0' }
}

// ---------- 计划骨架 ----------

test('parseRepairPlanSkeleton 解析合法计划', () => {
  const plan = parseRepairPlanSkeleton(planJson())
  assert.equal(plan.files.length, 1)
  assert.equal(plan.files[0].path, 'index.py')
  assert.equal(plan.manifestPatch?.dependencies?.requests, '>=2.31.0')
  assert.match(plan.diagnosis, /requests/)
})

test('parseRepairPlanSkeleton 兼容 Markdown 代码块', () => {
  const plan = parseRepairPlanSkeleton('```json\n' + planJson() + '\n```')
  assert.equal(plan.summary.length > 0, true)
})

test('parseRepairPlanSkeleton 拒绝缺少 summary', () => {
  assert.throws(() => parseRepairPlanSkeleton(planJson({ summary: '' })), ConversionPlanError)
})

test('parseRepairPlanSkeleton 拒绝删除清单文件', () => {
  assert.throws(
    () => parseRepairPlanSkeleton(planJson({ files: [], deleteFiles: ['autoforge.json'] })),
    ConversionPlanError
  )
})

test('parseRepairPlanSkeleton 拒绝越界的文件路径', () => {
  assert.throws(
    () => parseRepairPlanSkeleton(planJson({ files: [{ path: '../escape.py', purpose: 'x' }] })),
    ConversionPlanError
  )
})

test('parseRepairPlanSkeleton 拒绝越界的删除路径', () => {
  assert.throws(
    () => parseRepairPlanSkeleton(planJson({ files: [], deleteFiles: ['../../etc/passwd'] })),
    ConversionPlanError
  )
})

test('parseRepairPlanSkeleton 去掉同时出现在 files 与 deleteFiles 的条目', () => {
  const plan = parseRepairPlanSkeleton(
    planJson({
      files: [{ path: 'index.py', purpose: '重写' }],
      deleteFiles: ['index.py']
    })
  )
  assert.deepEqual(plan.deleteFiles, [])
})

test('parseRepairPlanSkeleton 在没有改动时给出可读原因', () => {
  assert.throws(
    () =>
      parseRepairPlanSkeleton(
        planJson({
          files: [],
          deleteFiles: [],
          manifestPatch: undefined,
          warnings: ['需要用户提供 API 凭证']
        })
      ),
    (error: unknown) => {
      assert.ok(error instanceof ConversionPlanError)
      assert.match(error.message, /无法通过修改代码解决/)
      assert.match(error.message, /API 凭证/)
      return true
    }
  )
})

test('parseRepairPlanSkeleton 拒绝非 JSON 输出', () => {
  assert.throws(() => parseRepairPlanSkeleton('我无法修复这个问题'), ConversionPlanError)
})

// ---------- 清单补丁 ----------

test('mergeManifestPatch 合并依赖而不丢弃原有依赖', () => {
  const merged = mergeManifestPatch(BASE_MANIFEST, {
    dependencies: { requests: '>=2.31.0' }
  })
  assert.deepEqual(merged.dependencies, { click: '>=8.0.0', requests: '>=2.31.0' })
})

test('mergeManifestPatch 覆盖入口与 env/params', () => {
  const merged = mergeManifestPatch(BASE_MANIFEST, {
    entry: 'main.py',
    env: [{ key: 'API_URL', label: '接口地址' }],
    params: [{ key: 'QUERY', label: '查询词' }]
  })
  assert.equal(merged.entry, 'main.py')
  assert.equal(merged.env?.[0].key, 'API_URL')
  assert.equal(merged.params?.[0].key, 'QUERY')
})

test('mergeManifestPatch 在没有补丁时原样返回', () => {
  assert.equal(mergeManifestPatch(BASE_MANIFEST, undefined), BASE_MANIFEST)
})

test('validatePatchedManifest 归一化模型给出的非法 type', () => {
  const merged = mergeManifestPatch(BASE_MANIFEST, {
    params: [{ key: 'LIMIT', label: '条数', type: '随便写的类型' }]
  })
  const validated = validatePatchedManifest(merged)
  assert.equal(validated.params?.[0].type, 'text')
})

test('validatePatchedManifest 拒绝缺少 name 的清单', () => {
  assert.throws(() => validatePatchedManifest({ ...BASE_MANIFEST, name: '' }), ConversionPlanError)
})

test('清单补丁产出的结果仍能通过 validateManifest', () => {
  const merged = mergeManifestPatch(BASE_MANIFEST, { dependencies: { requests: '>=2.31.0' } })
  const result = validateManifest(merged)
  assert.equal(result.ok, true)
})

// ---------- 端到端 ----------

const REPAIR_PROFILE = {
  id: 'p1',
  name: '测试配置',
  kind: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1',
  model: 'demo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function makeRepairer(options: {
  reply: (input: { json?: boolean; lastMessage: string }) => { content: string; finishReason?: string }
  context?: ScriptRepairContext | null
}): { repairer: ReturnType<typeof createScriptRepairer>; applied: RepairChanges[] } {
  const applied: RepairChanges[] = []
  const context: ScriptRepairContext =
    options.context === undefined
      ? {
          scriptId: 's1',
          name: 'demo',
          entry: 'index.py',
          language: 'python',
          manifestText: JSON.stringify(BASE_MANIFEST),
          files: [{ path: 'index.py', content: 'import requests\n' }],
          recentRuns: [{ status: 'error', startedAt: '2026-01-01T00:00:00.000Z', exitCode: 1 }],
          logs: ['ModuleNotFoundError: No module named requests']
        }
      : (options.context as ScriptRepairContext)

  const client = {
    chat: async (input: { json?: boolean; messages: Array<{ role: string; content: string }> }) =>
      options.reply({
        json: input.json,
        lastMessage: input.messages[input.messages.length - 1].content
      }),
    chatStream: async (input: {
      json?: boolean
      messages: Array<{ role: string; content: string }>
      onDelta?: (delta: string, total: number) => void
    }) => {
      const result = options.reply({
        json: input.json,
        lastMessage: input.messages[input.messages.length - 1].content
      })
      input.onDelta?.(result.content, result.content.length)
      return { ...result, streamed: true }
    },
    testConnection: async () => ({ ok: true, message: 'ok' })
  } as unknown as ReturnType<typeof createLlmClient>

  const repairer = createScriptRepairer({
    client,
    resolveProfile: () => ({ profile: REPAIR_PROFILE, apiKey: 'key' }),
    readContext: () => context,
    applyChanges: (_scriptId, changes) => {
      applied.push(changes)
      return {
        changedFiles: changes.files.map((file) => file.path),
        deletedFiles: changes.deleteFiles,
        manifestUpdated: Boolean(changes.manifestPatch)
      }
    }
  })

  return { repairer, applied }
}

test('repair 端到端：分析根因、重写文件、补充依赖', async () => {
  const { repairer, applied } = makeRepairer({
    reply: (input) =>
      input.json
        ? { content: planJson(), finishReason: 'stop' }
        : { content: '```python\nimport requests\n\ndef run(ctx):\n    return {"ok": True}\n```', finishReason: 'stop' }
  })

  const logs: string[] = []
  const result = await repairer.repair({
    scriptId: 's1',
    logs: ['ModuleNotFoundError: No module named requests'],
    onLog: (line) => logs.push(`${line.level}:${line.message}`)
  })

  assert.equal(result.changedFiles.length, 1)
  assert.equal(result.manifestUpdated, true)
  assert.match(result.diagnosis, /requests/)
  // 代码围栏被剥离
  assert.equal(applied[0].files[0].content, 'import requests\n\ndef run(ctx):\n    return {"ok": True}')
  assert.deepEqual(applied[0].manifestPatch?.dependencies, { requests: '>=2.31.0' })
  assert.ok(logs.some((line) => line.includes('根因判断')))
})

test('repair 在脚本上下文缺失时报错', async () => {
  const { repairer } = makeRepairer({ reply: () => ({ content: planJson() }), context: null })
  await assert.rejects(
    () => repairer.repair({ scriptId: 'missing' }),
    (error: unknown) => {
      assert.ok(error instanceof ConversionPlanError)
      assert.match(error.message, /脚本不存在/)
      return true
    }
  )
})

test('repair 在计划被截断时给出明确提示', async () => {
  const { repairer } = makeRepairer({ reply: () => ({ content: '{"summary":"x"', finishReason: 'length' }) })
  await assert.rejects(
    () => repairer.repair({ scriptId: 's1' }),
    (error: unknown) => {
      assert.ok(error instanceof ConversionPlanError)
      assert.match(error.message, /最大输出 tokens/)
      return true
    }
  )
})
