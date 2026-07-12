# 脚本包规范（autoforge.json）

> 当前应用版本：**1.15.0** · 脚本清单规范：`autoforge` **1.0** · 详见 [v1.15.0 版本说明](./v1.15.0.md)

## 概述

Autoforge 脚本是一个**目录包**，必须包含 `autoforge.json` 清单和入口文件。入口文件必须导出 `run` 函数。

## 最小示例

```
my-script/
├── autoforge.json
├── README.md          ← 可选，脚本使用说明
└── index.mjs
```

**autoforge.json**

```json
{
  "autoforge": "1.0",
  "name": "我的脚本",
  "description": "脚本说明",
  "version": "1.0.0",
  "entry": "index.mjs"
}
```

**index.mjs**

```javascript
export async function run(ctx) {
  ctx.log('INFO', '开始执行')
  return { ok: true }
}
```

## README 说明文档

脚本包根目录可放置可选的 **`README.md`**（大小写须精确匹配），用于书写较完整的使用说明、步骤与截图。

| 项 | 约定 |
|----|------|
| 文件 | 包根 `README.md`（可选） |
| 平台入口 | 脚本详情 → **说明** Tab（始终显示；无文件时提示「暂无说明文档」） |
| 与 `description` | **不替代** `autoforge.json` 的 `description`（短描述仍用于卡片/列表） |
| 语法 | Markdown；平台以完整渲染器展示 |
| 图片 | 相对路径相对**包根**（如 `./docs/shot.png`），须随包分发；缺失不阻断正文 |
| 外链 | `http(s)` 链接可点击，使用系统浏览器打开 |
| zip / Hub | 若有 README，须与 `autoforge.json` 位于同一包根一并打入 zip |

示例：

````markdown
# 我的脚本

## 使用前准备

1. 在「配置」中填写 `API_URL`
2. 在「运行参数」中填入订单号

![界面示意](./docs/ui.png)
````

> 说明：`readme.md` / 子目录 README / 在清单中声明路径 — 本期均不支持。

## 以 zip 分发（Hub / 远程安装）

Autoforge Hub「添加到本地」等场景使用 **zip** 传递脚本包。解压后须能定位到含 `autoforge.json` 的包根：

| 布局 | 是否支持 |
|------|----------|
| zip 根目录直接含 `autoforge.json` + 入口文件 | ✅ |
| zip 内仅一层目录，该目录含 `autoforge.json` | ✅ |
| 多顶层目录、或缺少 `autoforge.json` | ❌ |

不要把 `node_modules/`、`.venv/` 打进分发 zip；依赖由本机按清单安装。

本机桥契约（端口、`/install` body）见 [Hub 安装 · 桌面端规格](./superpowers/specs/2026-07-11-hub-local-install-design.md)。

## autoforge.json 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `autoforge` | string | ✅ | 规范版本，当前 `"1.0"` |
| `name` | string | ✅ | 显示名称 |
| `description` | string | | 描述 |
| `version` | string | | 语义化版本，默认 `1.0.0` |
| `entry` | string | | 入口文件，默认 `index.mjs` |
| `language` | string | | 脚本语言：`javascript`（默认）或 `python`；省略时按 entry 扩展名推断 |
| `category` | string | | 分类 key：`browser` / `local` / `scrape` / `file` / `system` |
| `categoryLabel` | string | | 分类显示名 |
| `icon` | string | | UI 图标 |
| `env` | EnvVarDefinition[] | | 环境变量 schema（固定环境配置） |
| `params` | ParamDefinition[] | | 运行业务参数 schema（每次运行可不同） |
| `dependencies` | Record<string,string> | | 依赖：JS 脚本为 npm 包；Python 脚本为 pip 包（运行前自动安装至脚本 `.venv`） |
| `browser` | `{ headless?: boolean }` | | 浏览器启动选项；`headless: true` 为无头模式，默认 `false` |

### 浏览器无头模式

