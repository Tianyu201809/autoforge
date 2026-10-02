# 仓库转换对话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「从仓库导入」里用多轮对话整份重生成脚本包，思考过程可展开，删除工作区时连同克隆目录一起删掉。

**Architecture:** 思考文本从模型响应里单独拆出。对话记在工作区的 `conversation.json`。每一轮把先前用户原话和助手摘要放进现有两阶段转换，产物先写入 `package-next/`，成功后再替换 `package/`。取消通过已有的 `AbortSignal` 停掉模型请求和构建进程。界面只改导入弹窗。

**Tech Stack:** TypeScript、Vue 3、Electron IPC、Node.js test runner（`node --import tsx --test`）

## Global Constraints

- 对话只在「从仓库导入」弹窗的转换步骤。
- 跟进一轮带上先前对话，整份重新生成脚本包，不在旧文件上打补丁。
- 思考过程可展开；没有思考通道时不显示入口。
- 对话写在该工作区，关掉再打开仍然在。
- 转换进行中可以取消；取消后上一份成功产物保留。
- 删除工作区前确认；确认后删除整个工作区目录，包括克隆的仓库。
- 不做：导入后在脚本详情里继续聊；按文件打补丁；删脚本时连带删克隆。
- 发给模型的历史只有用户原话和助手结果摘要，不含思考原文和文件正文。
- 新一轮写入 `.autoforge/package-next/`，成功后才替换 `.autoforge/package/`。
- 读入仍为 `running` 的助手轮次时改为 `error`，原因是「上次转换未完成」，并删掉残留的 `package-next/`。
- 阶段日志不写入 `conversation.json`。
- 思考字段先读 `reasoning_content`，没有则读 `reasoning`。
- 删除确认写明工作区绝对路径；目录仍在则提示失败并保留列表项。
- 已导入到脚本列表的脚本不会被工作区删除带走。
- 外部 Agent 交接路径保持不变。

---

### Task 1: 拆出模型思考文本

**Files:**
- Modify: `src/main/services/llm-client.ts`
- Modify: `src/main/services/llm-client.test.ts`
- Test: `src/main/services/llm-client.test.ts`

**Interfaces:**
- Produces: `LlmChatResult.reasoning?: string`
- Produces: `LlmStreamInput.onReasoning?: (thinking: string) => void`，参数是截至目前的完整思考文本
- Consumes: 现有 `createLlmClient`、`chatStream`、`sseResponse`

- [ ] **Step 1: Write the failing test**

在 `src/main/services/llm-client.test.ts` 的流式分组末尾追加：

```ts
test('chatStream 把 reasoning_content 与正文分开累计', async () => {
  const client = createLlmClient({
    request: async () =>
      sseResponse([
        `data: ${JSON.stringify({
          choices: [{ delta: { reasoning_content: '先看仓库' }, finish_reason: null }]
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [{ delta: { reasoning: '再定入口' }, finish_reason: null }]
        })}\n\n`,
        sseChunk('{"language":"javascript"}', 'stop'),
        'data: [DONE]\n\n'
      ])
  })
  const snapshots: string[] = []
  const result = await client.chatStream({
    baseUrl: PROFILE.baseUrl,
    model: PROFILE.model,
    apiKey: 'key',
    messages: [{ role: 'user', content: 'hi' }],
    onReasoning: (thinking) => snapshots.push(thinking)
  })
  assert.equal(result.content, '{"language":"javascript"}')
  assert.equal(result.reasoning, '先看仓库再定入口')
  assert.deepEqual(snapshots, ['先看仓库', '先看仓库再定入口'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/llm-client.test.ts`

Expected: FAIL，`result.reasoning` 为 `undefined`。

- [ ] **Step 3: Write minimal implementation**

在 `ChatCompletionResponse` 的 `message` 与 `delta` 上增加可选字段 `reasoning_content?: unknown` 与 `reasoning?: unknown`。

导出并使用：

```ts
export function readReasoningDelta(record: unknown): string {
  if (!record || typeof record !== 'object') return ''
  const source = record as { reasoning_content?: unknown; reasoning?: unknown }
  if (typeof source.reasoning_content === 'string' && source.reasoning_content) return source.reasoning_content
  if (typeof source.reasoning === 'string' && source.reasoning) return source.reasoning
  return ''
}
```

