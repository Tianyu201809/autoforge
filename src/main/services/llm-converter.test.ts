import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  assertSafePackagePath,
  assertSafeRelativePath,
  buildManifestFromPlan,
  ConversionPlanError,
  copyFromRepo,
  createLatestThrottle,
  createLlmConverter,
  isPromptLimitError,
  joinContinuation,
  parseConversionPlan,
  findEntryContractViolations,
  parseFileContent,
  parsePlanSkeleton,
  resolvePackageFilePath,
  stripCodeFence
} from './llm-converter'
import { MAX_PLAN_FILES } from '../../shared/llm-types'
import { LlmClientError } from './llm-client'
import type { RepoProfile } from '../../shared/repo-types'

function skeletonJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: '包装仓库 CLI',
    language: 'javascript',
    entry: 'index.mjs',
    name: 'demo-runner',
    description: '把仓库 CLI 包装成 Autoforge 脚本',
    category: 'local',
    dependencies: { 'left-pad': '>=1.3.0' },
    env: [{ key: 'API_URL', label: '接口地址', default: 'https://example.com' }],
    params: [{ key: 'QUERY', label: '查询词', type: 'text' }],
    files: [{ path: 'index.mjs', purpose: '适配入口', source: 'generate' }],
    buildCommands: [],
    ...overrides
  })
}

function planJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: '包装仓库 CLI',
    language: 'javascript',
    entry: 'index.mjs',
    name: 'demo-runner',
    description: '把仓库 CLI 包装成 Autoforge 脚本',
    category: 'local',
    dependencies: { 'left-pad': '>=1.3.0' },
    env: [{ key: 'API_URL', label: '接口地址', default: 'https://example.com' }],
    params: [{ key: 'QUERY', label: '查询词', type: 'text' }],
    files: [{ path: 'index.mjs', content: 'export async function run(ctx) { return { ok: true } }' }],
    copies: [],
    buildCommands: [],
    ...overrides
  })
}

// ---------- 路径安全 ----------

test('assertSafePackagePath 接受包内相对路径', () => {
  assert.equal(assertSafePackagePath('index.mjs'), 'index.mjs')
  assert.equal(assertSafePackagePath('./vendor/lib.js'), 'vendor/lib.js')
  assert.equal(assertSafePackagePath('vendor\\win\\lib.js'), 'vendor/win/lib.js')
})

test('assertSafePackagePath 拒绝绝对路径与盘符', () => {
  assert.throws(() => assertSafePackagePath('/etc/passwd'), ConversionPlanError)
  assert.throws(() => assertSafePackagePath('C:/Windows/system32'), ConversionPlanError)
  assert.throws(() => assertSafePackagePath('\\\\server\\share'), ConversionPlanError)
})

test('assertSafePackagePath 拒绝上级目录', () => {
  assert.throws(() => assertSafePackagePath('../outside.js'), ConversionPlanError)
  assert.throws(() => assertSafePackagePath('vendor/../../outside.js'), ConversionPlanError)
})

test('assertSafePackagePath 拒绝依赖与元数据目录', () => {
  assert.throws(() => assertSafePackagePath('node_modules/evil/index.js'), ConversionPlanError)
  assert.throws(() => assertSafePackagePath('.git/hooks/pre-commit'), ConversionPlanError)
  assert.throws(() => assertSafePackagePath('.venv/lib/site.py'), ConversionPlanError)
})

test('assertSafePackagePath 拒绝空路径', () => {
  assert.throws(() => assertSafePackagePath('   '), ConversionPlanError)
})

test('resolvePackageFilePath 结果始终落在包目录内', () => {
  const packageDir = resolve('C:/tmp/pkg')
  const target = resolvePackageFilePath(packageDir, 'vendor/lib.js')
  assert.equal(target, join(packageDir, 'vendor', 'lib.js'))
  assert.ok(target.startsWith(packageDir + sep))
})