在 `autoforge.json` 中声明，或在脚本详情 → 概览中切换：

```json
{
  "browser": { "headless": true }
}
```

脚本调用 `ctx.sdk.browser.launch()` 时会应用此设置。需要人工验证码或 2FA 的场景应设为 `false`。

## 环境变量 vs 运行参数

Autoforge 将脚本输入分为两个维度，**不要在脚本中混用**：

| | **环境变量 `env`** | **运行参数 `params`** |
|---|---|---|
| **用途** | 固定环境配置：账号、密码、API 地址、Token 等 | 业务处理输入：订单号、日期范围、任务 ID 等 |
| **变化频率** | 按环境（开发/测试/生产）长期固定 | 每次运行可能不同 |
| **声明字段** | `env` | `params` |
| **平台配置位置** | 脚本详情 → **配置** Tab | 脚本详情 → **详情** Tab（运行前填写） |
| **脚本内访问** | `ctx.env.KEY` | `ctx.params.KEY` |
| **持久化** | 按环境保存（`configByEnv`） | 按环境保存（`paramsByEnv`） |

**选用原则：**

- 换环境才变的值 → 放 `env`（例如测试服/生产服 URL、各环境账号）
- 每次任务/业务才变的值 → 放 `params`（例如本次要处理的单号、导出日期）
- 每次运行需上传的本地文件 → 放 `params` 并设置 `type: "attachment"`（例如待导入的 Excel、本次处理的图片）

## 环境变量 schema

每个环境变量项（`EnvVarDefinition`）支持以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | string | 变量名，脚本内通过 `ctx.env[key]` 访问 |
| `label` | string | UI 展示标签 |
| `description` | string | 说明文字 |
| `required` | boolean | 是否必填 |
| `secret` | boolean | 敏感值（仅 `text` 类型有效，UI 掩码显示） |
| `type` | 见下表 | 值类型，默认 `text` |
| `options` | `(string \| {label,value})[]` | `select` / `radio` / `checkbox` 的候选项 |
| `default` | string | 默认值（见各类型说明） |

**支持的 `type`（与 `params` 一致）：**

| `type` | UI 控件 | `ctx.env[key]` 的值 | 备注 |
|--------|---------|----------------------|------|
| `text`（默认） | 单行文本框 | 普通字符串 | 支持 `secret` 掩码 |
| `textarea` | 多行文本框 | 普通字符串 | |
| `number` | 数字输入框 | 数字字符串 | 脚本内用 `Number()` 转换 |
| `select` | 下拉单选 | 选项 `value` 字符串 | 需 `options` |
| `radio` | 单选按钮组 | 选项 `value` 字符串 | 需 `options` |
| `checkbox` | 多选框组 | **JSON 数组字符串** | 需 `options`，默认 `[]` |
| `boolean` | 开关 | `"true"` / `"false"` | 默认 `"false"` |
| `attachment` | 文件上传 + 附件列表 | **JSON 数组字符串** | 默认 `[]`；按环境分别缓存 |

```json
{
  "env": [
    {
      "key": "API_URL",
      "label": "API 地址",
      "description": "后端服务根 URL",
      "required": true,
      "secret": false,
      "default": "https://api.example.com"
    },
    {
      "key": "API_TOKEN",
      "label": "访问令牌",
      "required": true,
      "secret": true
    },
    {
      "key": "USE_MOCK",
      "label": "使用 Mock 服务",
      "type": "boolean",
      "default": "false"
    },
    {
      "key": "DEPLOY_ENV",
      "label": "部署环境",
      "type": "select",
      "options": ["dev", "staging", "prod"],
      "default": "dev"
    }
  ]
}
```

实际值在 **脚本详情 → 配置 Tab** 中按环境填写，保存在本机，不会写入脚本包。

合并优先级：`autoforge.json 默认值` → `全局 Profile 共享变量（可选）` → `脚本专属配置（最高）`

## 运行参数 schema

