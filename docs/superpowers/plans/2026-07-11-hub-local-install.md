# Hub 一键安装到本地 — Autoforge 桌面端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autoforge 运行时在 `127.0.0.1:19276` 提供 `/health` 与 `/install`；Hub 传入公开 zip URL 后，桌面端下载、解压、导入，并聚焦窗口打开该脚本。

**Architecture:** main 进程新增 `HubBridgeServer`（Node `http`，仅绑 localhost）。`POST /install` 走 download → extract → 定位 `autoforge.json` → `scriptRegistry.importFromPath` → `showMainWindow` + `broadcastToRenderers(EVENT_HUB_SCRIPT_INSTALLED)`。renderer 刷新列表并 `selectScript`。

**Tech Stack:** Electron main、Node `http` / `fetch`、zip 解压库（`adm-zip`）、现有 `script-registry` / `showMainWindow` / `broadcastToRenderers`

**Spec:** `docs/superpowers/specs/2026-07-11-hub-local-install-design.md`  
**Hub 端（本计划不实现）:** `docs/superpowers/specs/2026-07-11-hub-local-install-hub-side-design.md`

## Global Constraints

- 仅 `127.0.0.1:19276`；不注册自定义协议、不自动拉起应用
- v1 无鉴权；`zipUrl` 仅允许 `http:` / `https:`
- 重复安装 = 新脚本副本；不按 `hubScriptId` 去重
- 不改侧边栏「脚本市场」占位
- 全局 install 锁；临时目录用后删除
- YAGNI：无签名校验、无增量更新、无 Hub 登录态转发

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/main/services/hub-bridge-server.ts` | HTTP 服务、CORS、health/install、锁 |
| `src/main/services/hub-script-installer.ts` | 下载 zip、解压、定位包根、调用 registry |
| `src/main/index.ts` | ready 时 start，before-quit 时 stop |
| `src/shared/ipc-channels.ts` | `EVENT_HUB_SCRIPT_INSTALLED` |
| `src/preload/index.ts` + `src/renderer/src/env.d.ts` | 暴露 `onHubScriptInstalled` |
| `src/renderer/src/App.vue`（或 composable） | 订阅事件 → refresh + selectScript + toast |
| `package.json` | 增加 `adm-zip`（及 `@types/adm-zip` 若需要） |

不修改：Hub 仓库、脚本市场 Sidebar toast、自定义协议。

---

### Task 1: 增加 zip 依赖

**Files:**
- Modify: `package.json` / `package-lock.json`

- [ ] **Step 1: 安装 adm-zip**

Run:

```powershell
npm install adm-zip
npm install -D @types/adm-zip
```

- [ ] **Step 2: 确认依赖写入**

Run:

```powershell
node -e "require('adm-zip'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```powershell
git add package.json package-lock.json
git commit -m @"
Add adm-zip for Hub script package extraction.
"@
```

---

### Task 2: 实现 hub-script-installer（纯安装流水线）

**Files:**
- Create: `src/main/services/hub-script-installer.ts`

**Interfaces:**
- Consumes: `scriptRegistry.importFromPath`, Node `fetch`/`fs`, `adm-zip`
- Produces: `{ scriptId, name }` 或抛错（带可映射到 API error code 的信息）

- [ ] **Step 1: 实现 URL 校验与下载**

```typescript
// 伪代码要点
export type HubInstallErrorCode =
  | 'invalid_request'
  | 'download_failed'
  | 'invalid_package'
  | 'import_failed'

export class HubInstallError extends Error {
  constructor(
    public code: HubInstallErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HubInstallError'
  }
}

