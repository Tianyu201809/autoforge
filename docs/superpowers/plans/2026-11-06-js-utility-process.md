# JS utilityProcess Implementation Plan

> **状态：已完成**（实现已合入 `feature/v1.42.0`，桌面端单测通过）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 用户 JS 在独立的 utilityProcess 中运行，主进程的超时和停止能够结束卡死的脚本。

**Architecture:** 主进程与宿主之间用结构化消息通信。停止先发 `abort`，1000ms 后若进程还在就杀掉 utilityProcess 和已上报的浏览器 PID。Playwright 留在子进程，因为脚本拿着 `Browser` 对象。

**Tech Stack:** Electron `utilityProcess`、现有 `script-runner`、`node:test`。

## Global Constraints

- 一个 JS 会话对应一个子进程。Python 和可执行脚本不改。
- 主进程不再 `import()` 用户代码。
- 启动消息携带 `env`、`params`、`sessionId`、`scriptId`、`paths.userData`、`paths.scriptDir`。
- 子进程消息类型只有 `log`、`stage`、`progress`、`browser`、`result`、`error`。
- 停止或超时先发 `abort`，等待 1000ms；到时未退出则杀掉子进程和已上报的浏览器 PID。
- 用户停止记 `stopped`。超时记 `error`，信息包含超时秒数。
- 子进程崩溃、宿主缺失、入口函数不存在只失败这一次会话。
- 不增加文件或网络沙箱。

---

### Task 1: 宿主消息协议

**Files:**
- Create: `src/shared/script-host-protocol.ts`
- Test: `src/shared/script-host-protocol.test.ts`
- Modify: `package.json` 的 `test:unit`

**Interfaces:**
- Consumes: `ScriptStageInput`、`ScriptProgressInput`（`src/shared/script-progress.ts`）
- Produces:
  - `HostStartMessage = { type: 'start'; entryPath: string; sessionId: string; scriptId: string; env: Record<string, string>; params: Record<string, string>; paths: { userData: string; scriptDir: string } }`
  - `HostInbound = HostStartMessage | { type: 'abort' }`
  - `HostOutbound = { type: 'log'; level: 'INFO' | 'WARN' | 'ERROR'; message: string } | { type: 'stage'; stage: ScriptStageInput } | { type: 'progress'; progress: ScriptProgressInput } | { type: 'browser'; pid: number } | { type: 'result'; value: unknown } | { type: 'error'; message: string }`
  - `parseHostOutbound(value: unknown): HostOutbound | null`

- [x] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseHostOutbound } from './script-host-protocol'