每个参数项（`ParamDefinition`）支持以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | string | 参数名，脚本内通过 `ctx.params[key]` 访问 |
| `label` | string | UI 展示标签 |
| `description` | string | 说明文字 |
| `required` | boolean | 是否必填 |
| `secret` | boolean | 敏感值（仅 `text` 类型有效，UI 掩码显示） |
| `type` | 见下表 | 参数类型，默认 `text` |
| `options` | `(string \| {label,value})[]` | `select` / `radio` / `checkbox` 的候选项 |
| `default` | string | 默认值（见各类型说明） |

**支持的 `type`：**

| `type` | UI 控件 | `ctx.params[key]` 的值 | 备注 |
|--------|---------|------------------------|------|
| `text`（默认） | 单行文本框 | 普通字符串 | 支持 `secret` 掩码 |
| `textarea` | 多行文本框 | 普通字符串 | |
| `number` | 数字输入框 | 数字字符串 | 脚本内用 `Number()` 转换 |
| `select` | 下拉单选 | 选项 `value` 字符串 | 需 `options` |
| `radio` | 单选按钮组 | 选项 `value` 字符串 | 需 `options` |
| `checkbox` | 多选框组 | **JSON 数组字符串** | 需 `options`，默认 `[]` |
| `boolean` | 开关 | `"true"` / `"false"` | 默认 `"false"` |
| `attachment` | 文件上传 + 附件列表 | **JSON 数组字符串** | 默认 `[]` |

```json
{
  "params": [
    {
      "key": "ORDER_ID",
      "label": "订单号",
      "description": "本次要处理的业务单号",
      "required": true
    },
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
      "options": ["xlsx", "csv", "pdf"],
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
    },
    {
      "key": "SOURCE_FILES",
      "label": "待处理文件",
      "description": "本次要导入的 Excel / CSV",
      "type": "attachment",
      "required": true
    }
  ]
}
```

实际值在 **脚本详情 → 运行参数 Tab** 中运行前填写。点击「运行」后，平台会校验必填项并将参数传入脚本；**上次填写的值会按当前运行环境自动保存**，切换环境后加载该环境下已保存的参数。

合并优先级：`autoforge.json 默认值` → `该环境下上次保存值` → `本次运行传入（最高）`

> 定时任务、从脚本卡片快捷启动时，使用**默认运行环境**下上次保存的参数值。若必填参数未填写，运行会失败并提示在「运行参数」Tab 补全。

### 附件类型参数（`type: "attachment"`）

用于每次运行传入一个或多个本地文件（如 Excel、CSV、图片、PDF 等）。UI 提供多选文件上传，适合「本次要处理的文件列表」这类业务输入。

**与 `text` 类型的区别：**

| | **`text`（默认）** | **`attachment`** |
|---|---|---|
| UI 控件 | 单行文本输入框 | 文件选择 + 附件列表 |
| `ctx.params[key]` 的值 | 普通字符串 | **JSON 数组字符串** |
| 必填校验 | 字符串非空 | 至少包含 1 个有效附件 |
| `secret` | 支持 | 不适用 |

**存储与传递：**

1. 用户在运行参数 Tab 选择文件后，平台会将文件**复制**到本机缓存目录：
   `{userData}/script-inputs/{scriptId}/params/{envId}/{paramKey}/`（按运行环境隔离）
2. 同名文件会自动重命名（如 `data (1).xlsx`）
3. 参数值序列化为 JSON 字符串传入脚本，每项结构如下：

```typescript
interface ParamAttachmentItem {
  name: string   // 文件名（缓存目录中的名称）
  path: string   // 绝对路径，脚本可直接 fs.readFile / 打开
  size?: number  // 字节大小（可选）
}
```

**示例值（`ctx.params.SOURCE_FILES`）：**

```json
[
  { "name": "orders.xlsx", "path": "C:\\Users\\...\\script-inputs\\abc123\\SOURCE_FILES\\orders.xlsx", "size": 20480 },
  { "name": "extra.csv", "path": "C:\\Users\\...\\script-inputs\\abc123\\SOURCE_FILES\\extra.csv", "size": 1024 }
]
```