test('assertSafeRelativePath 支持自定义标签用于复制源校验', () => {
  assert.equal(assertSafeRelativePath('dist/app.js', '复制源路径'), 'dist/app.js')
  assert.throws(() => assertSafeRelativePath('../escape', '复制源路径'), ConversionPlanError)
})

// ---------- 阶段一：计划骨架 ----------

test('parsePlanSkeleton 解析合法骨架', () => {
  const skeleton = parsePlanSkeleton(skeletonJson())
  assert.equal(skeleton.language, 'javascript')
  assert.equal(skeleton.entry, 'index.mjs')
  assert.equal(skeleton.files.length, 1)
  assert.equal(skeleton.files[0].source, 'generate')
})

test('parsePlanSkeleton 识别 copy 条目并校验 copyFrom', () => {
  const files = [
    { path: 'index.mjs', purpose: '适配入口', source: 'generate' },
    { path: 'vendor/dist/app.js', purpose: '构建产物', source: 'copy', copyFrom: 'dist/app.js' }
  ]
  const skeleton = parsePlanSkeleton(skeletonJson({ files }))
  assert.equal(skeleton.files[1].source, 'copy')
  assert.equal(skeleton.files[1].copyFrom, 'dist/app.js')
})

test('parsePlanSkeleton 拒绝缺少 copyFrom 的 copy 条目', () => {
  const files = [{ path: 'vendor/app.js', purpose: '产物', source: 'copy' }]
  assert.throws(() => parsePlanSkeleton(skeletonJson({ files })), ConversionPlanError)
})

test('parsePlanSkeleton 拒绝越界的 copyFrom', () => {
  const files = [
    { path: 'index.mjs', purpose: '入口', source: 'generate' },
    { path: 'vendor/x.js', purpose: '产物', source: 'copy', copyFrom: '../../etc/passwd' }
  ]
  assert.throws(() => parsePlanSkeleton(skeletonJson({ files })), ConversionPlanError)
})

test('parsePlanSkeleton 拒绝 node_modules 作为复制源', () => {
  const files = [
    { path: 'index.mjs', purpose: '入口', source: 'generate' },
    { path: 'vendor/x.js', purpose: '产物', source: 'copy', copyFrom: 'node_modules/x/index.js' }
  ]
  assert.throws(() => parsePlanSkeleton(skeletonJson({ files })), ConversionPlanError)
})

test('parsePlanSkeleton 限制文件条数', () => {
  const files = Array.from({ length: MAX_PLAN_FILES + 1 }, (_, index) => ({
    path: `f${index}.mjs`,
    purpose: 'x',
    source: 'generate'
  }))
  assert.throws(() => parsePlanSkeleton(skeletonJson({ files })), ConversionPlanError)
})

test('parsePlanSkeleton 拒绝非 JSON 输出', () => {
  assert.throws(() => parsePlanSkeleton('抱歉，我无法完成。'), ConversionPlanError)
})

// ---------- 阶段二：文件内容 ----------

test('stripCodeFence 去掉代码块围栏', () => {
  assert.equal(stripCodeFence('```js\nconst a = 1\n```'), 'const a = 1')
  assert.equal(stripCodeFence('```\nconst a = 1\n```'), 'const a = 1')
  assert.equal(stripCodeFence('const a = 1'), 'const a = 1')
})

test('parseFileContent 接受纯文本并剥离围栏', () => {
  const content = parseFileContent('```mjs\nexport async function run(ctx) {}\n```', 'index.mjs')
  assert.equal(content, 'export async function run(ctx) {}')
})

test('parseFileContent 拒绝空内容', () => {
  assert.throws(() => parseFileContent('   ', 'index.mjs'), ConversionPlanError)
})

test('parseFileContent 拒绝超限内容', () => {
  assert.throws(() => parseFileContent('x'.repeat(600 * 1024), 'big.js'), ConversionPlanError)
})