`consumeStreamPayload` 的 state 增加 `reasoning: string`。读到思考增量时追加，并调用 `onReasoning?.(state.reasoning)`。`streamOnce` 的返回值带上 `reasoning: state.reasoning || undefined`。非流式 `send` 对 `message` 做同样的读取，写入 `LlmChatResult.reasoning`。`LlmStreamInput` 增加 `onReasoning`。只有思考、没有正文时，仍按现在的规则视为空流并回退，不要把思考当成正文。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/llm-client.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/llm-client.ts src/main/services/llm-client.test.ts
git commit -m "feat: 单独收集模型思考过程"
```

---

### Task 2: 对话记录的读写与中断恢复

**Files:**
- Create: `src/shared/conversion-conversation.ts`
- Create: `src/shared/conversion-conversation.test.ts`
- Modify: `package.json`（把新测试加入 `test:unit`）
- Modify: `src/shared/repo-types.ts`

**Interfaces:**
- Produces:

```ts
export type ConversionTurnStatus = 'running' | 'complete' | 'cancelled' | 'error'

export interface ConversionTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  status: ConversionTurnStatus
  error?: string
  createdAt: string
}

export interface ConversionConversation {
  turns: ConversionTurn[]
}

export function readConversionConversation(raw: string): ConversionConversation
export function normalizeInterruptedConversation(conversation: ConversionConversation): ConversionConversation
export function summarizeAssistantTurn(input: {
  summary: string
  files: string[]
  warnings?: string[]
  notes?: string
}): string
```

- Produces: `REPO_CONVERSATION_FILENAME = 'conversation.json'`
- Produces: `REPO_PACKAGE_NEXT_DIR_NAME = 'package-next'`
- Consumes: 无

- [ ] **Step 1: Write the failing test**

`src/shared/conversion-conversation.test.ts`：

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/conversion-conversation.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

`readConversionConversation` 解析 JSON。`turns` 不是数组时返回 `{ turns: [] }`。只保留 `role` 为 `user` 或 `assistant`、`content` 为字符串、`status` 为四种状态之一的项。

`normalizeInterruptedConversation` 把 `role === 'assistant' && status === 'running'` 的项改成 `status: 'error'`、`error: '上次转换未完成'`。用户轮次不动。

`summarizeAssistantTurn` 拼成多行文本：摘要、`写入文件：` 加路径列表、有告警时 `告警：`、有备注时原样附上。

在 `repo-types.ts` 增加两个常量，并给 `RepoWorkspaceInfo` 增加 `turns: ConversionTurn[]`。从 `conversion-conversation.ts` 导入该类型。

把 `src/shared/conversion-conversation.test.ts` 加入 `package.json` 的 `test:unit`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/conversion-conversation.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/conversion-conversation.ts src/shared/conversion-conversation.test.ts src/shared/repo-types.ts package.json
git commit -m "feat: 保存仓库转换对话"
```

---

### Task 3: 产物替换与目录删除确认

**Files:**
- Modify: `src/main/services/repo-workspace.ts`
- Create: `src/main/services/repo-package-stage.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export function promoteStagedPackage(stagingDir: string, packageDir: string): void
export function removeDirectoryCommitted(targetPath: string): boolean
```

- Consumes: `REPO_PACKAGE_NEXT_DIR_NAME` 只作为调用方的目录名，本任务的函数接收绝对路径
- `deleteRepoWorkspace` 改为调用 `removeDirectoryCommitted`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promoteStagedPackage, removeDirectoryCommitted } from './repo-workspace'