**脚本内解析：**

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

export async function run(ctx) {
  const files = parseAttachments(ctx.params.SOURCE_FILES)
  if (!files.length) {
    throw new Error('请上传待处理文件')
  }

  for (const file of files) {
    ctx.log('INFO', `处理文件: ${file.name} (${file.path})`)
    // 使用 fs.readFile(file.path) 或 playwright 等读取
  }

  return { processed: files.length }
}
```

> 平台运行前会校验附件路径是否仍然存在；若缓存文件被手动删除，会提示重新上传。取消编辑或移除附件时，平台会清理不再引用的缓存文件。

## 在平台上配置

### 环境变量（配置 Tab）

1. 导入脚本后，打开脚本详情 → **配置** Tab
2. 选择运行环境（开发 / 测试 / 生产）
3. 填写账号、密码、URL 等**固定环境配置**（支持文本、下拉、开关、附件等多种类型）
4. 点击「保存配置」

每个脚本、每个环境的 env 配置相互独立。

### 运行参数（运行参数 Tab）

1. 打开脚本详情 → **详情** Tab 选择运行环境（决定使用哪套 env 与 params）
2. 在 **运行参数** Tab 填写本次业务的参数值
   - **文本参数**：直接输入字符串
   - **附件参数**：点击「选择文件」可多选上传；已添加的附件可单独移除
3. 点击「运行」或「重启」— 参数按当前环境分别保存，切换环境后自动加载该环境下已保存的值

运行参数与 env 均随环境 Profile 切换而变化。附件文件保存在本机 `userData/script-inputs/` 下，不会写入脚本包。

## run(ctx) 上下文

```typescript
interface ScriptRunContext {
  sessionId: string
  scriptId: string
  env: Record<string, string>     // 合并后的环境变量（固定环境配置；attachment/checkbox 等为 JSON 字符串）
  params: Record<string, string> // 本次运行的业务参数（attachment 类型为 JSON 数组字符串）
  signal: AbortSignal            // 用户停止时 abort
  log: (level, message) => void
  stage: (input) => void         // 报告脚本自定义阶段
  progress: (input) => void      // 报告 task/total 进度
  sdk: {
    browser: { launch: () => Promise<Browser> }
    paths: { userData: string; scriptDir: string }
  }
}
```

### 使用示例

**文本参数：**

```javascript
export async function run(ctx) {
  const baseUrl = ctx.env.API_URL
  const token = ctx.env.API_TOKEN
  const orderId = ctx.params.ORDER_ID

  if (!orderId) {
    throw new Error('缺少订单号')
  }

  ctx.log('INFO', `处理订单 ${orderId} @ ${baseUrl}`)
  // ...
  return { orderId, ok: true }
}
```

**附件参数：**

```javascript
import { readFileSync } from 'fs'