function assertHttpUrl(zipUrl: unknown): string {
  if (typeof zipUrl !== 'string' || !zipUrl.trim()) {
    throw new HubInstallError('invalid_request', '缺少 zipUrl')
  }
  let u: URL
  try {
    u = new URL(zipUrl)
  } catch {
    throw new HubInstallError('invalid_request', 'zipUrl 不是合法 URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new HubInstallError('invalid_request', 'zipUrl 仅支持 http/https')
  }
  return u.toString()
}
```

下载：`fetch(url, { signal: AbortSignal.timeout(60_000) })` → `arrayBuffer` → 写入 `os.tmpdir()/autoforge-hub-install-<uuid>/package.zip`。失败抛 `download_failed`。

- [ ] **Step 2: 解压并定位包根**

- 解压到同临时目录下的 `extracted/`
- 若 `extracted/autoforge.json` 存在 → 包根 = `extracted`
- 否则若 `extracted` 下**恰好一个**子目录且其内有 `autoforge.json` → 包根 = 该子目录
- 否则抛 `invalid_package`（「不是有效的 Autoforge 脚本包」）

- [ ] **Step 3: import 并返回**

```typescript
const meta = scriptRegistry.importFromPath(packageRoot)
// finally: rmSync(tempDir, { recursive: true, force: true })
return { scriptId: meta.id, name: meta.name }
```

import 抛错 → `import_failed`。`finally` 必须清理临时目录。

- [ ] **Step 4: 导出主函数**

```typescript
export async function installScriptFromHubZip(input: {
  zipUrl: string
  scriptName?: string
  hubScriptId?: string
}): Promise<{ scriptId: string; name: string }>
```

`scriptName` / `hubScriptId` v1 仅 `console.info` 日志，不改 meta。

- [ ] **Step 5: Commit**

```powershell
git add src/main/services/hub-script-installer.ts
git commit -m @"
Add Hub zip download and local script import pipeline.
"@
```

---

### Task 3: 实现 HubBridgeServer

**Files:**
- Create: `src/main/services/hub-bridge-server.ts`

**Interfaces:**
- Consumes: `installScriptFromHubZip`, `HubInstallError`, `showMainWindow`, `broadcastToRenderers`, `package.json` version
- Produces: listening server on `127.0.0.1:19276`

- [ ] **Step 1: 常量与 CORS 辅助**

```typescript
export const HUB_BRIDGE_HOST = '127.0.0.1'
export const HUB_BRIDGE_PORT = 19276

function setCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}
```

- [ ] **Step 2: 路由**

| 方法 | 路径 | 行为 |
|------|------|------|
| `OPTIONS` | `*` | 204 + CORS |
| `GET` | `/health` | `{ ok: true, app: "autoforge", version }` |
| `POST` | `/install` | 见下 |
| 其他 | | 404 |

`POST /install`：
1. 若 `installing === true` → 409 `{ ok:false, error:"busy", message:"正在安装，请稍候" }`
2. 解析 JSON body；缺字段由 installer 抛 `invalid_request`
3. `installing = true` → await install → 成功则 `showMainWindow()` + `broadcastToRenderers(IPC.EVENT_HUB_SCRIPT_INSTALLED, { scriptId, name })` → 200
4. `finally` 清 `installing`
5. 映射 `HubInstallError.code` → HTTP：`invalid_request`/`invalid_package`→400，`download_failed`→502，`import_failed`→500，`busy`→409

- [ ] **Step 3: start / stop API**

```typescript
export function startHubBridgeServer(): void
export function stopHubBridgeServer(): void
```

- `listen({ host: HUB_BRIDGE_HOST, port: HUB_BRIDGE_PORT })`
- 端口占用：`console.error` 后不抛崩应用（记录错误即可，避免影响主功能）
- `stop`：`server.close()`；幂等

读 body：限制合理大小（如 64KB，仅 JSON 元数据）。

- [ ] **Step 4: Commit**

```powershell
git add src/main/services/hub-bridge-server.ts
git commit -m @"
Add localhost Hub bridge HTTP server for script install.
"@
```

---

### Task 4: 挂载生命周期 + IPC 事件通道

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: 增加 IPC 常量**

在 `IPC` 中增加：

```typescript
EVENT_HUB_SCRIPT_INSTALLED: 'event:hub-script-installed',
```

- [ ] **Step 2: main 启动/停止**

在 `app.whenReady()` 里 `createWindow()` 之后调用 `startHubBridgeServer()`。  
在 `app.on('before-quit')` 中于 `closeDatabase()` 前调用 `stopHubBridgeServer()`。

确保 `hub-bridge-server` 通过静态 import 引用 `showMainWindow`（从 `main-window-mode.ts`），避免循环依赖；若有环，改为 install 成功回调由 `index.ts` 注入 `onInstalled`。

推荐注入，降低耦合：

```typescript
startHubBridgeServer({
  onInstalled: (payload) => {
    showMainWindow()
    broadcastToRenderers(IPC.EVENT_HUB_SCRIPT_INSTALLED, payload)
  }
})
```

- [ ] **Step 3: preload 订阅**

```typescript
onHubScriptInstalled: (callback: (payload: { scriptId: string; name: string }) => void): (() => void) => {
  const handler = (_e: IpcRendererEvent, payload: { scriptId: string; name: string }) => callback(payload)
  ipcRenderer.on(IPC.EVENT_HUB_SCRIPT_INSTALLED, handler)
  return () => ipcRenderer.removeListener(IPC.EVENT_HUB_SCRIPT_INSTALLED, handler)
}
```

同步更新 `env.d.ts` 中 `window.autoforge` 类型。

- [ ] **Step 4: Commit**

```powershell
git add src/main/index.ts src/shared/ipc-channels.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m @"
Wire Hub bridge lifecycle and renderer install event.
"@
```

---

### Task 5: Renderer 选中脚本 + toast

**Files:**
- Modify: `src/renderer/src/App.vue`（或抽一小段到现有 composable；优先最小改动挂在 `App.vue` 的 `onMounted`）

- [ ] **Step 1: 订阅事件**

在 `App.vue` 已有 setup 中：

```typescript
onMounted(() => {
  // 若已有 onMounted，合并进去
  const unsub = window.autoforge.onHubScriptInstalled?.(async ({ scriptId, name }) => {
    await refresh() // 使用现有 script store refresh
    const script = /* 从 scripts 列表按 scriptId 查找 */
    if (script) selectScript(script, 'detail')
    pushToast({ type: 'success', title: '已从 Hub 添加', message: name || '脚本已导入' })
  })
  onUnmounted(() => unsub?.())
})
```

按 `App.vue` 现有 `refresh` / `selectScript` / `useToast` 实际符号接线；若 `onHubScriptInstalled` 挂在 `window.autoforge` 根上，与 preload 导出一致。

- [ ] **Step 2: 确认列表含新脚本**

`refresh()` 必须在 `selectScript` 之前完成，避免找不到 id。

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/src/App.vue
git commit -m @"
Open and toast Hub-installed scripts in the main UI.
"@
```