test('成功时用暂存目录替换旧产物，并留下新内容', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-stage-'))
  const staging = join(root, 'package-next')
  const pkg = join(root, 'package')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'old.txt'), 'old')
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, 'new.txt'), 'new')
  try {
    promoteStagedPackage(staging, pkg)
    assert.equal(readFileSync(join(pkg, 'new.txt'), 'utf8'), 'new')
    assert.equal(existsSync(join(pkg, 'old.txt')), false)
    assert.equal(existsSync(staging), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('目录仍在时删除结果为失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-rm-'))
  try {
    assert.equal(removeDirectoryCommitted(root), true)
    assert.equal(existsSync(root), false)
    assert.equal(removeDirectoryCommitted(root), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/repo-package-stage.test.ts`

Expected: FAIL，函数未导出。

- [ ] **Step 3: Write minimal implementation**

`promoteStagedPackage`：

1. 暂存目录不存在则抛出 `Error('转换暂存目录不存在')`。
2. `package/` 已存在时，先把同级的 `package-prev` 删掉，再把 `package/` 改名为 `package-prev`。
3. 把暂存目录改名为 `package/`。
4. 这一步抛错时，若 `package-prev` 还在且 `package/` 不在，把 `package-prev` 改回 `package/`，然后继续抛出。
5. 成功后删除 `package-prev`。

`removeDirectoryCommitted`：路径不存在返回 `false`。`rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })`，捕获异常后仍检查路径。返回 `!existsSync(path)`。

`deleteRepoWorkspace` 改为 `return removeDirectoryCommitted(paths.workspacePath)`。

把新测试加入 `package.json` 的 `test:unit`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/repo-package-stage.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/repo-workspace.ts src/main/services/repo-package-stage.test.ts package.json
git commit -m "feat: 转换成功后才替换脚本包"
```

---

### Task 4: 把对话历史写进转换提示词

**Files:**
- Modify: `src/shared/conversion-conversation.ts`
- Modify: `src/shared/conversion-conversation.test.ts`
- Modify: `src/main/services/llm-converter.ts`
- Modify: `src/main/services/llm-converter.test.ts`

**Interfaces:**
- Produces: `export function formatConversionHistory(turns: ConversionTurn[]): string`
- Consumes: `ConversionTurn`
- `ConvertWithLlmInput` 增加 `history?: ConversionTurn[]` 与 `signal?: AbortSignal` 与 `onReasoning?: (thinking: string) => void`
- 转换写盘改为写入 `packageDir` 的同级 `package-next`，成功后调用 `promoteStagedPackage`

- [ ] **Step 1: Write the failing test**

在 `conversion-conversation.test.ts`：

```ts
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
```

在 `llm-converter.test.ts` 追加：

```ts
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
```

`makeConverter` 里的 `chatStream` 需要把 `throw` 原样抛出。现有假客户端若把异常吞掉，在该测试的 `run` 中改为直接调用 `reply` 并允许它抛出。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/conversion-conversation.test.ts src/main/services/llm-converter.test.ts`

Expected: FAIL，`formatConversionHistory` 未定义，失败转换仍会清掉 `package/`。

- [ ] **Step 3: Write minimal implementation**

`formatConversionHistory`：没有已完成轮次时返回空字符串。否则以 `先前对话：` 开头，用户行写成 `用户：${content}`，助手行写成 `助手：${content}`。跳过 `thinking`。跳过 `running` 轮次。

`llm-converter.ts` 的两处用户提示（骨架与逐文件）在额外要求之前插入：

```ts
const historyText = formatConversionHistory(input.history ?? [])
```

有历史时把 `historyText` 放进用户消息。最新的 `input.instruction` 仍单独写成 `额外要求`。把 `input.signal` 传给 `chatStream`。`onReasoning` 把每次模型调用的思考按顺序拼接，段首加标签（骨架用 `转换计划`，文件用 `文件 ${spec.path}`），每次变化都调用 `input.onReasoning`。

写盘时：

```ts
const stagingDir = join(dirname(packageDir), 'package-next')
if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true })
mkdirSync(stagingDir, { recursive: true })
```

文件与复制都写入 `stagingDir`。入口校验通过后再 `promoteStagedPackage(stagingDir, packageDir)`。`catch` 中如果还没替换成功，删除 `stagingDir`。取消错误（`LlmClientError` 且 `code === 'cancelled'`）同样删除暂存目录后原样抛出。不要在写盘开始时删除 `packageDir`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/conversion-conversation.test.ts src/main/services/llm-converter.test.ts`

Expected: PASS，原有成功转换用例仍然在 `package/` 找到 `index.mjs` 与 `autoforge.json`。

- [ ] **Step 5: Commit**

```bash
git add src/shared/conversion-conversation.ts src/shared/conversion-conversation.test.ts src/main/services/llm-converter.ts src/main/services/llm-converter.test.ts
git commit -m "feat: 按对话历史重新生成脚本包"
```

---

### Task 5: 构建可以被取消

**Files:**
- Modify: `src/main/services/repo-build-runner.ts`
- Modify: `src/main/services/repo-build-runner.test.ts`

**Interfaces:**
- Produces: `RunBuildCommandsInput.signal?: AbortSignal`
- Consumes: 现有 `killTree`
- 转换器在调用 `runBuildCommands` 时传入同一个 `input.signal`

- [ ] **Step 1: Write the failing test**