test('accepts host messages and rejects unknown ones', () => {
  assert.deepEqual(parseHostOutbound({ type: 'log', level: 'INFO', message: 'hi' }), {
    type: 'log',
    level: 'INFO',
    message: 'hi'
  })
  assert.deepEqual(parseHostOutbound({ type: 'browser', pid: 12 }), { type: 'browser', pid: 12 })
  assert.equal(parseHostOutbound({ type: 'browser', pid: -1 }), null)
  assert.equal(parseHostOutbound({ type: 'nope' }), null)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/script-host-protocol.test.ts`

Expected: FAIL，模块不存在。

- [x] **Step 3: Write minimal implementation**

写出上面的类型，以及 `parseHostOutbound`：只接受列出的 `type`。`log.level` 只能是 `INFO`、`WARN`、`ERROR`。`browser.pid` 必须是正整数。`error.message` 和 `log.message` 必须是字符串。其他字段原样保留。无法识别时返回 `null`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/script-host-protocol.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/shared/script-host-protocol.ts src/shared/script-host-protocol.test.ts package.json
git commit -m "feat: 定义 JS 宿主进程消息"
```

### Task 2: 1000ms 宽限后杀进程

**Files:**
- Create: `src/main/services/script-host-stop.ts`
- Test: `src/main/services/script-host-stop.test.ts`
- Modify: `package.json` 的 `test:unit`

**Interfaces:**
- Consumes: 无
- Produces: `armHostStop(input: { postAbort: () => void; kill: () => void; hasExited: () => boolean; schedule: (fn: () => void, ms: number) => { cancel: () => void }; graceMs?: number }): { cancel: () => void }`

- [x] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { armHostStop } from './script-host-stop'

test('kills the host after 1000ms when it is still alive', () => {
  let scheduledMs = 0
  let fire = () => undefined
  let aborted = false
  let killed = false
  let alive = true
  armHostStop({
    postAbort: () => { aborted = true },
    kill: () => { killed = true },
    hasExited: () => !alive,
    schedule: (fn, ms) => {
      scheduledMs = ms
      fire = fn
      return { cancel() { fire = () => undefined } }
    }
  })
  assert.equal(aborted, true)
  assert.equal(scheduledMs, 1000)
  assert.equal(killed, false)
  fire()
  assert.equal(killed, true)
})

test('does not kill a host that exits within the grace period', () => {
  let fire = () => undefined
  let killed = false
  armHostStop({
    postAbort: () => undefined,
    kill: () => { killed = true },
    hasExited: () => true,
    schedule: (fn) => {
      fire = fn
      return { cancel() {} }
    }
  })
  fire()
  assert.equal(killed, false)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/script-host-stop.test.ts`

Expected: FAIL。

- [x] **Step 3: Write minimal implementation**

```ts
export function armHostStop(input: {
  postAbort: () => void
  kill: () => void
  hasExited: () => boolean
  schedule: (fn: () => void, ms: number) => { cancel: () => void }
  graceMs?: number
}): { cancel: () => void } {
  input.postAbort()
  return input.schedule(() => {
    if (!input.hasExited()) input.kill()
  }, input.graceMs ?? 1000)
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/script-host-stop.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/services/script-host-stop.ts src/main/services/script-host-stop.test.ts package.json
git commit -m "fix: JS 停止在宽限后杀掉宿主进程"
```

### Task 3: 宿主入口执行用户脚本

**Files:**
- Create: `src/main/services/script-host.ts`
- Modify: `electron.vite.config.ts` 的 `main.build.rollupOptions.input`，同时包含 `src/main/index.ts` 和 `src/main/services/script-host.ts`
- Test: `src/main/services/script-host.test.ts`
- Modify: `package.json` 的 `test:unit`

**Interfaces:**
- Consumes: `HostInbound`、`resolveScriptEntryFn`、`createScriptSdk`
- Produces: `runHostMessage(message: HostInbound, deps: { importModule: (entryPath: string) => Promise<Record<string, unknown>>; post: (message: unknown) => void; signal: AbortSignal; createSdk: (paths: { userData: string; scriptDir: string }, signal: AbortSignal, post: (message: unknown) => void) => { browser: { launch: () => Promise<{ process: () => { pid: number } }> }; paths: { userData: string; scriptDir: string } } }): Promise<void>`

- [x] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runHostMessage } from './script-host'

test('posts the script result and log lines', async () => {
  const posted: unknown[] = []
  const controller = new AbortController()
  await runHostMessage(
    {
      type: 'start',
      entryPath: 'entry.js',
      sessionId: 's',
      scriptId: 'script',
      env: { A: '1' },
      params: {},
      paths: { userData: 'user', scriptDir: 'dir' }
    },
    {
      importModule: async () => ({
        run: async (ctx: { log: (level: string, message: string) => void }) => {
          ctx.log('INFO', 'hello')
          return { ok: true }
        }
      }),
      post: (message) => posted.push(message),
      signal: controller.signal,
      createSdk: () => ({ browser: { launch: async () => ({ process: () => ({ pid: 1 }) }) }, paths: { userData: 'user', scriptDir: 'dir' } })
    }
  )
  assert.deepEqual(posted[0], { type: 'log', level: 'INFO', message: 'hello' })
  assert.deepEqual(posted[1], { type: 'result', value: { ok: true } })
})

test('posts an error when the entry function is missing', async () => {
  const posted: unknown[] = []
  await runHostMessage(
    {
      type: 'start',
      entryPath: 'entry.js',
      sessionId: 's',
      scriptId: 'script',
      env: {},
      params: {},
      paths: { userData: 'user', scriptDir: 'dir' }
    },
    {
      importModule: async () => ({}),
      post: (message) => posted.push(message),
      signal: new AbortController().signal,
      createSdk: () => ({ browser: { launch: async () => ({ process: () => ({ pid: 1 }) }) }, paths: { userData: 'user', scriptDir: 'dir' } })
    }
  )
  assert.equal((posted[0] as { type: string }).type, 'error')
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/script-host.test.ts`

Expected: FAIL。

- [x] **Step 3: Write minimal implementation**

`runHostMessage` 在 `type === 'start'` 时 `importModule(entryPath)`，用 `resolveScriptEntryFn` 找入口。没有入口就 `post({ type: 'error', message: SCRIPT_ENTRY_FN_ERROR })`。找到后构造与现在 `executeJavaScriptPackage` 相同的 `ctx`：`log` / `stage` / `progress` 改成 `post` 对应消息。`sdk` 使用传入的 `createSdk`。`run` 的返回值 `post({ type: 'result', value })`。抛错则 `post({ type: 'error', message })`。

文件底部只在 `process.parentPort` 存在时注册监听，把 `process.parentPort.postMessage` 传给 `runHostMessage`。`importModule` 使用 `import(pathToFileURL(entryPath).href)`。浏览器 `launch` 成功后，从 Playwright browser 进程取 PID 并 `post({ type: 'browser', pid })`。`electron.vite.config.ts` 的 main 输入：

```ts
build: {
  rollupOptions: {
    input: {
      index: resolve('src/main/index.ts'),
      'script-host': resolve('src/main/services/script-host.ts')
    }
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/script-host.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/services/script-host.ts src/main/services/script-host.test.ts electron.vite.config.ts package.json
git commit -m "feat: 在宿主进程里执行 JS 脚本入口"
```

### Task 4: script-runner 改用宿主进程

**Files:**
- Modify: `src/main/services/script-runner.ts` 的 `ActiveSession`、`executeJavaScriptPackage`、`stop`、`armRunTimeout`

**Interfaces:**
- Consumes: `armHostStop`、`parseHostOutbound`、`utilityProcess.fork`
- Produces: JS 会话的 `scriptHost` 字段。`stop` 对 JS 会话调用 `armHostStop`，不再只 `abortController.abort()`。

- [x] **Step 1: Write the failing test**

把启动器抽成可注入接口，避免单测拉起 Electron：

```ts
export interface ScriptHostHandle {
  postMessage: (message: unknown) => void
  kill: () => void
  onMessage: (handler: (message: unknown) => void) => void
  onExit: (handler: () => void) => void
}
```

在 `script-host-stop.test.ts` 已覆盖宽限。本任务给 `script-runner` 增加可选构造参数 `launchHost?: (hostFile: string) => ScriptHostHandle`。新增 `src/main/services/script-runner-host.test.ts`，用假的 `launchHost` 断言：

- 启动后发出的第一条消息是 `type: 'start'`，且 `entryPath` 是脚本入口。
- 假宿主发出 `{ type: 'result', value: 1 }` 后会话变为 `success`。
- 调用 `stop` 时先 `postMessage({ type: 'abort' })`，计时器触发后调用 `kill`。

`ScriptRunnerService` 今天的构造函数是 `(getWindow, executable?)`。增加第三个可选参数，不改变前两个参数的含义：

```ts
constructor(
  getWindow: () => BrowserWindow | null,
  executable?: ExecutableRunnerDependencies,
  launchHost?: (hostFile: string) => ScriptHostHandle
)
```

默认 `launchHost` 调用 `utilityProcess.fork(hostFile)`，并把 `child.postMessage`、`child.kill`、`child.on('message')`、`child.on('exit')` 适配成 `ScriptHostHandle`。测试传入假的 `launchHost`，`getWindow` 返回 `null`。

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/script-runner-host.test.ts`

Expected: FAIL，JS 路径仍直接 `import()`，假宿主收不到 `start`。

- [x] **Step 3: Write minimal implementation**

删除 `executeJavaScriptPackage` 中的 `import(pathToFileURL(entryPath).href)`。改为 `launchHost(hostFile)`，保存到 `active.scriptHost`。`hostFile` 在开发时是 `out/main/script-host.js`，用 `fileURLToPath(new URL('./script-host.js', import.meta.url))`。收到消息时 `parseHostOutbound`，分别调用现有的 `pushLog`、`handleScriptControl`、记录 `browserPids`、`completeSession`、`failSession`。`onExit` 且会话仍是 `running` 时 `failSession`。

`stop` 在 JS 会话上调用 `armHostStop`：`postAbort` 发送 `{ type: 'abort' }` 并 `abortController.abort()`；`kill` 调用 `scriptHost.kill()`，再对 `browserPids` 执行 `process.kill(pid)`。`armRunTimeout` 的回调仍调用 `this.stop(sessionId)`，并在杀进程前把日志写成 `运行超时（${seconds} 秒），已自动停止`。超时路径把状态写成 `error` 而不是 `stopped`：给 `stop` 增加参数 `reason: 'user' | 'timeout' = 'user'`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/script-runner-host.test.ts src/main/services/script-host.test.ts src/main/services/script-host-stop.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/services/script-runner.ts src/main/services/script-runner-host.test.ts
git commit -m "fix: JS 脚本改到可杀死的宿主进程"
```