---

### Task 6: 手动联调验证

**Files:** 无代码；使用 `examples/hello-world` 打 zip

- [ ] **Step 1: 准备测试 zip**

Run（仓库根目录）：

```powershell
New-Item -ItemType Directory -Force -Path tmp | Out-Null
Compress-Archive -Path examples\hello-world\* -DestinationPath tmp\hello-world.zip -Force
```

- [ ] **Step 2: 起一个静态文件服务提供 zipUrl**

另开终端（仓库根）：

```powershell
npx --yes serve tmp -p 19876
```

zipUrl 示例：`http://127.0.0.1:19876/hello-world.zip`

- [ ] **Step 3: 启动 Autoforge**

```powershell
npm run dev
```

- [ ] **Step 4: 探测 health**

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:19276/health
```

Expected: `ok=True`, `app=autoforge`, 含 version

- [ ] **Step 5: 安装**

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:19276/install -ContentType 'application/json' -Body '{"zipUrl":"http://127.0.0.1:19876/hello-world.zip","scriptName":"hello-world","hubScriptId":"test-1"}'
```

Expected: `ok=True` + `scriptId`；Autoforge 窗口前置并打开该脚本；toast 成功。

- [ ] **Step 6: 负面用例**

```powershell
# 非法 scheme
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:19276/install -ContentType 'application/json' -Body '{"zipUrl":"file:///C:/x.zip"}'
# 期望报错 invalid_request

# 坏包：空 zip 或无 manifest 的 zip
```

- [ ] **Step 7: 清理临时测试产物（勿提交）**

```powershell
Remove-Item -Recurse -Force tmp -ErrorAction SilentlyContinue
```

确保 `tmp/` 若被创建且不该进库，已在 `.gitignore` 或已删除。

---

### Task 7: 收尾

- [ ] **Step 1: lint 相关文件**

```powershell
npx eslint src/main/services/hub-bridge-server.ts src/main/services/hub-script-installer.ts src/main/index.ts src/shared/ipc-channels.ts src/preload/index.ts src/renderer/src/App.vue
```

Expected: 无 error（warning 按仓库惯例处理）

- [ ] **Step 2: 若有未提交修复则 commit**

```powershell
git status
# 如有修复：
git add <files>
git commit -m @"
Fix Hub local-install bridge lint and edge cases.
"@
```

---

## 完成定义

- [ ] `GET /health` 在应用运行时返回 ok
- [ ] 合法 zip → 导入成功、窗口聚焦、详情打开、toast
- [ ] 非法 URL / 坏包 / 下载失败返回规格中的状态码与 `error` 字段
- [ ] 并发 install 返回 409
- [ ] 临时目录不残留
- [ ] Hub 端规格仍由 Hub 仓库单独实现（本计划不包含）

## 执行交接

计划写好后，可选执行方式：

1. **Subagent-driven（推荐）** — 按 task 派发子代理，每 task 再审查  
2. **Inline** — 在本会话按 checkbox 顺序实现  

需要实现时说一声用哪种方式即可。