export async function run(ctx) {
  const raw = ctx.params.SOURCE_FILES
  const files = JSON.parse(raw || '[]')

  for (const { name, path } of files) {
    const buf = readFileSync(path)
    ctx.log('INFO', `读取 ${name}，${buf.length} 字节`)
  }

  return { count: files.length }
}
```

### 日志约定

- 使用 `ctx.log('INFO'|'WARN'|'ERROR', message)` 输出
- 日志会实时推送到 UI 日志面板

### 阶段与进度（stage / progress）

平台生命周期（排队、校验、安装依赖、运行中等）由 Autoforge 自动管理。脚本在 **`running`** 阶段可通过 `ctx.stage` / `ctx.progress` 上报**自定义阶段**与**进度**，供终端面板、脚本卡片与详情页展示。

#### 推荐 API

```javascript
export async function run(ctx) {
  ctx.stage({ name: 'load', label: '加载数据', message: '读取输入文件…' })
  ctx.progress({ scope: 'total', current: 0, total: 1000, unit: '条', label: '总进度' })

  for (let i = 1; i <= 1000; i += 1) {
    // …处理单条…
    ctx.progress({
      scope: 'task',
      current: 1,
      total: 1,
      label: '当前记录',
      message: `第 ${i} 条`
    })
    ctx.progress({ scope: 'total', current: i, total: 1000, unit: '条' })
  }

  return { ok: true, processed: 1000 }
}
```

| API | 说明 |
|-----|------|
| `ctx.stage({ name, label?, message? })` | 报告当前执行阶段；`name` 为机器 ID，`label` 为 UI 展示名 |
| `ctx.progress({ scope, current, total?, label?, message?, unit? })` | 报告进度；`scope` 见下表 |

**`scope` 含义：**

| `scope` | 用途 | 示例 |
|---------|------|------|
| `task` | **单任务 / 当前子步骤**进度 | 当前文件 3/10、当前页 5/20 |
| `total` | **整批 / 总任务**进度 | 已处理 450/1000 条、总文件 12/50 |

- `current` 必填，从 `0` 起计
- `total` 可选；省略时表示**不确定进度**（UI 只显示 current，不显示百分比）
- `unit` 可选，如 `条`、`文件`、`页`

#### 控制行格式（兼容 `ctx.log`）

也可直接输出控制行（单行 JSON）：

```
@autoforge/ctl {"kind":"stage","name":"import","label":"导入","message":"读取 Excel…"}
@autoforge/ctl {"kind":"progress","scope":"total","current":450,"total":1000,"unit":"条"}
```

前缀常量：`SCRIPT_CONTROL_PREFIX = '@autoforge/ctl '`（见 `src/shared/script-progress.ts`）。

平台解析后会：
1. 更新 session 的 `runProgress`（终端进度条、脚本卡片 meta、详情运行状态）
2. 在日志中写入可读行，如 `[阶段] 导入 — 读取 Excel…`、`[进度·总计] 总进度 · 450/1000 条 (45%)`

#### 与平台 lifecycle 的区别

| | **平台 lifecycle** | **脚本 stage/progress** |
|---|---|---|
| 来源 | Autoforge 运行时 | 脚本 `ctx.stage` / `ctx.progress` |
| 字段 | `session.phase` | `session.runProgress` |
| 示例 | `validating`、`installing-deps`、`running` | `导入数据`、`总进度 450/1000` |

### 返回值

- `run` 的返回值会写入 `session.result`，并在详情 **运行参数** Tab 的「运行结果」区域展示
- 抛出 `Error` 则标记为 `failed`，不会更新成功运行的结果
- UI 展示的是该脚本**最近一次成功运行**的返回值（按 `finishedAt` 取最新一条 `status === 'success'` 的 session）

#### 展示格式

| 返回值类型 | UI 展示方式 |
|-----------|------------|
| 对象、数组 | 格式化为 JSON（缩进 2 空格） |
| 字符串 | 原样文本 |
| `null` / `undefined` | 不显示「运行结果」区块 |

#### 产物目录

若希望 UI 显示「产物目录」快捷入口（含路径与「打开」按钮），请在返回值对象中提供**本机绝对路径**字符串。Autoforge 按下列字段名**优先级**读取，取第一个非空字符串：

1. `outputDir`（推荐）
2. `outputPath`
3. `artifactDir`
4. `artifactsDir`
5. `exportDir`
6. `savedTo`

**显示条件：**

- 返回值必须是**普通对象**（不能是数组、字符串、数字等）
- 对应字段值为非空字符串（空白字符串视为无效）
- 仅**成功**运行的 session 参与；失败或停止的运行不会触发

**示例：**

```javascript
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export async function run(ctx) {
  const outDir = join(ctx.sdk.paths.scriptDir, 'output', new Date().toISOString().slice(0, 19).replace(/:/g, '-'))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'result.json'), JSON.stringify({ ok: true }))

  ctx.log('INFO', `已写入 ${outDir}`)

  return {
    outputDir: outDir,
    files: ['result.json']
  }
}
```

上例中 `outputDir` 会出现在「产物目录」区域；完整返回值（含 `files` 等字段）仍会在下方 JSON 区域展示。

**不会显示产物目录的情况：**

- `run()` 无返回值，或返回字符串 / 数组 / 原始值
- 返回对象中未包含上述字段，或路径为空字符串
- 最近一次运行失败（即使更早的成功记录仍保留，UI 仍展示那次成功的 result）

### 取消

- 监听 `ctx.signal.aborted` 或在 async 操作中检查
- 浏览器脚本应在 abort 时关闭 browser

## 依赖管理

### 脚本级依赖

在 `autoforge.json` 中声明：

```json
{
  "dependencies": {
    "playwright-core": "^1.50.1",
    "axios": "^1.7.0"
  }
}
```

首次运行前 Autoforge 会在脚本目录执行 `npm install`。

### 全局依赖

在 **设置 → 全局 npm 依赖** 中安装，存入 `userData/runtime/node_modules`，所有脚本共享。

Python 脚本的全局 pip 依赖在 **设置 → Python → 全局 Python 依赖** 中管理，存入 `userData/runtime-python/.venv`，通过 `PYTHONPATH` 对所有 Python 脚本可见。

### pip 镜像与运行超时

在 **设置 → Python** 中可配置：

| 配置项 | 说明 |
|---|---|
| pip 镜像源 | 如 `https://pypi.tuna.tsinghua.edu.cn/simple`，用于脚本 `.venv` 与全局 Python 依赖安装 |
| 运行超时（秒） | JS 与 Python 共用；`0` 表示不限制，超时后自动停止脚本 |

