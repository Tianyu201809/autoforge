# Hub 一键安装到本地 Autoforge — 桌面端设计规格

**日期**：2026-07-11  
**状态**：已实现（桌面端 v1.15.0）  
**关联**：Hub 端规格见同目录 `2026-07-11-hub-local-install-hub-side-design.md`

---

## 1. 背景与目标

Autoforge 是 Electron 桌面应用；脚本目前只能通过本机路径导入（文件对话框、拖拽、内置示例）。团队脚本中心网站 Autoforge Hub 已可托管脚本，但与桌面端无桥接。

**目标**：用户在 Hub 点击「添加到本地」后，若本机 Autoforge **已在运行**，则自动下载脚本 zip、导入本地脚本库、聚焦主窗口并打开该脚本。

**非目标（本期不做）**：

- 未启动时自动拉起 Autoforge（自定义协议 / 安装器）
- Hub / zip 下载鉴权
- 按 `hubScriptId` 去重或覆盖更新（重复安装 = 新脚本副本）
- 改造侧边栏「脚本市场」占位入口（入口在 Hub 网站）
- 浏览器扩展或其他非 HTTP 桥方案

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 改动范围 | Hub 与 Autoforge 桌面端均可改 |
| 未启动处理 | 必须已打开；Hub 探测失败则提示先启动 |
| 鉴权 | v1 不做；zip URL 公开可读 |
| 包格式 | 可下载 zip（含 `autoforge.json` + 入口等） |
| 成功体验 | toast + 窗口提到前台 + 选中/打开该脚本 |
| 桥接方式 | 方案 1：本机 HTTP 桥（`127.0.0.1`） |

---

## 3. 架构与数据流

```
Hub 网页                         Autoforge (已运行)
────────                         ─────────────────
点「添加到本地」
    │
    ├─ GET  http://127.0.0.1:19276/health
    │         └─ 失败 → 页面提示「请先启动 Autoforge」
    │
    └─ POST http://127.0.0.1:19276/install
         body: { zipUrl, scriptName?, hubScriptId? }
              │
              ▼
         HubBridgeServer（仅绑定 127.0.0.1）
              │
              ├─ 下载 zip → 临时目录
              ├─ 解压并定位含 autoforge.json 的包根
              ├─ scriptWorkspace / script-registry 导入
              ├─ 聚焦主窗口 + 通知 renderer 选中 scriptId
              └─ 返回 { ok, scriptId, name }
```

**端口**：固定 `19276`（避开 Hub 常用的 `9876`）。

---

## 4. 本机 HTTP API

### 4.1 约定

- 监听：`127.0.0.1:19276`（禁止 `0.0.0.0`）
- 生命周期：应用 ready 时启动，退出前关闭
- CORS：因仅本机，v1 可允许任意 Origin（或配置允许的 Hub Origin 列表）
- 并发：全局 install 锁；进行中再请求返回 `409`

### 4.2 `GET /health`

**响应 200**：

```json
{
  "ok": true,
  "app": "autoforge",
  "version": "<package.json version>"
}
```

### 4.3 `POST /install`

**请求体**：

```json
{
  "zipUrl": "https://example.com/path/to/script.zip",
  "scriptName": "可选显示名",
  "hubScriptId": "可选，仅日志/后续扩展"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `zipUrl` | ✅ | 绝对 URL；仅 `http:` / `https:` |
| `scriptName` | | 可选；不覆盖包内 `autoforge.json` 的 name（可用于日志/toast） |
| `hubScriptId` | | 可选；v1 不参与去重 |

**成功 200**：

```json
{
  "ok": true,
  "scriptId": "<uuid>",
  "name": "<脚本显示名>"
}
```

**错误**：

| 情况 | HTTP | 说明 |
|------|------|------|
| 缺 `zipUrl` / 非法 scheme / 非绝对 URL | 400 | 参数错误 |
| 下载失败或超时 | 502 | 网络/远端问题 |
| zip 损坏、解压失败、找不到 `autoforge.json` | 400 | 无效脚本包 |
| 导入异常 | 500 | 内部错误 |
| 已有安装进行中 | 409 | 防连点 |

错误 body 统一形如：`{ "ok": false, "error": "<机器可读 code>", "message": "<人类可读>" }`。

建议 `error` 枚举：`invalid_request` | `download_failed` | `invalid_package` | `import_failed` | `busy`。

---

## 5. 桌面端实现要点

### 5.1 新模块

- `HubBridgeServer`（main）：HTTP 服务 + 路由
- 安装流水线函数（可与 server 同文件或独立 service）：download → extract → validate → import → focus/select

### 5.2 与现有导入衔接

- 复用 `scriptWorkspace.import(sourcePath)` / `script-registry` 注册逻辑
- Zip 解压后：
  - 若临时根目录直接含 `autoforge.json` → 以该目录 import
  - 若仅有一个子目录且其内含 `autoforge.json` → 以该子目录 import
  - 否则 → `invalid_package`
- 包规范以仓库 `docs/script-spec.md` 为准（至少需要有效 `autoforge.json`）

### 5.3 成功后的 UI

1. `BrowserWindow` show + focus（必要时 `setAlwaysOnTop` 瞬时 trick 仅在确有必要时使用，优先系统 focus API）
2. 向 renderer 发送事件（新建 IPC/channel 或复用现有脚本列表刷新 + select），选中并打开刚导入的 `scriptId`
3. 桌面端 toast：安装成功

### 5.4 安全与清理

- 只绑 localhost
- 拒绝非 http(s) 的 `zipUrl`
- 下载/解压使用唯一临时目录；成功或失败后删除
- 下载设合理超时（建议 60s，可配置）
- 不在日志中完整打印超大 URL query（若未来带 token；v1 公开 URL 可记）

### 5.5 明确不做

- `autoforge://` 协议注册
- 单实例 second-instance 协议参数（本期无协议）
- Hub 登录态转发
- 侧边栏「脚本市场」接线

---

## 6. 测试要点

| 场景 | 期望 |
|------|------|
| `GET /health` | 200 + `ok` + version |
| 合法 zip | 导入成功；窗口聚焦；脚本被选中；200 |
| 缺 manifest / 坏 zip | 400 `invalid_package` |
| 下载失败 | 502 `download_failed` |
| 非法 `zipUrl` | 400 `invalid_request` |
| 并发第二次 install | 409 `busy` |
| 临时目录 | 结束后不残留 |

Hub 按钮文案与探测 UX 见 Hub 端规格，不在本仓库 UI 测试范围内。

---

## 7. 文件落点（建议）

| 区域 | 路径（建议） |
|------|----------------|
| 桥接服务 | `src/main/services/hub-bridge-server.ts` |
| 启动挂载 | `src/main/index.ts` |
| 选中脚本事件 | `src/shared/ipc-channels.ts` + preload + renderer 列表 store |
| 依赖 | 若需解压 zip：选用已有或轻量库（如 `adm-zip` / `yauzl`）；下载用 Node `fetch` 或 `net` |

具体库选择在实现计划中确定；本规格只要求行为正确。

---

## 8. 与 Hub 的契约摘要

桌面端保证：

- 固定端口 `19276` 上提供 `/health` 与 `/install`
- 未运行时无监听（Hub 用短超时判定）

Hub 保证（详见 Hub 规格）：

- 提供公开绝对 `zipUrl`
- zip 符合 Autoforge 脚本包规范
- 先 health 再 install，并处理未启动提示