test('入口契约拒绝 CommonJS，并接受 ESM run', () => {
  const broken = 'import { createServer } from "node:http"\nif (require.main === module) main()\nmodule.exports = {}\n'
  const violations = findEntryContractViolations('index.mjs', broken, 'index.mjs', 'javascript')
  assert.ok(violations.some((item) => item.includes('run(ctx)')))
  assert.ok(violations.some((item) => item.includes('require')))
  assert.deepEqual(
    findEntryContractViolations(
      'index.mjs',
      'export async function run(ctx) { ctx.log("INFO", "ok") }',
      'index.mjs',
      'javascript'
    ),
    []
  )
  assert.deepEqual(
    findEntryContractViolations('vendor/app.js', 'module.exports = {}', 'index.mjs', 'javascript'),
    []
  )
})

// ---------- 合并校验 ----------

test('parseConversionPlan 解析合法计划', () => {
  const plan = parseConversionPlan(planJson())
  assert.equal(plan.entry, 'index.mjs')
  assert.equal(plan.files.length, 1)
  assert.deepEqual(plan.copies, [])
})

test('parseConversionPlan 兼容被 Markdown 代码块包裹的输出', () => {
  assert.equal(parseConversionPlan('```json\n' + planJson() + '\n```').name, 'demo-runner')
})

test('parseConversionPlan 拒绝不支持的目标语言', () => {
  assert.throws(() => parseConversionPlan(planJson({ language: 'executable' })), ConversionPlanError)
})

test('parseConversionPlan 拒绝入口未被覆盖', () => {
  assert.throws(() => parseConversionPlan(planJson({ entry: 'main.mjs' })), ConversionPlanError)
})

test('parseConversionPlan 允许入口由复制产物提供', () => {
  const plan = parseConversionPlan(
    planJson({
      entry: 'vendor/dist/app.js',
      files: [],
      copies: [{ from: 'dist', to: 'vendor/dist' }]
    })
  )
  assert.equal(plan.entry, 'vendor/dist/app.js')
  assert.equal(plan.copies.length, 1)
})

test('parseConversionPlan 拒绝重复文件', () => {
  const files = [
    { path: 'index.mjs', content: 'a' },
    { path: 'index.mjs', content: 'b' }
  ]
  assert.throws(() => parseConversionPlan(planJson({ files })), ConversionPlanError)
})

test('parseConversionPlan 拒绝越界文件路径', () => {
  const files = [{ path: '../escape.mjs', content: 'x' }]
  assert.throws(() => parseConversionPlan(planJson({ entry: '../escape.mjs', files })), ConversionPlanError)
})

test('parseConversionPlan 拒绝越界复制目标', () => {
  assert.throws(
    () => parseConversionPlan(planJson({ copies: [{ from: 'dist', to: '../outside' }] })),
    ConversionPlanError
  )
})

test('parseConversionPlan 忽略模型自带的 autoforge.json', () => {
  const files = [
    { path: 'index.mjs', content: 'export async function run(ctx) {}' },
    { path: 'autoforge.json', content: '{"autoforge":"1.0","name":"伪造"}' }
  ]
  const plan = parseConversionPlan(planJson({ files }))
  assert.equal(plan.files.length, 1)
})

test('parseConversionPlan 拒绝空计划', () => {
  assert.throws(() => parseConversionPlan(planJson({ files: [] })), ConversionPlanError)
})

test('buildManifestFromPlan 生成通过校验的清单', () => {
  const manifest = buildManifestFromPlan(parseConversionPlan(planJson()))
  assert.equal(manifest.autoforge, '1.0')
  assert.equal(manifest.entry, 'index.mjs')
  assert.equal(manifest.env?.[0].key, 'API_URL')
})

// ---------- 复制实现 ----------

