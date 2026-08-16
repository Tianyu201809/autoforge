# AutoforgeHub 原生插件中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Autoforge 内登录 AutoforgeHub，浏览市场、个人和团队插件，并安全地一键安装或更新本地脚本。

**Architecture:** Autoforge 主进程加密持有 Hub JWT，经受限 IPC 返回脱敏会话、查询和安装结果。安装复用现有 ZIP 安装器；Hub 服务端仅补齐团队列表成员资格校验。

**Tech Stack:** Electron 34、Vue 3、TypeScript、Electron `safeStorage`、Node `fetch`、Nuxt/H3、sql.js、Node test runner。

## Global Constraints

- Hub URL 仅允许 `http:` 或 `https:`，读取现有 `AppConfig.hub.url`。
- JWT、密码、Authorization header、安装令牌和 `zipUrl` 不能经过 preload、配置导出或日志。
- 团队列表、详情、下载和安装令牌必须都由 Hub 服务端校验成员资格。
- 每次只允许一个 Hub 安装任务；重复安装复用现有更新确认。
- 无安全存储时，JWT 只在当前进程内存保留。
- 不改变网页通过 `127.0.0.1:19276` 调用桌面端的既有协议。

---

### Task 1: 修复 Hub 团队列表越权

**Files:**
- Create: `D:/myProject/AutoforgeHub/server/utils/team-membership.mjs`
- Create: `D:/myProject/AutoforgeHub/server/utils/team-membership.test.mjs`
- Modify: `D:/myProject/AutoforgeHub/server/api/scripts/index.get.ts`
- Create: `D:/myProject/AutoforgeHub/docs/api/scripts.md`
- Modify: `D:/myProject/AutoforgeHub/package.json`

**Interfaces:** `isTeamMember(team, userId): boolean`. `GET /api/scripts?teamId=<id>` 在查询脚本前对不存在团队返回 `404`，对非成员返回 `403`。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { isTeamMember } from './team-membership.mjs'

const team = { owner_id: 'owner', member_ids: '["member"]' }

test('allows owner and member', () => {
  assert.equal(isTeamMember(team, 'owner'), true)
  assert.equal(isTeamMember(team, 'member'), true)
})

test('rejects outsider and malformed members', () => {
  assert.equal(isTeamMember(team, 'outsider'), false)
  assert.equal(isTeamMember({ owner_id: 'owner', member_ids: 'bad-json' }, 'member'), false)
})
```

- [ ] **Step 2: 验证其失败**

Run: `node --test server/utils/team-membership.test.mjs` in `D:/myProject/AutoforgeHub`.  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: 实现和接入**

```js
export function isTeamMember(team, userId) {
  if (!team || typeof userId !== 'string' || !userId) return false
  if (team.owner_id === userId) return true
  try {
    const members = JSON.parse(team.member_ids || '[]')
    return Array.isArray(members) && members.includes(userId)
  } catch {
    return false
  }
}
```

在 `index.get.ts` 的 `const db = await getDb()` 之后，查询 `teams` 的 `owner_id/member_ids`。若不存在，抛出 `createError({ statusCode: 404, message: '团队不存在' })`；若 `!isTeamMember(team, userId)`，抛出 `createError({ statusCode: 403, message: '你不是该团队成员' })`。新增 API 文档行，并把新测试追加至 `test:marketplace-mine`。

- [ ] **Step 4: 验证并提交**

```bash
npm run test:marketplace-mine
npm run lint
git add server/utils/team-membership.mjs server/utils/team-membership.test.mjs server/api/scripts/index.get.ts docs/api/scripts.md package.json
git commit -m "fix: restrict team script list access"
```

### Task 2: 建立 Hub 契约与安全凭据存储

**Files:**
- Create: `src/shared/hub-types.ts`
- Create: `src/main/services/hub-credential-store.ts`
- Create: `src/main/services/hub-credential-store.test.ts`
- Modify: `package.json`

**Interfaces:** `HubScope`（marketplace/personal/team）、`HubSort`、`HubUser`、`HubSession`、`HubTeam`、`HubPlugin`、`HubPluginQuery`、`HubPluginListResult` 和 `HubClientError`。这些共享类型不得含 token。

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHubCredentialStore } from './hub-credential-store'

test('persists encrypted data and clears it', () => {
  const store = createHubCredentialStore({
    filePath: 'temporary-test-path',
    encryption: { isAvailable: () => true, encrypt: (v) => Buffer.from('enc:' + v), decrypt: (v) => v.toString().slice(4) }
  })
  store.save('jwt-value')
  assert.equal(store.load(), 'jwt-value')
  store.clear()
  assert.equal(store.load(), null)
})
```

- [ ] **Step 2: 验证其失败**

Run: `node --import tsx --test src/main/services/hub-credential-store.test.ts`.  
Expected: FAIL because the store does not exist.

- [ ] **Step 3: 实现安全存储**