## Python 脚本

Python 脚本与 JavaScript 脚本使用相同的 `autoforge.json` 清单与 `run(ctx)` 契约，在**独立子进程**中运行（需本机 Python 3.9+，可在 **设置 → Python** 配置路径）。

**autoforge.json**

```json
{
  "autoforge": "1.0",
  "name": "我的 Python 脚本",
  "language": "python",
  "entry": "index.py",
  "dependencies": {
    "requests": ">=2.31.0"
  }
}
```

**index.py**

```python
async def run(ctx):
    ctx.log("INFO", "开始执行")
    value = ctx.params.get("KEY", "")
    return {"ok": True, "value": value}
```

| 项 | 说明 |
|---|---|
| `ctx.env` / `ctx.params` | 与 JS 相同，均为字符串字典 |
| `ctx.log` / `ctx.stage` / `ctx.progress` | 与 JS 相同语义 |
| `ctx.sdk.paths` | `user_data`、`script_dir` 路径 |
| `ctx.sdk.browser` | `await ctx.sdk.browser.launch()`，需 `dependencies` 含 `playwright`；启动参数与 JS 侧一致 |
| `dependencies` | pip 安装至脚本目录 `.venv`；也可在设置页安装全局 Python 依赖 |

## 平台数据目录

脚本通过 `ctx.sdk.paths.userData` / `user_data` 访问平台根目录（Windows `%APPDATA%/` 下）：

| 启动方式 | 目录 |
|----------|------|
| `npm run dev` | `autoforge-development/` |
| 安装包 / `preview` / `build` | `autoforge-production/` |

脚本包与依赖位于 `{userData}/scripts/{scriptId}/`。v1.10.0 起开发模式与正式安装包数据完全隔离，详见 [v1.10.0 版本说明](./v1.10.0.md)。

## 上传方式

1. **脚本包目录**：包含 `autoforge.json` 的文件夹
2. **单文件**：`.js` / `.mjs` / `.cjs` / `.py`，会自动包装为脚本包

## 示例

- `examples/hello-world/` — JS 最小示例，含 `env` 与 `params` 区分演示
- `examples/hello-world-py/` — Python 最小示例
- `examples/playwright-py/` — Python Playwright 浏览器自动化示例
