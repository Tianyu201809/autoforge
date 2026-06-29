---
name: autoforge-script-create
description: 在 AutoforgeScripts monorepo 的 packages/ 下新建 Autoforge 脚本包（autoforge.json + run(ctx)），含 env/params schema（text、textarea、number、select、radio、checkbox、boolean、attachment）。Use when the user invokes /autoforge-script-create, asks to create a new Autoforge script, scaffold a script package, add params with select/checkbox, or add a package under packages/.
disable-model-invocation: true
---

# Autoforge 脚本创建（/autoforge-script-create）

在 `packages/` 下新建符合 Autoforge 规范的脚本包。权威规范见 [docs/Autoforge脚本开发规范文档说明.md](../../../docs/Autoforge脚本开发规范文档说明.md)；字段与 schema 速查见 [reference.md](reference.md)。

## 前置确认

向用户确认（可从对话推断则跳过）：

1. **脚本名**（kebab-case 目录名，如 `order-export`）
2. **用途与分类**：`browser` / `local` / `scrape` / `file` / `system`
3. **实现方式**：纯 JS（简单）或 TypeScript（复杂逻辑）
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
6. **浏览器脚本**是否需要无头模式（`browser.headless`，见下文）
7. **npm 依赖**（如有）
8. **是否落盘产物**（若需要 UI「产物目录」快捷入口，返回值须含 `outputDir` 等字段）

## 创建流程

```
Task Progress:
- [ ] 选定 JS 或 TS 模板
- [ ] 创建 packages/<name>/ 与 autoforge.json
- [ ] 声明 env / params（含 type、options、browser 如需要）
- [ ] 实现 export async function run(ctx)
- [ ] 有文件输出时返回 outputDir（本机绝对路径）
- [ ] （TS）配置 package.json / tsconfig / 构建脚本
- [ ] 本地 test:local 或手动验证
- [ ] pnpm build && pnpm lint 通过
```

### 方式一：纯 JavaScript

参考 `packages/crowdsourcing-token/`、`packages/ai-news-fetch/`：

```
packages/<name>/
├── autoforge.json
└── index.mjs
```

- `"entry": "index.mjs"`
- 入口 `export async function run(ctx) { ... }`
- 浏览器脚本：`ctx.sdk.browser.launch()`；abort 时关闭 browser

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

## env 与 params

| | **env** | **params** |
|---|---|---|
| 用途 | 固定环境配置 | 本次业务输入 |
| 平台 | 脚本详情 → **配置** Tab | 脚本详情 → **详情** Tab |
| 访问 | `ctx.env.KEY` | `ctx.params.KEY` |
| 持久化 | 按环境 | 上次值（不区分环境） |

- 缺 env → 错误信息提示「脚本详情 → **配置** Tab」
- 缺 params → 错误信息提示「脚本详情 → **详情** Tab」
- 所有 schema 默认值均为**字符串**（含 `default`）
- `ctx.params` 的值**始终是字符串**；复合类型需脚本内解析

### params 类型速查

| `type` | UI | `ctx.params[key]` | 脚本内读取 |
|--------|-----|-------------------|-----------|
| `text`（默认） | 单行文本 | 字符串 | 直接用 |
| `textarea` | 多行文本 | 字符串 | 直接用 |
| `number` | 数字输入 | 数字字符串 | `Number(raw)` |
| `select` / `radio` | 下拉 / 单选组 | 选项 `value` | 直接用 |
| `checkbox` | 多选组 | JSON 数组字符串 | `JSON.parse(raw)` |
| `boolean` | 开关 | `"true"` / `"false"` | `raw === 'true'` |
| `attachment` | 文件多选 | JSON 数组字符串 | 见下文 |

`select` / `radio` / `checkbox` 须配 `options`（字符串简写 `["a","b"]` 或 `{ "label", "value" }`）。

合并优先级：`autoforge.json 默认值` → `上次保存值` → `本次运行传入（最高）`

