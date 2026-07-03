---
name: autoforge-script-create
description: 新建 Autoforge 脚本包（autoforge.json + run(ctx)），支持 JavaScript / TypeScript / Python。含 env/params schema（text、textarea、number、select、radio、checkbox、boolean、attachment）。Use when the user invokes /autoforge-script-create, asks to create a new Autoforge script (JS/TS/Python), scaffold a script package, add params with select/checkbox, or add a package under packages/ or examples/.
disable-model-invocation: true
---

# Autoforge 脚本创建（/autoforge-script-create）

在 `packages/` 或 `examples/` 下新建符合 Autoforge 规范的脚本包。权威规范见 [docs/script-spec.md](../../../docs/script-spec.md)；字段与 schema 速查见 [reference.md](reference.md)。

## 前置确认

向用户确认（可从对话推断则跳过）：

1. **脚本名**（kebab-case 目录名，如 `order-export`）
2. **用途与分类**：`browser` / `local` / `scrape` / `file` / `system`
3. **语言 / 实现方式**（三选一）：
   - **JavaScript** — `index.mjs`，简单任务、浏览器自动化
   - **TypeScript** — `src/index.ts` → `dist/index.js`，复杂逻辑、需 `pnpm build`
   - **Python** — `index.py`，独立子进程运行；需本机 **Python 3.9+**（设置 → Python 可配路径）
4. **env vs params**（**禁止混用**）：
   - 换环境才变（URL、账号、Token）→ `env`，平台 **配置 Tab**
   - 每次任务才变（订单号、日期、任务 ID）→ `params`，平台 **详情 Tab**
   - 每次运行需上传的本地文件 → `params` 且 `type: "attachment"`
5. **params 控件类型**（按需选用，默认 `text`）：
   - 单行 / 多行 / 数字 → `text` / `textarea` / `number`
   - 单选 → `select` 或 `radio`（需 `options`）
   - 多选 → `checkbox`（需 `options`，值为 JSON 数组字符串）
   - 开关 → `boolean`（值为 `"true"` / `"false"`）
   - 文件 → `attachment`（值为 JSON 数组字符串）
6. **浏览器脚本**是否需要无头模式（`browser.headless`；JS / Python 均支持 `ctx.sdk.browser.launch()`）
7. **依赖**：
   - JS / TS → `dependencies` 为 **npm** 包；可选设置 → 全局 npm 依赖
   - Python → `dependencies` 为 **pip** 包（安装至脚本 `.venv`）；可选设置 → 全局 Python 依赖
8. **是否落盘产物**（若需要 UI「产物目录」快捷入口，返回值须含 `outputDir` 等字段）

## 创建流程

```
Task Progress:
- [ ] 选定 JS / TS / Python 模板
- [ ] 创建 packages/<name>/（或 examples/<name>/）与 autoforge.json
- [ ] 声明 language、entry、env / params（含 type、options、browser 如需要）
- [ ] 实现 run(ctx)（Python 亦支持 main(ctx)）
- [ ] 有文件输出时返回 outputDir（本机绝对路径）
- [ ] （TS）配置 package.json / tsconfig / 构建脚本
- [ ] （JS/TS）pnpm build && pnpm lint；（Python）在平台导入后试运行
- [ ] 本地 test:local 或平台导入验证
```

### 方式一：纯 JavaScript

参考 `packages/crowdsourcing-token/`、`examples/hello-world/`：

```
packages/<name>/
├── autoforge.json
└── index.mjs
```

- `"language": "javascript"`（可省略，按 entry 推断）
- `"entry": "index.mjs"`
- 入口 `export async function run(ctx) { ... }`
- 浏览器脚本：`await ctx.sdk.browser.launch()`；abort 时关闭 browser

### 方式二：TypeScript

参考 `packages/floorplan-export/`、`packages/resume-screening/`：

```
packages/<name>/
├── autoforge.json         # entry: "dist/index.js"
├── package.json           # name: @autoforge/<name>
├── tsconfig.json
├── src/index.ts           # export async function run(ctx)
├── mock.json              # 可选
└── scripts/
    ├── copy-manifest.mjs
    └── run-local.mjs
```

**TypeScript 必做项：**

1. `tsconfig.json`：`outDir: "./dist/dist"`，`rootDir: "./src"`，`extends: "../../tsconfig.base.json"`
2. `autoforge.json` 的 `entry` 为 `"dist/index.js"`
3. `package.json` scripts：`build` / `lint` / `test:local`（与现有 TS 包一致）
4. 运行时依赖同时写入 `autoforge.json` 的 `dependencies` 与 `package.json`
5. `pnpm-workspace.yaml` 已含 `packages/*`，无需额外注册

