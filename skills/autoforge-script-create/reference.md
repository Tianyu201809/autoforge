# Autoforge 脚本规范参考

来源：[docs/script-spec.md](../../docs/script-spec.md)

## 脚本包结构

Autoforge 脚本是**目录包**，必须包含 `autoforge.json` 与入口文件；入口必须导出 `run` 函数。

**JavaScript：**

```
my-script/
├── autoforge.json
└── index.mjs
```

**Python：**

```
my-script/
├── autoforge.json    # "language": "python", "entry": "index.py"
└── index.py
```

## autoforge.json 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `autoforge` | string | ✅ | 规范版本，当前 `"1.0"` |
| `name` | string | ✅ | 显示名称 |
| `description` | string | | 描述 |
| `version` | string | | 语义化版本，默认 `1.0.0` |
| `entry` | string | | 入口文件；JS 默认 `index.mjs`，Python 常用 `index.py` |
| `language` | string | | `javascript`（默认）或 `python`；省略时按 entry 扩展名推断 |
| `category` | string | | `browser` / `local` / `scrape` / `file` / `system` |
| `categoryLabel` | string | | 分类显示名 |
| `icon` | string | | UI 图标 |
| `env` | EnvVarDefinition[] | | 环境变量 schema |
| `params` | ParamDefinition[] | | 运行业务参数 schema |
| `dependencies` | Record<string,string> | | JS：npm 依赖；Python：pip 依赖（安装至 `.venv`） |
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
| JS 访问 | `ctx.env.KEY` | `ctx.params.KEY` |
| Python 访问 | `ctx.env.get("KEY")` | `ctx.params.get("KEY")` |
| 持久化 | 按环境（configByEnv） | 按环境（paramsByEnv） |

选用原则：

- 换环境才变 → `env`
- 每次任务/业务才变 → `params`
- 每次运行需上传的本地文件 → `params` 且 `type: "attachment"`

## env / params schema

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | string | 变量名 |
| `label` | string | UI 标签 |
| `description` | string | 说明 |
| `required` | boolean | 是否必填 |
| `secret` | boolean | 敏感值（仅 `text` 有效） |
| `type` | 见下 | 默认 `text` |
| `options` | `(string \| {label,value})[]` | `select`/`radio`/`checkbox` 候选项 |
| `default` | string | 必须为字符串 |

**`type` 取值：** `text`、`textarea`、`number`、`select`、`radio`、`checkbox`、`boolean`、`attachment`。

- `checkbox` / `attachment`：值为 JSON 数组字符串
- `boolean`：值为 `"true"` / `"false"`

## run(ctx) 上下文

**JavaScript：**

```typescript
interface ScriptRunContext {
  sessionId: string
  scriptId: string
  env: Record<string, string>
  params: Record<string, string>
  signal: AbortSignal
  log: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void
  stage: (input: { name: string; label?: string; message?: string }) => void
  progress: (input: {
    scope: 'task' | 'total'
    current: number
    total?: number
    label?: string
    message?: string
    unit?: string
  }) => void
  sdk: {
    browser: { launch: () => Promise<Browser> }
    paths: { userData: string; scriptDir: string }
  }
}
```

**Python：** 同上语义；`ctx.signal.aborted` 为 bool；`ctx.sdk.paths.script_dir` / `user_data` 为 snake_case。

### 日志 / 阶段 / 进度 / 返回值 / 取消

- 返回值 → `session.result`；抛错 → failed
- UI 展示最近一次**成功**运行的返回值
- 监听 abort；浏览器脚本 abort 时关闭 browser

### 产物目录字段

返回**普通对象**且含本机绝对路径字符串时，UI 显示「产物目录」快捷入口。字段优先级：

1. `outputDir`（推荐）
2. `outputPath`
3. `artifactDir`
4. `artifactsDir`
5. `exportDir`
6. `savedTo`

## 依赖管理

| 语言 | 脚本级 | 全局 |
|------|--------|------|
| JavaScript | `dependencies` → 脚本目录 `npm install` | 设置 → 全局 npm → `userData/runtime` |
| Python | `dependencies` → pip 安装至脚本 `.venv` | 设置 → 全局 Python 依赖 → `userData/runtime-python` |

Python 可在 **设置 → Python** 配置 pip 镜像与解释器路径。

## 上传方式

1. **脚本包目录**：含 `autoforge.json` 的文件夹
2. **单文件**：`.js` / `.mjs` / `.cjs` / `.py`，平台自动包装

## 本仓库示例（examples/）

| 路径 | 语言 | 说明 |
|------|------|------|
| `examples/hello-world/` | JS | env + params 最小示例 |
| `examples/hello-world-py/` | Python | stage / progress / log |
| `examples/playwright-py/` | Python | Playwright 浏览器 + env + params |

## 脚本内解析示例

**JavaScript — checkbox：**

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

**Python — checkbox：**

```python
import json

def parse_checkbox(raw: str) -> list[str]:
    if not raw or not raw.strip():
        return []
    try:
        v = json.loads(raw)
        return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []
    except json.JSONDecodeError:
        return []
```

**Python — boolean / number：**

```python
dry_run = ctx.params.get("DRY_RUN") == "true"
limit = int(ctx.params.get("LIMIT") or "10")
```
