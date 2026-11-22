# Hub 安装桥 Implementation Plan

> **状态：已完成**（桌面端实现与 Hub 联动均已提交，相关测试通过）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 网页和应用内安装都只从已配置的 Hub 下载脚本包，并在导入前核对 SHA-256。

**Architecture:** 桌面端把请求体解析、下载 URL 和哈希比对抽成纯函数。本机桥只收 `hubScriptId` 与 `installToken`，自己拼下载地址。Hub 在保存包时写入 `file_sha256`，下载响应带 `X-Autoforge-Sha256`。

**Tech Stack:** Electron 主进程、Node `node:test`、Nuxt server utils、sql.js。

## Global Constraints

- `POST /install` 只接受 `hubScriptId` 和 `installToken`；出现 `zipUrl` 或 `sha256` 时返回 400 `invalid_request`，消息「安装请求无效」。
- 下载 URL 为 `{Hub 源}/api/scripts/{hubScriptId}/download?installToken={installToken}`，源必须等于当前配置的 Hub 源。
- `Origin` 必须等于该源；缺失或 `null` 都拒绝。CORS 只在匹配时回显该源，不再发送 `*`。
- `GET /health` 不要求 `Origin`。`/auth/callback` 不改。
- 哈希是十六进制小写 SHA-256，字段名 `file_sha256`，响应头 `X-Autoforge-Sha256`。
- 旧包第一次下载时补算并写回。哈希缺失或不一致时删除临时下载，不导入。
- 安装令牌 TTL 仍为 120 秒。失败互不影响另外三个 P0。

---

### Task 1: 安装请求与下载 URL

**Files:**
- Create: `src/main/services/hub-install-contract.ts`
- Test: `src/main/services/hub-install-contract.test.ts`
- Modify: `package.json` 的 `test:unit` 脚本，在现有列表末尾加入这个测试文件

**Interfaces:**
- Consumes: 无
- Produces: `hubOrigin(hubUrl: string): string`、`buildHubDownloadUrl(hubUrl: string, hubScriptId: string, installToken: string): string`、`parseBridgeInstallBody(body: unknown): { hubScriptId: string; installToken: string }`、`originAllowed(originHeader: string | undefined, hubUrl: string): boolean`。解析失败抛 `HubInstallError('invalid_request', '安装请求无效')`。

- [x] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildHubDownloadUrl,
  originAllowed,
  parseBridgeInstallBody
} from './hub-install-contract'

test('builds a download URL on the configured Hub origin', () => {
  assert.equal(
    buildHubDownloadUrl('https://hub.example.test/app/', 'script 1', 'tok'),
    'https://hub.example.test/api/scripts/script%201/download?installToken=tok'
  )
})

test('rejects bodies that carry a zip URL or checksum', () => {
  assert.throws(() => parseBridgeInstallBody({ hubScriptId: 'a', installToken: 't', zipUrl: 'https://evil.test/a.zip' }))
  assert.throws(() => parseBridgeInstallBody({ hubScriptId: 'a', installToken: 't', sha256: 'abc' }))
  assert.deepEqual(parseBridgeInstallBody({ hubScriptId: ' a ', installToken: ' t ' }), {
    hubScriptId: 'a',
    installToken: 't'
  })
})