在 `repo-build-runner.test.ts` 用一条会停留的命令（`node -e "setInterval(() => {}, 1000)"`）。创建 `AbortController`，调用 `runBuildCommands` 后立刻 `abort()`。断言返回的 `ok === false`，且错误信息包含 `已取消`。用 `process.kill(pid, 0)` 或短等待确认测试没有留下该 node 进程；命令若在取消前已经结束，测试应失败并提示进程没有被取消。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/repo-build-runner.test.ts`

Expected: FAIL，信号被忽略，命令一直跑到测试超时。给该测试设置 `{ timeout: 10_000 }`。

- [ ] **Step 3: Write minimal implementation**

`runSingleCommand` 增加 `signal?: AbortSignal`。若调用时已经 aborted，直接返回 `{ ok: false, error: '已取消' }`。子进程启动后监听 `abort`，调用现有 `killTree`。`close` 时若是取消导致的，`finish(false, '已取消')`。`runBuildCommands` 在每条命令前检查 `signal?.aborted`，是则停止并返回失败。`llm-converter.ts` 把 `input.signal` 传给 `runBuildCommands`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/repo-build-runner.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/repo-build-runner.ts src/main/services/repo-build-runner.test.ts src/main/services/llm-converter.ts
git commit -m "feat: 取消转换时停止构建进程"
```

---

### Task 6: 主进程编排一轮对话