**copy-manifest.mjs**（与现有包一致）：

```javascript
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(packageDir, "dist");

await mkdir(packDir, { recursive: true });
await copyFile(join(packageDir, "autoforge.json"), join(packDir, "autoforge.json"));
```

### 方式三：Python

参考 `examples/hello-world-py/`、`examples/playwright-py/`：

```
packages/<name>/          # 或 examples/<name>/
├── autoforge.json
└── index.py
```

- `"language": "python"`
- `"entry": "index.py"`
- 入口定义 **`async def run(ctx):`** 或 **`def run(ctx):`**（同步亦可；bootstrap 亦识别 `main(ctx)`）
- 首次运行前平台自动 `pip install` 至 `{scriptDir}/.venv`
- 浏览器脚本：`browser = await ctx.sdk.browser.launch()`，需在 `dependencies` 声明 `"playwright": ">=1.50.0"`

**hello-world-py 最小示例：**

```python
async def run(ctx):
    greeting = ctx.env.get("GREETING", "Hello")
    target = ctx.params.get("TARGET", "Autoforge")

    ctx.stage(name="greet", label="问候", message="准备输出")
    ctx.progress(scope="task", current=1, total=1, label="问候", unit="步")
    ctx.log("INFO", f"{greeting}, {target}!")

    return {"message": f"{greeting}, {target}!", "language": "python"}
```

**autoforge.json（Python）：**

```json
{
  "autoforge": "1.0",
  "name": "Hello Autoforge (Python)",
  "language": "python",
  "entry": "index.py",
  "category": "local",
  "env": [{ "key": "GREETING", "label": "问候语", "default": "Hello" }],
  "params": [{ "key": "TARGET", "label": "目标名称", "default": "Autoforge" }]
}
```

**Python 与 JavaScript 的 ctx 差异（重要）：**

| 能力 | JavaScript | Python |
|------|------------|--------|
| 会话 / 脚本 ID | `ctx.sessionId` / `ctx.scriptId` | `ctx.session_id` / `ctx.script_id` |
| 路径 | `ctx.sdk.paths.userData` / `scriptDir` | `ctx.sdk.paths.user_data` / `script_dir`（`pathlib.Path`） |
| 日志 | `ctx.log('INFO', msg)` | `ctx.log("INFO", msg)` |
| 阶段 / 进度 | `ctx.stage({ name, label })` | `ctx.stage(name="...", label="...")`（关键字参数） |
| 取消 | `ctx.signal.aborted` | `ctx.signal.aborted` |
| 浏览器 | `await ctx.sdk.browser.launch()` | 同左 |

`ctx.env` / `ctx.params` 在两种语言中均为 **字符串字典**；复合类型解析规则相同。

## env 与 params

| | **env** | **params** |
|---|---|---|
| 用途 | 固定环境配置 | 本次业务输入 |
| 平台 | 脚本详情 → **配置** Tab | 脚本详情 → **详情** Tab |
| 访问 | `ctx.env.KEY` / `ctx.env.get("KEY")` | `ctx.params.KEY` / `ctx.params.get("KEY")` |
| 持久化 | 按环境 | 按环境（paramsByEnv） |

- 缺 env → 错误信息提示「脚本详情 → **配置** Tab」
- 缺 params → 错误信息提示「脚本详情 → **详情** Tab」
- 所有 schema 默认值均为**字符串**（含 `default`）
- `ctx.env` / `ctx.params` 的值**始终是字符串**；复合类型需脚本内解析

### env / params 类型速查

| `type` | UI | 值形态 | 脚本内读取 |
|--------|-----|--------|-----------|
| `text`（默认） | 单行文本 | 字符串 | 直接用 |
| `textarea` | 多行文本 | 字符串 | 直接用 |
| `number` | 数字输入 | 数字字符串 | `Number(raw)` / `int(raw or 0)` |
| `select` / `radio` | 下拉 / 单选组 | 选项 `value` | 直接用 |
| `checkbox` | 多选组 | JSON 数组字符串 | `JSON.parse` / `json.loads` |
| `boolean` | 开关 | `"true"` / `"false"` | `raw === 'true'` |
| `attachment` | 文件多选 | JSON 数组字符串 | 见下文 |

`select` / `radio` / `checkbox` 须配 `options`（字符串简写 `["a","b"]` 或 `{ "label", "value" }`）。

合并优先级：`autoforge.json 默认值` → `该环境下上次保存值` → `本次运行传入（最高）`

## run(ctx) 约定

