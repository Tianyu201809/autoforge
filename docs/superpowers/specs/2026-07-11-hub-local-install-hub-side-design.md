# Hub「添加到本地 Autoforge」— Hub 端设计规格

**日期**：2026-07-11  
**状态**：已批准  
**读者**：Autoforge Hub 仓库实现者  
**关联**：桌面端规格在 Autoforge 仓库  
`docs/superpowers/specs/2026-07-11-hub-local-install-design.md`

本文可独立拷贝到 Hub 仓库；实现时不必依赖桌面端源码，只需遵守下列契约。

---

## 1. 目标

在 Hub 网站上，用户点击脚本的「添加到本地」后：

1. 若本机 **未运行** Autoforge → 提示先启动桌面端  
2. 若 **已运行** → 把该脚本的 **公开 zip URL** 交给本机桥，由桌面端完成下载、导入、聚焦并打开脚本  
3. Hub 页面展示成功或失败提示

**非目标（本期）**：

- 启动或安装 Autoforge  
- zip / API 鉴权（脚本包公开可读）  
- 本机去重、版本更新、覆盖安装  
- 解压与 `autoforge.json` 校验（由桌面端完成）

---

## 2. 与桌面端的契约

Autoforge 桌面端在运行时提供本机 HTTP 服务：

| 项 | 值 |
|----|-----|
| Base URL | `http://127.0.0.1:19276` |
| 探测 | `GET /health` |
| 安装 | `POST /install` |
| 绑定 | 仅本机；浏览器跨域由桌面端 CORS 处理 |

### 2.1 `GET /health`

- Hub 超时建议：**1 秒**
- 成功：HTTP 200，body 含 `"ok": true`（可忽略其余字段）
- 失败：网络错误、超时、非 200 → 视为 **Autoforge 未运行**

### 2.2 `POST /install`

**Content-Type**：`application/json`

```json
{
  "zipUrl": "https://<hub-host>/.../script.zip",
  "scriptName": "可选，脚本显示名",
  "hubScriptId": "可选，Hub 侧脚本 ID"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `zipUrl` | ✅ | **绝对 URL**，Autoforge 进程可直接 GET 下载（不要依赖浏览器 cookie） |
| `scriptName` | | 建议传，便于桌面端 toast/日志 |
| `hubScriptId` | | 建议传，便于日后扩展；v1 桌面端不去重 |

**成功**：HTTP 200，`{ "ok": true, "scriptId": "...", "name": "..." }`  
Hub 提示：**已添加到本地 Autoforge**（可附带 `name`）。

**失败**：非 200；body 可能为：

```json
{
  "ok": false,
  "error": "invalid_package",
  "message": "不是有效的 Autoforge 脚本包"
}
```

优先展示 `message`；无则按状态码使用默认文案（见 §5）。

---

## 3. Hub 后端：公开 zip 下载

### 3.1 要求

每个可「添加到本地」的脚本必须能产出一个 **无需登录即可下载** 的 zip（v1）。

Zip 解压后须符合 Autoforge 脚本包规范（与桌面端 `docs/script-spec.md` 一致），至少：

```
<package-root>/
├── autoforge.json    # 必填
└── <entry>           # 如 index.mjs / index.py
```

允许 zip 内多包一层目录（桌面端会识别「唯一子目录 + autoforge.json」）。

`autoforge.json` 最小字段示例：

```json
{
  "autoforge": "1.0",
  "name": "脚本名称",
  "version": "1.0.0",
  "entry": "index.mjs"
}
```

### 3.2 API 建议（若尚无）

```
GET /api/scripts/:id/download
→ 200 application/zip
→ Content-Disposition: attachment; filename="<slug-or-id>.zip"
```

- **无需** Authorization（本期）
- 返回的 URL 必须是桌面端能访问的绝对地址（含正确 host/port，例如 `http://123.56.161.139:9876/...`）
- 若 Hub 有反向代理或内网地址，确保 **用户本机上的 Autoforge** 能解析并访问该 URL（不要用仅容器内网可达的 hostname）