`createHubCredentialStore` 接收 `filePath` 与 `{ isAvailable, encrypt, decrypt }`，以便测试注入。生产工厂使用 Electron `safeStorage`、`getAppUserDataPath()` 和私有 `hub-session.json`。磁盘只写 `{ token: "<base64 ciphertext>" }`，`clear()` 删除文件和内存；不可加密时只保存内存 token。

- [ ] **Step 4: 注册、验证并提交**

```bash
# 将 hub-credential-store.test.ts 追加到 package.json 的 test:unit。
node --import tsx --test src/main/services/hub-credential-store.test.ts
npm run lint
git add src/shared/hub-types.ts src/main/services/hub-credential-store.ts src/main/services/hub-credential-store.test.ts package.json
git commit -m "feat: add secure Hub session storage"
```

### Task 3: 实现仅在主进程执行的 Hub 客户端

**Files:**
- Create: `src/main/services/hub-client.ts`
- Create: `src/main/services/hub-client.test.ts`
- Modify: `src/main/services/hub-script-installer.ts`
- Modify: `package.json`

**Interfaces:** `createHubClient` 返回 `session/login/logout/listTeams/listPlugins/getPlugin/installPlugin`；任何返回值不含 JWT 或 `zipUrl`。

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHubClient } from './hub-client'

test('login saves token but returns a token-free session', async () => {
  let saved = ''
  const client = createHubClient({
    getHubUrl: () => 'https://hub.example.com/',
    credentials: { load: () => null, save: (t: string) => { saved = t }, clear: () => {} },
    request: async () => ({ ok: true, status: 200, json: async () => ({ token: 'secret', user: { id: 'u1', email: 'a@b.c', displayName: 'A', avatarUrl: '', teamCount: 0 } }) }),
    install: async () => ({ scriptId: 'local-1', name: 'Demo', status: 'installed' as const })
  })
  const session = await client.login('a@b.c', 'pw')
  assert.equal(saved, 'secret')
  assert.equal(JSON.stringify(session).includes('secret'), false)
})
```

- [ ] **Step 2: 验证其失败**

Run: `node --import tsx --test src/main/services/hub-client.test.ts`.  
Expected: FAIL because the client does not exist.

- [ ] **Step 3: 实现主进程客户端**

实现以下接口：

```ts
session(): Promise<HubSession>
login(email: string, password: string): Promise<HubSession>
logout(): void
listTeams(): Promise<HubTeam[]>
listPlugins(query: HubPluginQuery): Promise<HubPluginListResult>
getPlugin(id: string): Promise<HubPlugin>
installPlugin(id: string): Promise<{ scriptId: string; name: string; status: 'installed' | 'updated' | 'duplicate_cancelled' }>
```

使用 `new URL` 规范化地址并拒绝非 HTTP(S)。认证请求辅助函数仅在主进程添加 `Authorization`；安全解析错误 JSON，映射 `401/403/404/409/429`，401 清凭据且错误信息不含 URL。安装调用 `POST /api/scripts/:id/install-token`，校验 `zipUrl/scriptName/hubScriptId` 后交给现有 `installScriptFromHubZip`，不改变 bridge。

- [ ] **Step 4: 注册、验证并提交**

```bash
# 将 hub-client.test.ts 追加到 test:unit。
node --import tsx --test src/main/services/hub-client.test.ts src/main/services/hub-credential-store.test.ts
npm run lint
git add src/main/services/hub-client.ts src/main/services/hub-client.test.ts src/main/services/hub-script-installer.ts package.json
git commit -m "feat: add Hub client and direct installer flow"
```

### Task 4: 暴露受限 IPC 和 preload API

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Create: `src/preload/hub-api.test.mjs`
- Modify: `package.json`

**Interfaces:** `window.autoforge.hub` 仅含 `session/login/logout/listTeams/listPlugins/getPlugin/installPlugin`。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Hub preload exposes no token getter', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.match(source, /hub:\s*\{/)
  assert.match(source, /login:\s*\(email: string, password: string\)/)
  assert.doesNotMatch(source, /HUB_GET_TOKEN/)
})
```

- [ ] **Step 2: 验证其失败**

Run: `node --test src/preload/hub-api.test.mjs`.  
Expected: FAIL because no `hub` preload object exists.

- [ ] **Step 3: 实现受限 API**

在 `IPC` 新增 `HUB_SESSION/HUB_LOGIN/HUB_LOGOUT/HUB_LIST_TEAMS/HUB_LIST_PLUGINS/HUB_GET_PLUGIN/HUB_INSTALL_PLUGIN`。在 `registerIpcHandlers` 创建单一 Hub client，URL 从 `scriptStore.getConfig().hub?.url ?? ''` 读取，安装器为现有 `installScriptFromHubZip`。handlers 校验 email/password、插件 ID 和查询对象。