### JavaScript

```javascript
export async function run(ctx) {
  const { env, params, log, signal, sdk } = ctx

  log('INFO', '开始执行')
  if (signal.aborted) throw new Error('已取消')

  return { ok: true }
}
```

### Python

```python
async def run(ctx):
    ctx.log("INFO", "开始执行")
    if ctx.signal.aborted:
        return None
    return {"ok": True}
```

### 日志

`ctx.log('INFO'|'WARN'|'ERROR', message)` → UI 日志面板（Python 同样三级）

### 阶段与进度

**JavaScript：**

```javascript
ctx.stage({ name: 'fetch', label: '拉取数据', message: '…' })
ctx.progress({ scope: 'task', current: 3, total: 10, label: '当前文件' })
ctx.progress({ scope: 'total', current: 450, total: 1000, unit: '条', label: '总进度' })
```

**Python：**

```python
ctx.stage(name="fetch", label="拉取数据", message="…")
ctx.progress(scope="task", current=3, total=10, label="当前文件")
ctx.progress(scope="total", current=450, total=1000, unit="条", label="总进度")
```

- `scope: 'task'` — 当前子任务（单文件、单页等）
- `scope: 'total'` — 整批总进度（跑数据、批处理）
- JS 也可 `ctx.log('INFO', '@autoforge/ctl ' + JSON.stringify({ kind: 'progress', ... }))`

终端面板、脚本卡片 meta、详情运行状态会实时展示 `runProgress`。

### 返回值与产物目录

- 返回值 → `session.result`；抛 `Error` / `raise` → `failed`
- UI 展示**最近一次成功运行**的返回值（对象/数组格式化为 JSON）
- 需要平台显示「**产物目录**」快捷入口时，返回**普通对象**，且含本机**绝对路径**字符串。字段优先级：

  `outputDir`（推荐）→ `outputPath` → `artifactDir` → `artifactsDir` → `exportDir` → `savedTo`

**JavaScript 示例：**

```javascript
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export async function run(ctx) {
  const outDir = join(
    ctx.sdk.paths.scriptDir,
    'output',
    new Date().toISOString().slice(0, 19).replace(/:/g, '-'),
  )
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'result.json'), JSON.stringify({ ok: true }))
  return { outputDir: outDir, files: ['result.json'] }
}
```

**Python 示例：**

```python
from pathlib import Path
from datetime import datetime
import json

async def run(ctx):
    stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    out_dir = ctx.sdk.paths.script_dir / "output" / stamp
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "result.json").write_text(json.dumps({"ok": True}), encoding="utf-8")
    return {"outputDir": str(out_dir.resolve()), "files": ["result.json"]}
```

也可通过 params 的 `OUTPUT_DIR` 让用户指定目录；仍须在返回值中回传实际写入路径。

### 取消

- JS：监听 `ctx.signal.aborted`；浏览器脚本 abort 时关闭 browser
- Python：检查 `ctx.signal.aborted`；子进程被终止时 signal 置位；浏览器脚本在 `finally` 中 `await browser.close()`

### 浏览器无头模式

在 `autoforge.json` 声明（或在脚本详情 → 概览切换）：

```json
{ "browser": { "headless": true } }
```

`ctx.sdk.browser.launch()` 会应用此设置（JS / Python 一致）。验证码 / 2FA 场景应设 `headless: false`。

**Python Playwright 参考**（`examples/playwright-py/index.py`）：

```python
browser = await ctx.sdk.browser.launch()
page = await browser.new_page()
try:
    await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    title = await page.title()
    return {"url": page.url, "title": title}
finally:
    await page.close()
    await browser.close()
```

### 脚本内解析 params

**checkbox / 多选（JS）：**

```javascript
function parseCheckbox(raw) {
  if (!raw?.trim()) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
```

**checkbox / 多选（Python）：**

```python
import json

def parse_checkbox(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return []
    try:
        value = json.loads(raw)
        return [x for x in value if isinstance(x, str)] if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []
```

**boolean：** `const dryRun = ctx.params.DRY_RUN === 'true'` / `dry_run = ctx.params.get("DRY_RUN") == "true"`

**number：** `const limit = Number(ctx.params.LIMIT) || 10` / `limit = int(ctx.params.get("LIMIT") or 10)`

**附件（`type: "attachment"`）：**

`ctx.params[key]` 为 **JSON 数组字符串**，每项含 `name`、`path`（绝对路径）、可选 `size`。平台复制文件到 `{userData}/script-inputs/{scriptId}/{paramKey}/`。