function withDirs<T>(run: (repoDir: string, packageDir: string) => T): T {
  const base = mkdtempSync(join(tmpdir(), 'autoforge-copy-'))
  try {
    const repoDir = join(base, 'repo')
    const packageDir = join(base, 'package')
    mkdirSync(repoDir, { recursive: true })
    mkdirSync(packageDir, { recursive: true })
    return run(repoDir, packageDir)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

test('copyFromRepo 复制单个文件', () => {
  withDirs((repoDir, packageDir) => {
    mkdirSync(join(repoDir, 'dist'), { recursive: true })
    writeFileSync(join(repoDir, 'dist', 'app.js'), 'console.log(1)', 'utf-8')

    const stats = { files: 0, bytes: 0 }
    copyFromRepo(repoDir, packageDir, { from: 'dist/app.js', to: 'vendor/app.js' }, stats)

    assert.equal(readFileSync(join(packageDir, 'vendor', 'app.js'), 'utf-8'), 'console.log(1)')
    assert.equal(stats.files, 1)
  })
})

test('copyFromRepo 递归复制目录并跳过依赖目录', () => {
  withDirs((repoDir, packageDir) => {
    mkdirSync(join(repoDir, 'dist', 'assets'), { recursive: true })
    mkdirSync(join(repoDir, 'dist', 'node_modules'), { recursive: true })
    writeFileSync(join(repoDir, 'dist', 'index.js'), 'a', 'utf-8')
    writeFileSync(join(repoDir, 'dist', 'assets', 'app.css'), 'b', 'utf-8')
    writeFileSync(join(repoDir, 'dist', 'node_modules', 'x.js'), 'c', 'utf-8')

    const stats = { files: 0, bytes: 0 }
    copyFromRepo(repoDir, packageDir, { from: 'dist', to: 'vendor/dist' }, stats)

    assert.ok(existsSync(join(packageDir, 'vendor', 'dist', 'index.js')))
    assert.ok(existsSync(join(packageDir, 'vendor', 'dist', 'assets', 'app.css')))
    assert.ok(!existsSync(join(packageDir, 'vendor', 'dist', 'node_modules')))
    assert.equal(stats.files, 2)
  })
})

test('copyFromRepo 在复制源不存在时给出可操作提示', () => {
  withDirs((repoDir, packageDir) => {
    assert.throws(
      () => copyFromRepo(repoDir, packageDir, { from: 'dist', to: 'vendor/dist' }, { files: 0, bytes: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof ConversionPlanError)
        assert.match(error.message, /构建是否成功/)
        return true
      }
    )
  })
})

test('copyFromRepo 拒绝越界的复制源', () => {
  withDirs((repoDir, packageDir) => {
    assert.throws(
      () => copyFromRepo(repoDir, packageDir, { from: '../escape', to: 'vendor' }, { files: 0, bytes: 0 }),
      ConversionPlanError
    )
  })
})

test('copyFromRepo 在超出文件数上限时中止', () => {
  withDirs((repoDir, packageDir) => {
    mkdirSync(join(repoDir, 'dist'), { recursive: true })
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(repoDir, 'dist', `f${index}.js`), 'x', 'utf-8')
    }
    assert.throws(
      () => copyFromRepo(repoDir, packageDir, { from: 'dist', to: 'vendor/dist' }, { files: 1998, bytes: 0 }),
      ConversionPlanError
    )
  })
})

// ---------- 端到端：两阶段转换 ----------

const REPO_PROFILE: RepoProfile = {
  ref: {
    provider: 'github',
    owner: 'octocat',
    repo: 'demo',
    url: 'https://github.com/octocat/demo',
    transport: 'https',
    cloneUrl: 'https://github.com/octocat/demo.git'
  },
  resolvedRef: 'main',
  fetchMethod: 'git',
  commitSha: null,
  rootDir: '',
  fileCount: 2,
  totalBytes: 40,
  license: 'MIT',
  readme: null,
  languages: [{ name: 'JavaScript', files: 2, bytes: 40 }],
  manifests: ['package.json'],
  entryCandidates: ['index.js'],
  runtimeDependencies: [],
  hasBuildScript: true,
  hasNativeBinary: false,
  hasWebServer: false,
  hasMonorepo: false,
  convertibility: 'needs-build',
  convertibilityReason: '需要构建',
  risks: [],
  topLevel: []
}