### 3.3 包内容来源

从 Hub 已存储的脚本文件组装 zip，保证与线上「可运行脚本」一致（清单 + 入口 + 依赖声明文件等）。不要打进仅 Hub 元数据、无入口的空包。

---

## 4. Hub 前端：按钮与流程

### 4.1 UI

- 位置：脚本详情页必做；列表行可选
- 文案建议：**添加到本地** 或 **安装到 Autoforge**
- 点击后按钮进入 loading，结束前防重复提交

### 4.2 点击流程

```
1. 进入 loading
2. GET http://127.0.0.1:19276/health  （timeout ≈ 1s）
   - 失败 → 提示「请先启动 Autoforge 桌面端，然后再试」→ 结束
3. 解析本脚本的公开 zip 绝对 URL（download API）
4. POST http://127.0.0.1:19276/install
   body: { zipUrl, scriptName, hubScriptId }
5. 成功 → 提示「已添加到本地 Autoforge」
   失败 → 展示桌面端 message 或 §5 默认文案
6. 结束 loading
```

### 4.3 配置

- 本机桥 Base URL 默认：`http://127.0.0.1:19276`
- 可作为 Hub 前端环境变量 / 配置项覆盖；v1 写死亦可

### 4.4 浏览器注意点

- 请求发往 `127.0.0.1`，与 Hub 页面跨源；依赖桌面端 CORS。若预检失败，与桌面端对齐 `Access-Control-Allow-Origin`（桌面端规格允许 v1 放宽）
- `zipUrl` 必须是 **Autoforge 去拉** 的地址，不是「仅当前浏览器会话可下载」的 blob 链接

---

## 5. 用户可见文案

| 场景 | 文案 |
|------|------|
| health 失败 | 请先启动 Autoforge 桌面端，然后再试 |
| install 成功 | 已添加到本地 Autoforge |
| 400 / `invalid_package` | 优先用返回 `message`；默认：不是有效的 Autoforge 脚本包 |
| 502 / `download_failed` | 下载失败，请重试 |
| 409 / `busy` | 正在安装，请稍候 |
| 其他错误 | 添加失败，请重试（可附 `message`） |

---

## 6. Hub 不负责的事项

- 监听端口、下载 zip 到磁盘、解压、写入 Autoforge 脚本库  
- 聚焦 Electron 窗口、打开脚本详情  
- v1 鉴权、签名 URL、按用户隔离下载（若日后要做，需同步改桌面端 `/install` 契约）

---

## 7. 验收清单（Hub）

- [ ] 脚本具备公开 zip 下载；解压后含合法 `autoforge.json`  
- [ ] Autoforge **未开**：点按钮 → 明确提示启动  
- [ ] Autoforge **已开** + 合法包：Hub 成功提示；本机出现脚本并被打开（目视桌面端）  
- [ ] 故意提供坏包（无 manifest）：Hub 展示无效包类错误  
- [ ] 安装过程中按钮不可重复有效提交（loading / disabled）  
- [ ] `zipUrl` 为绝对 URL，且在「仅跑 Autoforge、不登录 Hub」的机器上用 curl/浏览器可下载

---

## 8. 实现顺序建议

1. 后端：脚本 → zip 下载接口（公开）  
2. 用一份已知合法的 Autoforge 示例包验证 zip 结构  
3. 前端：health + install 按钮流程与文案  
4. 与已实现本机桥的 Autoforge 联调（端口 `19276`）

---

## 9. 契约速查卡

```
Health:  GET  http://127.0.0.1:19276/health
Install: POST http://127.0.0.1:19276/install
         { "zipUrl": "<absolute http(s) url>", "scriptName?": "", "hubScriptId?": "" }

Hub provides: public zip with autoforge.json (+ entry files)
Hub does not: start Autoforge, unzip, or write local script DB
```