**Files:**
- Modify: `src/main/services/repo-workspace.ts`
- Modify: `src/main/services/repo-conversion-service.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Modify: `src/shared/llm-types.ts`

**Interfaces:**
- Produces:

```ts
export function loadWorkspaceConversation(taskId: string): ConversionConversation
export function saveWorkspaceConversation(taskId: string, conversation: ConversionConversation): void
export function discardStagedPackage(taskId: string): void
export function beginRepoConversion(taskId: string): AbortSignal
export function cancelRepoConversion(taskId: string): void
export function endRepoConversion(taskId: string): void
```

- Produces: `IPC.REPO_CANCEL_LLM = 'repo:cancel-llm'`
- Produces: `IPC.EVENT_REPO_CONVERT_REASONING = 'event:repo-convert-reasoning'`
- 事件载荷：`{ taskId: string; thinking: string }`
- `LlmConvertRequest` 继续使用现有 `instruction`。主进程自己从 `conversation.json` 读取历史，不信任渲染进程传来的历史。
- `RepoWorkspaceInfo.turns` 由 `getWorkspace` 填充。
- Consumes: Task 2 的对话类型、Task 3 的删除与替换、Task 4 的 `history` / `signal` / `onReasoning`

- [ ] **Step 1: Write the failing test**

在 `src/main/services/repo-package-stage.test.ts` 不依赖 Electron 用户目录。把读写对话的纯文件函数做成接收 `metaDir`：

```ts
export function conversationFilePath(metaDir: string): string
export function loadConversationFile(metaDir: string): ConversionConversation
export function saveConversationFile(metaDir: string, conversation: ConversionConversation): void
```

测试：写入一条 `running` 助手轮次后再读出，状态变为 `error`，错误是 `上次转换未完成`。

`beginRepoConversion` / `cancelRepoConversion` 放在 `repo-conversion-service.ts`。测试文件 `src/main/services/repo-conversion-cancel.test.ts`：

```ts
test('取消当前转换会使信号中止', () => {
  const signal = beginRepoConversion('task-a')
  assert.equal(signal.aborted, false)
  cancelRepoConversion('task-a')
  assert.equal(signal.aborted, true)
  endRepoConversion('task-a')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/repo-package-stage.test.ts src/main/services/repo-conversion-cancel.test.ts`

Expected: FAIL，函数不存在。

- [ ] **Step 3: Write minimal implementation**

`loadConversationFile` 读 `conversation.json`，经过 `readConversionConversation` 与 `normalizeInterruptedConversation`。若规范化改动了状态，立刻写回，并 `rmSync` 同级 `package-next`（存在才删）。

`getWorkspace` 返回的 `turns` 使用 `loadWorkspaceConversation(taskId).turns`。`getRepoWorkspacePaths` 增加 `conversationPath` 与 `packageNextDir`。

转换 handler：

1. `beginRepoConversion(taskId)` 得到 `signal`。已有进行中的同一任务则抛出「已有仓库正在转换」。
2. 读对话。把用户的 `instruction`（可为空，但仅当还没有任何用户轮次时允许空）追加为一条完成的用户轮次。已有用户轮次且本次 instruction 为空则抛出「请写下新的要求」。
3. 追加一条 `running` 的助手轮次并保存。
4. 调用 `getLlmConverter().convert`，`history` 为保存前的已完成轮次，`signal` 为控制器信号。`onReasoning` 更新该助手轮次的 `thinking` 并保存，同时 `event.sender.send(IPC.EVENT_REPO_CONVERT_REASONING, { taskId, thinking })`。
5. 成功时用 `summarizeAssistantTurn` 写入助手 `content`，状态 `complete`。
6. `LlmClientError.code === 'cancelled'` 或信号已中止：助手状态 `cancelled`。`discardStagedPackage(taskId)` 在 `package-next` 存在时执行 `rmSync(packageNextDir, { recursive: true, force: true })`。
7. 其他错误：助手状态 `error`，`error` 为错误信息，同样调用 `discardStagedPackage`。
8. `finally` 调用 `endRepoConversion(taskId)`。

`repo:cancel-llm` 调用 `cancelRepoConversion`。预加载增加 `cancelLlm(taskId)` 与 `onReasoning`。`env.d.ts` 的 `repo` 类型同步。

新测试加入 `package.json` 的 `test:unit`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/repo-package-stage.test.ts src/main/services/repo-conversion-cancel.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/repo-workspace.ts src/main/services/repo-conversion-service.ts src/main/services/repo-package-stage.test.ts src/main/services/repo-conversion-cancel.test.ts src/shared/ipc-channels.ts src/shared/llm-types.ts src/main/ipc/handlers.ts src/preload/index.ts src/renderer/src/env.d.ts package.json
git commit -m "feat: 编排一轮仓库转换对话"
```

---

### Task 7: 导入弹窗里的对话、思考过程、取消和删除确认

**Files:**
- Create: `src/renderer/src/lib/repo-conversion-chat.ts`
- Create: `src/renderer/src/lib/repo-conversion-chat.test.ts`
- Modify: `src/renderer/src/composables/useRepoImport.ts`
- Modify: `src/renderer/src/components/RepoImportModal.vue`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export function canSendConversionMessage(turns: ConversionTurn[], draft: string, converting: boolean): boolean
export function workspaceDeleteConfirm(repoLabel: string, workspacePath: string): ConfirmOptions
```

- Consumes: `ConversionTurn`、`askConfirm`、Task 6 的 `cancelLlm` 与 `onReasoning`
- 阶段日志仍只放在内存中的 `conversionLogs`，不写入对话文件

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canSendConversionMessage, workspaceDeleteConfirm } from './repo-conversion-chat'

test('第一轮允许空要求，之后必须填写，转换中不能发送', () => {
  assert.equal(canSendConversionMessage([], '', false), true)
  assert.equal(canSendConversionMessage(
    [{ id: 'u', role: 'user', content: '只要导出', status: 'complete', createdAt: 't' }],
    '  ',
    false
  ), false)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/renderer/src/lib/repo-conversion-chat.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

`canSendConversionMessage`：`converting` 时返回 `false`。没有任何 `role === 'user'` 的轮次时返回 `true`。否则 `draft.trim().length > 0`。

`workspaceDeleteConfirm` 的 `message` 包含仓库名、绝对路径，以及「克隆的仓库和转换产物会一起删除」「脚本列表里已经导入的脚本不会删除」。

`useRepoImport`：

- `turns` 来自 `workspace.turns`。
- `startLlmConversion` 在调用前用 `canSendConversionMessage` 判断。
- 订阅 `onReasoning`，只更新当前 `taskId` 下最后一条助手轮次的 `thinking`。
- 转换结束后 `getWorkspace` 刷新 `turns`。
- 新增 `cancelLlmConversion`，调用 `window.autoforge.repo.cancelLlm`。
- `deleteWorkspace` 先 `askConfirm(workspaceDeleteConfirm(...))`，取消则返回。确认后沿用现有删除；返回 `false` 时提示删除失败，不把该项从列表中当成已删除。

`RepoImportModal.vue` 的 LLM 区域：

- 去掉单独的「补充要求」作为唯一入口，改成对话列表加底部输入框。
- 助手轮次有 `thinking` 时渲染 `<details>`，摘要文字为「思考过程」，正文是 `thinking`。没有 `thinking` 时不渲染该块。
- 进行中显示「取消」，调用 `cancelLlmConversion`。
- 空闲时按钮文案：没有用户轮次为「开始转换」，否则为「发送」。
- 现有转换日志留在当前轮下方。
- Agent 引擎的交接提示词区域不改。

把新测试加入 `package.json` 的 `test:unit`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/renderer/src/lib/repo-conversion-chat.test.ts src/main/services/llm-client.test.ts src/main/services/llm-converter.test.ts src/main/services/repo-build-runner.test.ts src/main/services/repo-package-stage.test.ts src/main/services/repo-conversion-cancel.test.ts src/shared/conversion-conversation.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/repo-conversion-chat.ts src/renderer/src/lib/repo-conversion-chat.test.ts src/renderer/src/composables/useRepoImport.ts src/renderer/src/components/RepoImportModal.vue package.json
git commit -m "feat: 在导入弹窗中对话并确认删除工作区"
```