const LLM_PROFILE = {
  id: 'p1',
  name: '测试配置',
  kind: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1',
  model: 'demo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

interface MockReply {
  content: string
  finishReason?: string
}

interface MockChatInput {
  json?: boolean
  messages: Array<{ role: string; content: string }>
  onDelta?: (delta: string, totalChars: number) => void
}

function makeConverter(reply: (input: { json?: boolean; lastMessage: string }) => MockReply): ReturnType<typeof createLlmConverter> {
  const run = (input: MockChatInput): MockReply =>
    reply({ json: input.json, lastMessage: input.messages[input.messages.length - 1].content })

  const client = {
    chat: async (input: MockChatInput) => run(input),
    // 模拟流式：一次性回调完整内容，同时覆盖流式分支
    chatStream: async (input: MockChatInput) => {
      const result = run(input)
      input.onDelta?.(result.content, result.content.length)
      return { ...result, streamed: true }
    },
    testConnection: async () => ({ ok: true, message: 'ok' })
  } as unknown as Parameters<typeof createLlmConverter>[0]['client']

  return createLlmConverter({
    client,
    resolveProfile: () => ({ profile: LLM_PROFILE, apiKey: 'key' }),
    readSkillMarkdown: () => undefined
  })
}

test('convert 端到端：骨架 + 逐文件生成 + 复制构建产物', async () => {
  const base = mkdtempSync(join(tmpdir(), 'autoforge-convert-e2e-'))
  const repoDir = join(base, 'repo')
  const packageDir = join(base, 'package')
  try {
    mkdirSync(join(repoDir, 'dist'), { recursive: true })
    writeFileSync(join(repoDir, 'dist', 'app.js'), 'module.exports = {}', 'utf-8')
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf-8')

    const seen: Array<{ json?: boolean; lastMessage: string }> = []
    const converter = makeConverter((input) => {
      seen.push(input)
      if (input.json) {
        return {
          finishReason: 'stop',
          content: JSON.stringify({
            summary: '包装仓库 CLI',
            language: 'javascript',
            entry: 'index.mjs',
            name: 'demo-runner',
            dependencies: {},
            env: [],
            params: [],
            files: [
              { path: 'index.mjs', purpose: '适配入口', source: 'generate' },
              { path: 'vendor/dist/app.js', purpose: '构建产物', source: 'copy', copyFrom: 'dist/app.js' }
            ],
            buildCommands: []
          })
        }
      }
      return {
        finishReason: 'stop',
        content: '```mjs\nexport async function run(ctx) { return { ok: true } }\n```'
      }
    })

    const logs: string[] = []
    const result = await converter.convert({
      taskId: 't1',
      repoDir,
      packageDir,
      repoProfile: REPO_PROFILE,
      allowBuild: false,
      onLog: (line) => logs.push(`${line.level}:${line.message}`)
    })

    // 一次骨架 + 一次文件内容
    assert.equal(seen.length, 2)
    assert.equal(seen[0].json, true)
    assert.equal(seen[1].json, false)

    assert.equal(result.copiedEntries, 1)
    assert.equal(result.writtenFiles, 3)
    assert.ok(existsSync(join(packageDir, 'index.mjs')))
    assert.ok(existsSync(join(packageDir, 'vendor', 'dist', 'app.js')))
    assert.ok(existsSync(join(packageDir, 'autoforge.json')))

    // 代码围栏被剥离，入口内容干净
    assert.equal(
      readFileSync(join(packageDir, 'index.mjs'), 'utf-8'),
      'export async function run(ctx) { return { ok: true } }'
    )
    // 清单由主进程生成
    const manifest = JSON.parse(readFileSync(join(packageDir, 'autoforge.json'), 'utf-8')) as {
      entry: string
      name: string
    }
    assert.equal(manifest.entry, 'index.mjs')
    assert.equal(manifest.name, 'demo-runner')
    assert.ok(logs.some((line) => line.includes('复制 dist/app.js')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('入口写成 CommonJS 时会要求重写一次', async () => {
  const base = mkdtempSync(join(tmpdir(), 'autoforge-convert-retry-'))
  const repoDir = join(base, 'repo')
  const packageDir = join(base, 'package')
  try {
    mkdirSync(repoDir, { recursive: true })
    let fileCalls = 0
    const seen: string[] = []
    const converter = makeConverter((input) => {
      if (input.json) {
        return {
          finishReason: 'stop',
          content: JSON.stringify({
            summary: '静态服务',
            language: 'javascript',
            entry: 'index.mjs',
            name: 'demo',
            dependencies: {},
            env: [],
            params: [],
            files: [{ path: 'index.mjs', purpose: '入口', source: 'generate' }],
            buildCommands: []
          })
        }
      }
      seen.push(input.lastMessage)
      fileCalls += 1
      if (fileCalls === 1) {
        return { finishReason: 'stop', content: 'if (require.main === module) main()\nmodule.exports = {}' }
      }
      return { finishReason: 'stop', content: 'export async function run(ctx) { return { ok: true } }' }
    })

    const result = await converter.convert({
      taskId: 'retry',
      repoDir,
      packageDir,
      repoProfile: REPO_PROFILE,
      allowBuild: false
    })

    assert.equal(result.packageReady, true)
    assert.equal(fileCalls, 2)
    assert.match(seen[1] ?? '', /不能直接运行/)
    assert.equal(
      readFileSync(join(packageDir, 'index.mjs'), 'utf-8'),
      'export async function run(ctx) { return { ok: true } }'
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('输出达到长度上限时自动续写，转换不会因此中断', async () => {
  const base = mkdtempSync(join(tmpdir(), 'autoforge-convert-trunc-'))
  const repoDir = join(base, 'repo')
  const packageDir = join(base, 'package')
  const skeletonRest =
    ',"language":"javascript","entry":"index.mjs","name":"demo","dependencies":{},"env":[],"params":[],"files":[{"path":"index.mjs","purpose":"入口","source":"generate"}],"buildCommands":[]}'
  const replies = [
    { content: '{"summary":"包装仓库"', finishReason: 'length' },
    { content: skeletonRest, finishReason: 'stop' },
    { content: 'export async function run(ctx) {', finishReason: 'length' },
    { content: ' return { ok: true } }', finishReason: 'stop' }
  ]
  try {
    mkdirSync(repoDir, { recursive: true })
    let call = 0
    const seen: string[] = []
    const converter = makeConverter((input) => {
      seen.push(input.lastMessage)
      const next = replies[call]
      call += 1
      if (!next) throw new Error(`意外的第 ${call} 次模型调用`)
      return next
    })

    const result = await converter.convert({
      taskId: 't2',
      repoDir,
      packageDir,
      repoProfile: REPO_PROFILE,
      allowBuild: false
    })

    assert.equal(result.packageReady, true)
    assert.equal(
      readFileSync(join(packageDir, 'index.mjs'), 'utf-8'),
      'export async function run(ctx) { return { ok: true } }'
    )
    assert.match(seen[1] ?? '', /从截断处接着写/)
    assert.match(seen[1] ?? '', /包装仓库/)
    assert.match(seen[3] ?? '', /run\(ctx\)/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('上下文超出模型上限时缩短摘要后重试', async () => {
  const base = mkdtempSync(join(tmpdir(), 'autoforge-convert-context-'))
  const repoDir = join(base, 'repo')
  const packageDir = join(base, 'package')
  const skeleton = JSON.stringify({
    summary: 'x',
    language: 'javascript',
    entry: 'index.mjs',
    name: 'demo',
    dependencies: {},
    env: [],
    params: [],
    files: [{ path: 'index.mjs', purpose: '入口', source: 'generate' }],
    buildCommands: []
  })
  try {
    mkdirSync(repoDir, { recursive: true })
    let skeletonTries = 0
    const converter = createLlmConverter({
      client: {
        chat: async () => ({ content: '' }),
        chatStream: async (input: { messages: Array<{ content: string }> }) => {
          const last = input.messages[input.messages.length - 1]?.content ?? ''
          if (last.includes('计划骨架')) {
            skeletonTries += 1
            if (skeletonTries === 1) {
              throw new LlmClientError("This model's maximum context length is 8192 tokens", 'invalid_response')
            }
            return { content: skeleton, finishReason: 'stop', streamed: true }
          }
          return {
            content: 'export async function run(ctx) { return { ok: true } }',
            finishReason: 'stop',
            streamed: true
          }
        },
        testConnection: async () => ({ ok: true, message: 'ok' })
      } as unknown as Parameters<typeof createLlmConverter>[0]['client'],
      resolveProfile: () => ({ profile: LLM_PROFILE, apiKey: 'key' }),
      readSkillMarkdown: () => undefined
    })

    const result = await converter.convert({
      taskId: 't-context',
      repoDir,
      packageDir,
      repoProfile: REPO_PROFILE,
      allowBuild: false
    })

    assert.equal(skeletonTries, 2)
    assert.equal(result.packageReady, true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('续写会去掉重叠，思考上报会被节流', () => {
  assert.equal(joinContinuation('export function run() {', ' return 1 }'), 'export function run() { return 1 }')
  assert.equal(joinContinuation('abcdef', 'abcdefghi'), 'abcdefghi')
  assert.equal(
    joinContinuation('abcdefghijklmnopqrstuvwxyz', 'klmnopqrstuvwxyz0123'),
    'abcdefghijklmnopqrstuvwxyz0123'
  )
  assert.equal(isPromptLimitError(new Error('maximum context length is 8192 tokens')), true)
  assert.equal(isPromptLimitError(new Error('网络中断')), false)

  const seen: string[] = []
  const gate = createLatestThrottle((text) => seen.push(text), 1_000)
  gate.push('第一次')
  gate.push('第二次')
  gate.push('第三次')
  assert.deepEqual(seen, ['第一次'])
  gate.flush()
  assert.deepEqual(seen, ['第一次', '第三次'])
})

test('失败的转换保留已有 package，并在提示词中带上历史摘要', async () => {
  const base = mkdtempSync(join(tmpdir(), 'autoforge-convert-keep-'))
  const repoDir = join(base, 'repo')
  const packageDir = join(base, 'package')
  try {
    mkdirSync(repoDir, { recursive: true })
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'old.txt'), 'keep')
    const seen: string[] = []
    const converter = makeConverter((input) => {
      seen.push(input.lastMessage)
      throw new Error('boom')
    })
    await assert.rejects(() =>
      converter.convert({
        taskId: 't-keep',
        repoDir,
        packageDir,
        repoProfile: REPO_PROFILE,
        allowBuild: false,
        instruction: '改成只导出 CSV',
        history: [
          {
            id: 'a',
            role: 'assistant',
            content: '做成 CLI 包装',
            thinking: '不要出现的推理',
            status: 'complete',
            createdAt: 't'
          }
        ]
      })
    )
    assert.equal(readFileSync(join(packageDir, 'old.txt'), 'utf8'), 'keep')
    assert.equal(existsSync(join(base, 'package-next')), false)
    assert.match(seen[0] ?? '', /做成 CLI 包装/)
    assert.match(seen[0] ?? '', /改成只导出 CSV/)
    assert.doesNotMatch(seen[0] ?? '', /不要出现的推理/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