test('allows only the configured Hub origin', () => {
  assert.equal(originAllowed('https://hub.example.test', 'https://hub.example.test/path'), true)
  assert.equal(originAllowed(undefined, 'https://hub.example.test'), false)
  assert.equal(originAllowed('null', 'https://hub.example.test'), false)
  assert.equal(originAllowed('https://evil.test', 'https://hub.example.test'), false)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/hub-install-contract.test.ts`

Expected: FAIL，找不到 `./hub-install-contract`。

- [x] **Step 3: Write minimal implementation**

```ts
import { HubInstallError } from './hub-script-installer'

export function hubOrigin(hubUrl: string): string {
  const url = new URL(hubUrl.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  return url.origin
}

export function buildHubDownloadUrl(hubUrl: string, hubScriptId: string, installToken: string): string {
  const url = new URL(`/api/scripts/${encodeURIComponent(hubScriptId)}/download`, hubOrigin(hubUrl))
  url.searchParams.set('installToken', installToken)
  return url.toString()
}

export function parseBridgeInstallBody(body: unknown): { hubScriptId: string; installToken: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  const record = body as Record<string, unknown>
  if ('zipUrl' in record || 'sha256' in record) {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  if (typeof record.hubScriptId !== 'string' || !record.hubScriptId.trim()) {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  if (typeof record.installToken !== 'string' || !record.installToken.trim()) {
    throw new HubInstallError('invalid_request', '安装请求无效')
  }
  return { hubScriptId: record.hubScriptId.trim(), installToken: record.installToken.trim() }
}

export function originAllowed(originHeader: string | undefined, hubUrl: string): boolean {
  if (!originHeader || originHeader === 'null') return false
  try {
    return originHeader === hubOrigin(hubUrl)
  } catch {
    return false
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/hub-install-contract.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/services/hub-install-contract.ts src/main/services/hub-install-contract.test.ts package.json
git commit -m "fix: 校验 Hub 安装请求和下载源"
```

### Task 2: 下载内容的 SHA-256

**Files:**
- Create: `src/main/services/hub-package-hash.ts`
- Test: `src/main/services/hub-package-hash.test.ts`
- Modify: `package.json` 的 `test:unit`

**Interfaces:**
- Consumes: 无
- Produces: `sha256FileHex(filePath: string): string`、`assertPackageHash(actualHex: string, headerHex: string | null, tokenHex?: string): void`。失败抛 `HubInstallError('invalid_package', '脚本包校验失败')`。

- [x] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { createHash } from 'crypto'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test } from 'node:test'
import { assertPackageHash, sha256FileHex } from './hub-package-hash'

test('hashes file bytes and rejects a mismatched header', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-hash-'))
  const file = join(dir, 'package.zip')
  writeFileSync(file, 'zip-bytes')
  const expected = createHash('sha256').update('zip-bytes').digest('hex')
  assert.equal(sha256FileHex(file), expected)
  assert.doesNotThrow(() => assertPackageHash(expected, expected.toUpperCase(), expected))
  assert.throws(() => assertPackageHash(expected, null))
  assert.throws(() => assertPackageHash(expected, 'ab', expected))
  assert.throws(() => assertPackageHash(expected, expected, 'cd'))
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/hub-package-hash.test.ts`

Expected: FAIL，模块不存在。

- [x] **Step 3: Write minimal implementation**

```ts
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { HubInstallError } from './hub-script-installer'

export function sha256FileHex(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function assertPackageHash(actualHex: string, headerHex: string | null, tokenHex?: string): void {
  const header = headerHex?.trim().toLowerCase() ?? ''
  if (!/^[0-9a-f]{64}$/.test(header) || header !== actualHex.toLowerCase()) {
    throw new HubInstallError('invalid_package', '脚本包校验失败')
  }
  if (tokenHex !== undefined && tokenHex.trim().toLowerCase() !== header) {
    throw new HubInstallError('invalid_package', '脚本包校验失败')
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/hub-package-hash.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/services/hub-package-hash.ts src/main/services/hub-package-hash.test.ts package.json
git commit -m "fix: 核对 Hub 脚本包的 SHA-256"
```

### Task 3: 安装器只在哈希通过后导入

**Files:**
- Modify: `src/main/services/hub-script-installer.ts` 的 `downloadZip` 与 `installScriptFromHubZip`
- Modify: `src/main/services/hub-client.ts` 的 `install` 入参和 `installPlugin`
- Modify: `src/main/services/hub-client.test.ts`

**Interfaces:**
- Consumes: `assertPackageHash`、`sha256FileHex`
- Produces: `installScriptFromHubZip` 增加可选 `expectedSha256?: string`。应用内安装始终传入。桥只比对响应头，不传它。`downloadZip` 返回响应头里的 `x-autoforge-sha256`。`createHubClient(...).installPlugin` 把 `install-token` 响应的 `sha256` 传给 `options.install`。

- [x] **Step 1: Write the failing test**

把 `hub-client.test.ts` 里的 JSON 改成必须含 `sha256`，并断言安装器收到它：

```ts
json: async () => ({
  zipUrl: 'https://hub.example.test/api/scripts/hub-1/download?installToken=tok',
  scriptName: 'A',
  hubScriptId: 'hub-1',
  sha256: 'abc'
})
```

在 `install` 回调里增加 `assert.equal(input.expectedSha256, 'abc')`。再加一个测试：响应没有 64 位十六进制 `sha256` 时抛 `HubClientError`，且不调用 `install`。

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/hub-client.test.ts`

Expected: FAIL，`expectedSha256` 为 `undefined`，或缺少字段时没有抛错。

- [x] **Step 3: Write minimal implementation**

`hub-client.ts` 的安装入参改为：

```ts
install(input: {
  zipUrl: string
  scriptName: string
  hubScriptId: string
  expectedSha256: string
  onProgress?: (progress: HubInstallProgress) => void
}): Promise<InstallResult>
```

`installPlugin` 在调用 `options.install` 前：

```ts
const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : ''
if (!/^[0-9a-f]{64}$/.test(sha256)) {
  throw new HubClientError('invalid_response', 'AutoforgeHub 安装响应无效')
}
return await options.install({
  zipUrl: body.zipUrl,
  scriptName: body.scriptName,
  hubScriptId: body.hubScriptId,
  expectedSha256: sha256,
  onProgress
})
```

`installScriptFromHubZip` 增加可选 `expectedSha256?: string`。`downloadZip` 在写完文件后返回 `response.headers.get('x-autoforge-sha256')`。调用处：

```ts
const headerSha = await downloadZip(url, zipPath, reportProgress)
assertPackageHash(sha256FileHex(zipPath), headerSha, input.expectedSha256)
```

哈希失败时现有的 `finally` 必须删除 `tempDir`。不要进入 `extractZip`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/hub-client.test.ts src/main/services/hub-package-hash.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/services/hub-script-installer.ts src/main/services/hub-client.ts src/main/services/hub-client.test.ts
git commit -m "fix: 导入前核对 Hub 返回的脚本包哈希"
```

### Task 4: 本机桥使用 Origin 和安装令牌

**Files:**
- Modify: `src/main/services/hub-bridge-server.ts`
- Modify: `src/main/index.ts` 里 `startHubBridgeServer` 的调用
- Test: `src/main/services/hub-bridge-server.test.ts`
- Modify: `package.json` 的 `test:unit`

**Interfaces:**
- Consumes: `parseBridgeInstallBody`、`originAllowed`、`buildHubDownloadUrl`、`installScriptFromHubZip`
- Produces: `startHubBridgeServer({ onInstalled, getHubUrl })`。`handleInstall` 不再读取 `zipUrl`。

- [x] **Step 1: Write the failing test**

导出一个不监听端口的 `handleHubBridgeRequest(req, res, deps)`，或把现有 `handleRequest` 导出供测试调用。用 `node:http` 的 `IncomingMessage` 模拟成本高。改为导出纯决策函数已在 Task 1 覆盖。本任务测试 CORS 与错误响应：把 `setCors` 抽成

```ts
export function bridgeCorsHeaders(origin: string | undefined, hubUrl: string): Record<string, string>
```

测试：

```ts
test('reflects only the configured origin', () => {
  assert.deepEqual(bridgeCorsHeaders('https://hub.example.test', 'https://hub.example.test'), {
    'Access-Control-Allow-Origin': 'https://hub.example.test',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  assert.deepEqual(bridgeCorsHeaders('https://evil.test', 'https://hub.example.test'), {})
})
```

再导出 `installRejection(origin, hubUrl, body)`，返回 `null` 或 `{ status, error, message }`：

```ts
assert.deepEqual(
  installRejection('https://evil.test', 'https://hub.example.test', { hubScriptId: 'a', installToken: 't' }),
  { status: 400, error: 'invalid_request', message: '安装请求无效' }
)
assert.equal(
  installRejection('https://hub.example.test', 'https://hub.example.test', { hubScriptId: 'a', installToken: 't' }),
  null
)
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/hub-bridge-server.test.ts`

Expected: FAIL，函数不存在。

- [x] **Step 3: Write minimal implementation**

`setCors` 改为只设置 `bridgeCorsHeaders` 返回的头。`handleInstall`：

```ts
const hubUrl = getHubUrl()
const rejection = installRejection(req.headers.origin, hubUrl, body)
if (rejection) {
  sendJson(res, rejection.status, { ok: false, error: rejection.error, message: rejection.message })
  return
}
const parsed = parseBridgeInstallBody(body)
const zipUrl = buildHubDownloadUrl(hubUrl, parsed.hubScriptId, parsed.installToken)
const result = await installScriptFromHubZip({
  zipUrl,
  hubScriptId: parsed.hubScriptId
})
```

桥不传 `expectedSha256`，只比对响应头。`installRejection` 在 Origin 不匹配或 `parseBridgeInstallBody` 抛错时返回 400。

`src/main/index.ts`：

```ts
startHubBridgeServer({
  getHubUrl: () => scriptStore.getConfig().hub?.url ?? '',
  onInstalled: (payload) => { /* 保持现有广播 */ }
})
```

错误映射保持规格表：令牌失效如果来自下载 HTTP 401，转成 400 `invalid_request`、消息「安装链接无效或已过期」。在 `downloadZip` 里 `response.status === 401` 时抛这个 `HubInstallError`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/hub-bridge-server.test.ts src/main/services/hub-install-contract.test.ts src/main/services/hub-client.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/services/hub-bridge-server.ts src/main/services/hub-bridge-server.test.ts src/main/services/hub-script-installer.ts src/main/index.ts package.json
git commit -m "fix: 本机安装桥只接受已配置 Hub 的安装令牌"
```

### Task 5: Hub 保存并下发 file_sha256

**Files:**
- Create: `C:/personal/autoforge-hub/server/utils/package-sha256.mjs`
- Create: `C:/personal/autoforge-hub/server/utils/package-sha256.test.mjs`
- Modify: `C:/personal/autoforge-hub/package.json` 的 `test:marketplace-mine`，把新测试文件加进 `node --test`
- Modify: `C:/personal/autoforge-hub/server/db/index.ts`，增加 `ALTER TABLE scripts ADD COLUMN file_sha256 TEXT NOT NULL DEFAULT ''` 的 try/catch 迁移
- Modify: `C:/personal/autoforge-hub/server/api/scripts/uploads/[uploadId]/complete.post.ts`，`saveFileFromPath` 之后用 `sha256File` 计算哈希并写入 INSERT
- Modify: `C:/personal/autoforge-hub/server/api/scripts/[id]/install-token.post.ts`，响应增加 `sha256: row.file_sha256`
- Modify: `C:/personal/autoforge-hub/server/api/scripts/[id]/download.get.ts`，`serveScriptFile` 前补齐空哈希并 `setHeader(event, 'X-Autoforge-Sha256', hash)`

**Interfaces:**
- Consumes: `readFile` from `server/utils/storage.ts`
- Produces: `sha256Buffer(bytes: Buffer): string`、`sha256File(filePath: string): string`

- [x] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256Buffer, sha256File } from './package-sha256.mjs'

test('hashes a buffer and a file as lowercase hex', () => {
  const bytes = Buffer.from('zip-bytes')
  const expected = createHash('sha256').update(bytes).digest('hex')
  assert.equal(sha256Buffer(bytes), expected)
  const file = join(mkdtempSync(join(tmpdir(), 'pkg-sha-')), 'a.zip')
  writeFileSync(file, bytes)
  assert.equal(sha256File(file), expected)
})
```

- [x] **Step 2: Run test to verify it fails**

Run from `C:/personal/autoforge-hub`: `node --test server/utils/package-sha256.test.mjs`

Expected: FAIL，模块不存在。

- [x] **Step 3: Write minimal implementation**

`package-sha256.mjs` 用 `createHash('sha256')` 返回 hex。`download.get.ts` 在 `serveScriptFile` 开头：

```ts
let hash = String(row.file_sha256 || '')
if (!/^[0-9a-f]{64}$/.test(hash)) {
  const bytes = await readFile(row.file_path)
  if (!bytes) throw createError({ statusCode: 404, message: '文件不存在' })
  hash = sha256Buffer(bytes)
  db.run('UPDATE scripts SET file_sha256 = ? WHERE id = ?', [hash, row.id])
  saveDb()
  row.file_sha256 = hash
}
setHeader(event, 'X-Autoforge-Sha256', hash)
```

`complete.post.ts` 的 INSERT 列增加 `file_sha256`，值为 `sha256File(merged.archivePath)`。`install-token.post.ts` 的返回对象增加 `sha256: String(row.file_sha256 || '')`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test server/utils/package-sha256.test.mjs`

Expected: PASS。

- [x] **Step 5: Commit**

在 `autoforge-hub` 仓库：

```bash
git add server/utils/package-sha256.mjs server/utils/package-sha256.test.mjs server/db/index.ts server/api/scripts package.json
git commit -m "fix: 安装包保存 SHA-256 并在下载时下发"
```

### Task 6: Hub 网页不再提交 zipUrl

**Files:**
- Modify: `C:/personal/autoforge-hub/app/composables/useAutoforgeBridge.ts`
- Modify: `C:/personal/autoforge-hub/app/components/workspace/WsScriptCard.vue`
- Modify: `C:/personal/autoforge-hub/app/pages/workspace/marketplace/[id].vue`

**Interfaces:**
- Consumes: `install-token` 响应里的 `hubScriptId`；从 `zipUrl` 查询串读取 `installToken`
- Produces: `installScript({ hubScriptId, installToken })`

- [x] **Step 1: Write the failing test**

在 `useAutoforgeBridge.ts` 旁新增纯函数文件 `app/composables/bridge-install-body.mjs` 不适合被 Vue 测。把解析放进 `server/utils/bridge-install-body.mjs` 不合理。放在 `shared/utils/bridge-install-body.mjs`：

```js
export function bridgeInstallBody(mint) {
  const zipUrl = new URL(mint.zipUrl)
  const installToken = zipUrl.searchParams.get('installToken')
  if (!mint.hubScriptId || !installToken) throw new Error('安装响应无效')
  return { hubScriptId: mint.hubScriptId, installToken }
}
```

测试 `shared/utils/bridge-install-body.test.mjs`：

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { bridgeInstallBody } from './bridge-install-body.mjs'

test('keeps the script id and install token, and drops the zip URL', () => {
  assert.deepEqual(
    bridgeInstallBody({
      hubScriptId: 's1',
      zipUrl: 'https://hub.example.test/api/scripts/s1/download?installToken=tok'
    }),
    { hubScriptId: 's1', installToken: 'tok' }
  )
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test shared/utils/bridge-install-body.test.mjs`

Expected: FAIL。

- [x] **Step 3: Write minimal implementation**

实现上面的函数。`useAutoforgeBridge.ts` 的 `installScript` 参数改为 `{ hubScriptId: string; installToken: string }`。两个调用点把 `installScript({ zipUrl, scriptName, hubScriptId })` 换成 `installScript(bridgeInstallBody(mintData))`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test shared/utils/bridge-install-body.test.mjs server/utils/package-sha256.test.mjs`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add shared/utils/bridge-install-body.mjs shared/utils/bridge-install-body.test.mjs app/composables/useAutoforgeBridge.ts app/components/workspace/WsScriptCard.vue app/pages/workspace/marketplace/[id].vue package.json
git commit -m "fix: 网页安装只向本机桥提交脚本 ID 和令牌"
```