```python
def parse_attachments(raw: str | None) -> list[dict]:
    if not raw or not raw.strip():
        return []
    try:
        items = json.loads(raw)
        return [i for i in items if isinstance(i, dict) and i.get("path")] if isinstance(items, list) else []
    except json.JSONDecodeError:
        return []
```

本地 TS `run-local.mjs` 测试时：checkbox 传 `JSON.stringify(['a','b'])`；attachment 传 `JSON.stringify([{ name, path }])`；boolean 传 `'true'` / `'false'`。Python 脚本建议在平台导入后试运行。

## autoforge.json 模板

**JavaScript / 通用字段：**

```json
{
  "autoforge": "1.0",
  "name": "显示名称",
  "description": "脚本说明",
  "version": "1.0.0",
  "language": "javascript",
  "entry": "index.mjs",
  "category": "file",
  "categoryLabel": "文件",
  "env": [],
  "params": [
    {
      "key": "DRY_RUN",
      "label": "试运行",
      "type": "boolean",
      "default": "false"
    },
    {
      "key": "EXPORT_FORMAT",
      "label": "导出格式",
      "type": "select",
      "options": ["xlsx", "csv"],
      "default": "xlsx"
    },
    {
      "key": "MODULES",
      "label": "处理模块",
      "type": "checkbox",
      "options": [
        { "label": "订单", "value": "order" },
        { "label": "库存", "value": "stock" }
      ]
    }
  ],
  "dependencies": {},
  "browser": { "headless": false }
}
```

**Python 差异：**

```json
{
  "language": "python",
  "entry": "index.py",
  "dependencies": {
    "requests": ">=2.31.0",
    "playwright": ">=1.50.0"
  }
}
```

- TS 包：`"entry": "dist/index.js"`，`"language"` 可省略
- `language` 省略时按 `entry` 扩展名推断（`.py` → python，`.mjs`/`.js` → javascript）
- 敏感值：仅 `text` 类型支持 `"secret": true`
- 浏览器脚本按需加 `"browser": { "headless": true }`
- 有文件输出：实现返回值 `outputDir` + 可选 params `OUTPUT_DIR`
- 完整字段说明见 [reference.md](reference.md)

## 依赖管理

| 语言 | manifest `dependencies` | 全局依赖 | 安装位置 |
|------|-------------------------|----------|----------|
| JavaScript / TS | npm 包名 → 版本 | 设置 → 全局 npm 依赖 | `userData/runtime/node_modules` |
| Python | PyPI 包名 → specifier | 设置 → 全局 Python 依赖 | 脚本 `.venv` / `userData/runtime-python/.venv` |

Python 额外配置（**设置 → Python**）：

- **Python 路径** — 留空自动检测 3.9+
- **pip 镜像源** — 如清华源，加速 `.venv` 与全局依赖安装
- **运行超时（秒）** — JS 与 Python 共用

## 本地测试

**JavaScript / TypeScript：**

```bash
pnpm --filter @autoforge/<name> test:local
pnpm --filter @autoforge/<name> build
pnpm --filter @autoforge/<name> lint
```

`run-local.mjs` 构造完整 ctx（`sessionId`、`scriptId`、`env`、`params`、`signal`、`log`、`sdk`），参考 `packages/floorplan-export/scripts/run-local.mjs`。

**Python：**

- 在 Autoforge 中 **上传脚本包目录**（含 `autoforge.json` + `index.py`），填写配置 Tab / 详情 Tab 后运行
- 或从内置示例「添加到我的脚本」：`examples/hello-world-py/`、`examples/playwright-py/`
- 确保设置 → Python 已检测到解释器；首次运行会自动创建 `.venv` 并 `pip install`

## 导入平台

- **TS**：导入 `packages/<name>/dist/`（含 `autoforge.json` + 编译产物）
- **JS**：导入 `packages/<name>/`（含 `autoforge.json` + 入口）
- **Python**：导入 `packages/<name>/` 或 `examples/<name>/`（含 `autoforge.json` + `index.py`）
- **单文件**：上传 `.js` / `.mjs` / `.cjs` / `.py`，平台自动包装为脚本包

## 完成后汇报

1. 包路径、语言（JS / TS / Python）与入口文件
2. **配置 Tab** 的 env、**详情 Tab** 的 params（按 type 说明）
3. 若有产物落盘：说明 `outputDir` 默认规则与 params `OUTPUT_DIR`
4. 浏览器脚本：说明 `headless` 默认值与 `playwright` 依赖（Python）
5. 依赖：npm / pip 列表及是否需全局依赖
6. 本地测试命令（JS/TS）或平台导入路径（Python）
