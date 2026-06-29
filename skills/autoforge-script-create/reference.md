# Autoforge 脚本规范参考

来源：[docs/Autoforge脚本开发规范文档说明.md](../../../docs/Autoforge脚本开发规范文档说明.md)

## 脚本包结构

Autoforge 脚本是**目录包**，必须包含 `autoforge.json` 与入口文件；入口必须导出 `run` 函数。

```
my-script/
├── autoforge.json
└── index.mjs
```

## autoforge.json 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `autoforge` | string | ✅ | 规范版本，当前 `"1.0"` |
| `name` | string | ✅ | 显示名称 |
| `description` | string | | 描述 |
| `version` | string | | 语义化版本，默认 `1.0.0` |
| `entry` | string | | 入口文件，默认 `index.mjs` |
| `category` | string | | `browser` / `local` / `scrape` / `file` / `system` |
| `categoryLabel` | string | | 分类显示名 |
| `icon` | string | | UI 图标 |
| `env` | EnvVarDefinition[] | | 环境变量 schema |
| `params` | ParamDefinition[] | | 运行业务参数 schema |
| `dependencies` | Record<string,string> | | npm 依赖，运行前自动安装 |
| `browser` | `{ headless?: boolean }` | | 浏览器启动选项；`headless: true` 无头，默认 `false` |

### 浏览器无头模式

```json
{ "browser": { "headless": true } }
```

也可在脚本详情 → 概览切换。`ctx.sdk.browser.launch()` 应用此设置。验证码 / 2FA 场景设 `false`。

## 环境变量 vs 运行参数

**不要在脚本中混用。**

| | **env** | **params** |
|---|---|---|
| 用途 | 固定环境配置：账号、密码、API 地址、Token | 业务输入：订单号、日期、任务 ID、待处理文件 |
| 变化频率 | 按环境长期固定 | 每次运行可能不同 |
| 平台位置 | 脚本详情 → **配置** Tab | 脚本详情 → **详情** Tab |
| 脚本访问 | `ctx.env.KEY` | `ctx.params.KEY` |
| 持久化 | 按环境（configByEnv） | 上次值（savedParams，不区分环境） |

选用原则：

- 换环境才变 → `env`
- 每次任务/业务才变 → `params`
- 每次运行需上传的本地文件 → `params` 且 `type: "attachment"`

## env schema

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
    }
  ]
}
```

合并优先级：`autoforge.json 默认值` → `全局 Profile 共享变量` → `脚本专属配置（最高）`

## params schema

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | string | 参数名，`ctx.params[key]` |
| `label` | string | UI 标签 |
| `description` | string | 说明 |
| `required` | boolean | 是否必填 |
| `secret` | boolean | 敏感值（仅 `text` 有效） |
| `type` | 见下 | 默认 `text` |
| `options` | `(string \| {label,value})[]` | `select`/`radio`/`checkbox` 候选项 |
| `default` | string | 见下表 |

**`type` 取值：** `text`（单行）、`textarea`（多行）、`number`（数字）、`select`（下拉单选）、`radio`（单选组）、`checkbox`（多选组，值为 JSON 数组字符串，默认 `[]`）、`boolean`（开关，值 `"true"`/`"false"`，默认 `"false"`）、`attachment`（文件，JSON 数组字符串，默认 `[]`）。`select`/`radio`/`checkbox` 需配 `options`。

合并优先级：`autoforge.json 默认值` → `上次保存值` → `本次运行传入（最高）`

定时任务、卡片快捷启动使用上次保存的参数；必填未填则失败并提示在「详情」Tab 补全。

### 附件类型（`type: "attachment"`）

| | **`text`（默认）** | **`attachment`** |
|---|---|---|
| UI | 单行文本 | 文件多选 + 附件列表 |
| `ctx.params[key]` | 普通字符串 | **JSON 数组字符串** |
| 必填校验 | 字符串非空 | 至少 1 个有效附件 |
| `secret` | 支持 | 不适用 |

存储：平台复制到 `{userData}/script-inputs/{scriptId}/{paramKey}/`，同名自动重命名。

```typescript
interface ParamAttachmentItem {
  name: string   // 缓存目录中的文件名
  path: string   // 绝对路径，可直接 fs.readFile
  size?: number
}
```

平台运行前校验附件路径是否存在；取消或移除附件时会清理不再引用的缓存。

## 平台配置

### 配置 Tab（env）

1. 选择运行环境（开发/测试/生产）
2. 填写账号、密码、URL 等固定环境配置
3. 保存配置 — 每个脚本、每个环境独立

### 详情 Tab（params）

1. 选择运行环境（决定使用哪套 env）
2. 填写运行参数：文本直接输入；附件「选择文件」多选上传
3. 点击「运行」— 上次值自动保存，不区分环境

## run(ctx) 上下文

```typescript
interface ScriptRunContext {
  sessionId: string
  scriptId: string
  env: Record<string, string>
  params: Record<string, string> // attachment 为 JSON 数组字符串
  signal: AbortSignal
  log: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void
  sdk: {
    browser: { launch: () => Promise<Browser> }
    paths: { userData: string; scriptDir: string }
  }
}
```

### 日志 / 返回值 / 取消

- `ctx.log('INFO'|'WARN'|'ERROR', message)` → UI 日志面板
- 返回值 → `session.result`；抛 Error → failed
- UI 展示最近一次**成功**运行的返回值
- 监听 `ctx.signal.aborted`；浏览器脚本 abort 时关闭 browser

### 返回值展示格式

| 返回值类型 | UI 展示 |
|-----------|---------|
| 对象、数组 | JSON（缩进 2 空格） |
| 字符串 | 原样文本 |
| `null` / `undefined` | 不显示「运行结果」 |

### 产物目录字段

返回**普通对象**且含本机绝对路径字符串时，UI 显示「产物目录」快捷入口。字段优先级：

1. `outputDir`（推荐）
2. `outputPath`
3. `artifactDir`
4. `artifactsDir`
5. `exportDir`
6. `savedTo`

不显示的情况：无返回值、非对象、字段为空、最近一次运行失败。

## 依赖管理

- **脚本级**：`autoforge.json` 的 `dependencies`，首次运行前 `npm install`
- **全局**：设置 → 全局 npm 依赖 → `userData/runtime/node_modules`

## 上传方式

1. **脚本包目录**：含 `autoforge.json` 的文件夹
2. **单文件**：`.js` / `.mjs` / `.cjs`，平台自动包装

## 本仓库示例（packages/）

| 包 | 类型 | 说明 |
|---|---|---|
| `packages/crowdsourcing-token/` | JS | 浏览器自动化 + env + dependencies |
| `packages/ai-news-fetch/` | JS | 数据采集 + env + params + 产物落盘 |
| `packages/floorplan-export/` | TS | 文件导出 + env + params + 本地测试 |
| `packages/resume-screening/` | TS | 附件 + LLM + outputDir + HTML 报告 |
| `packages/model-preview/` | TS | 浏览器预览 + params |