`CONFIG_SET` 保存后比较规范化前后 origin；不同时调用 `hubClient.logout()`。preload 的 `hub` 对象将七个方法逐一映射 `ipcRenderer.invoke`，绝不增加 token 或临时 URL getter。

- [ ] **Step 4: 验证并提交**

```bash
# 将 hub-api.test.mjs 追加到 test:unit。
node --test src/preload/hub-api.test.mjs
npm run lint
npm run build
git add src/shared/ipc-channels.ts src/main/ipc/handlers.ts src/preload/index.ts src/preload/hub-api.test.mjs package.json
git commit -m "feat: expose safe Hub IPC API"
```

### Task 5: 构建原生插件中心 UI

**Files:**
- Create: `src/renderer/src/composables/useHubPluginCenter.ts`
- Create: `src/renderer/src/components/HubPluginCenterPanel.vue`
- Create: `src/renderer/src/components/HubPluginCenterPanel.test.mjs`
- Modify: `src/renderer/src/components/Sidebar.vue`
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/components/SettingsPanel.vue`
- Modify: `package.json`

**Interfaces:** 组合式函数持有 panel、登录、查询、分页和单安装状态；界面只调用 `window.autoforge.hub` 与既有 Toast。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('plugin center contains required sources and guarded install', () => {
  const source = readFileSync(new URL('./HubPluginCenterPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /插件市场/)
  assert.match(source, /我的插件/)
  assert.match(source, /团队插件/)
  assert.match(source, /:disabled="installingId !== null"/)
  assert.match(source, /window\.autoforge\.hub\.installPlugin/)
})
```

- [ ] **Step 2: 验证其失败**

Run: `node --test src/renderer/src/components/HubPluginCenterPanel.test.mjs`.  
Expected: FAIL because the panel does not exist.

- [ ] **Step 3: 实现状态和界面**

组合式函数状态固定为 `open/session/scope/teamId/teams/items/loading/installingId/error/page/hasMore/filters`。`refresh()` 先读 session，认证后读取 teams 和当前来源。`loadPage(reset)` 使用 `pageSize: 30`；来源、团队或筛选变化时重置第一页；仅加载更多时追加。`install(id)` 使用 `installingId` 防并发，对安装/更新成功 Toast，对 `duplicate_cancelled` 保持中性，并在 finally 清状态。

全屏面板复用 `SettingsPanel.vue` 结构：未登录为邮箱、密码、登录、注册/找回密码外链；已登录为分段“插件市场 / 我的插件 / 团队插件”、团队选择器、搜索、分类、语言、排序、紧凑卡片、README 详情及加载/空/重试状态。使用 Lucide `Download/ExternalLink/KeyRound/LogOut/RefreshCw/Search/X`；图标按钮必须含 tooltip 和 aria-label，安装按钮固定 `:disabled="installingId !== null"`，窄窗口将筛选收进工具菜单。

Sidebar 将 `openAutoforgeHub` 改为 `pluginCenter` emit 和“插件中心”标签。`App.vue` 管理 `showHubPluginCenter` 并挂载面板，保留 `onHubScriptInstalled` 以复用本地列表刷新与选中。SettingsPanel 说明更改 Hub 地址将退出当前会话，不添加 token 字段。

- [ ] **Step 4: 验证、人工验收并提交**

```bash
# 将 panel 测试追加到 test:unit。
node --test src/renderer/src/components/HubPluginCenterPanel.test.mjs
npm run lint
npm run build
npm run dev
git add src/renderer/src/composables/useHubPluginCenter.ts src/renderer/src/components/HubPluginCenterPanel.vue src/renderer/src/components/HubPluginCenterPanel.test.mjs src/renderer/src/components/Sidebar.vue src/renderer/src/App.vue src/renderer/src/components/SettingsPanel.vue package.json
git commit -m "feat: add native Hub plugin center"
```

人工验收：登录、市场/个人/各团队、首次安装、重复更新确认与取消、退出、改 Hub 地址、断网重试和过期 JWT；确认控制台无敏感字段。

### Task 6: 文档和完整回归

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: 更新文档**

README 增加插件中心能力。架构文档描述主进程 `hub-client`、私有加密凭据及 token 不跨 preload。变更日志记录插件中心和团队列表授权修复。

- [ ] **Step 2: 完整验证**

```bash
# C:/Users/13652/Desktop/Autoforge
npm run test:unit
npm run lint
npm run build
git diff --check
```

```bash
# D:/myProject/AutoforgeHub
npm run test:marketplace-mine
npm run lint
git diff --check
```

Expected: 所有命令退出码为 0，两个 `git diff --check` 均无输出。

- [ ] **Step 3: 提交文档并检查两个仓库**

```bash
git add README.md docs/architecture.md docs/CHANGELOG.md
git commit -m "docs: describe Hub plugin center"
git status --short
```

在两个仓库分别运行 `git status --short`，报告计划提交与任何已有用户修改。