## run(ctx) 约定

```javascript
export async function run(ctx) {
  const { env, params, log, signal, sdk } = ctx

  log('INFO', '开始执行')
  if (signal.aborted) throw new Error('已取消')

  return { ok: true }
}
```

### 日志

`ctx.log('INFO'|'WARN'|'ERROR', message)` → UI 日志面板

### 返回值与产物目录

- 返回值 → `session.result`；抛 `Error` → `failed`
- UI 展示**最近一次成功运行**的返回值（对象/数组格式化为 JSON）
- 需要平台显示「**产物目录**」快捷入口（含「打开」按钮）时，返回**普通对象**，且含本机**绝对路径**字符串。字段优先级：

  `outputDir`（推荐）→ `outputPath` → `artifactDir` → `artifactsDir` → `exportDir` → `savedTo`

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

也可通过 params 的 `OUTPUT_DIR` 让用户指定目录；仍须在返回值中回传实际写入路径。

### 取消

监听 `ctx.signal.aborted`；浏览器脚本 abort 时关闭 browser。

### 浏览器无头模式

在 `autoforge.json` 声明（或在脚本详情 → 概览切换）：

```json
{ "browser": { "headless": true } }
```

`ctx.sdk.browser.launch()` 会应用此设置。验证码 / 2FA 场景应设 `headless: false`。

### 脚本内解析 params

**checkbox / 多选：**

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

**boolean：**

```javascript
const dryRun = ctx.params.DRY_RUN === 'true'
```

**number：**

```javascript
const limit = Number(ctx.params.LIMIT) || 10
```

**附件（`type: "attachment"`）：**

`ctx.params[key]` 为 **JSON 数组字符串**，每项含 `name`、`path`（绝对路径）、可选 `size`。平台复制文件到 `{userData}/script-inputs/{scriptId}/{paramKey}/`。

```javascript
function parseAttachments(raw) {
  if (!raw?.trim()) return []
  try {
    const items = JSON.parse(raw)
    return Array.isArray(items) ? items.filter((i) => i?.path) : []
  } catch {
    return []
  }
}
```

本地 `run-local.mjs` 测试时：checkbox 传 `JSON.stringify(['a','b'])`；attachment 传 `JSON.stringify([{ name, path }])`；boolean 传 `'true'` / `'false'`。

## autoforge.json 模板

```json
{
  "autoforge": "1.0",
  "name": "显示名称",
  "description": "脚本说明",
  "version": "1.0.0",
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

- TS 包：`"entry": "dist/index.js"`
- 敏感值：仅 `text` 类型支持 `"secret": true`
- 浏览器脚本按需加 `"browser": { "headless": true }`
- 有文件输出：实现返回值 `outputDir` + 可选 params `OUTPUT_DIR`
- 完整字段说明见 [reference.md](reference.md)

## 本地测试

```bash
pnpm --filter @autoforge/<name> test:local
pnpm --filter @autoforge/<name> build
pnpm --filter @autoforge/<name> lint
```

`run-local.mjs` 构造完整 ctx（`sessionId`、`scriptId`、`env`、`params`、`signal`、`log`、`sdk`），参考 `packages/floorplan-export/scripts/run-local.mjs`。

## 导入平台

- **TS**：导入 `packages/<name>/dist/`（含 `autoforge.json` + 编译产物）
- **JS**：导入 `packages/<name>/`（含 `autoforge.json` + 入口）
- 也可上传单文件 `.js` / `.mjs` / `.cjs`，平台自动包装

## 完成后汇报

1. 包路径与入口文件
2. **配置 Tab** 的 env、**详情 Tab** 的 params（按 type 说明：text/textarea/number/select/radio/checkbox/boolean/attachment）
3. 若有产物落盘：说明 `outputDir` 默认规则与 params `OUTPUT_DIR`
4. 浏览器脚本：说明 `headless` 默认值
5. 本地测试命令与导入目录
