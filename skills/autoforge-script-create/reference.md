# Autoforge 脚本契约

来源：`docs/script-spec.md`。实现脚本前阅读本文件。与规范原文冲突时以 `docs/script-spec.md` 为准。

## 脚本包

目录包必须包含 `autoforge.json` 和入口文件。JavaScript / Python 入口导出 `run(ctx)`（JS 也接受 `main` 或 `default`；Python 也接受 `main`）。`language: "executable"` 不导出 `run`。

```
my-script/
├── autoforge.json
├── README.md          # 可选，文件名大小写必须是 README.md
└── index.mjs          # 或 index.py，或 dist/index.js，或原生主程序
```

| 语言 | language | entry | 入口 |
|------|----------|-------|------|
| JavaScript | `javascript`（可省略） | `index.mjs` | `export async function run(ctx)` |
| TypeScript | 省略或 `javascript` | 编译产物，如 `dist/index.js` | 同上，导入的是构建后的目录 |
| Python | `python` | `index.py` | `async def run(ctx)` 或 `def run(ctx)` |
| 原生程序 | `executable` | 包内已有主程序的相对路径 | 不实现 `run` |

`language` 省略时按扩展名推断；`.py` → python，`.mjs` / `.js` → javascript。其他文件再按 PE / Mach-O / ELF 识别为 executable。

## autoforge.json

| 字段 | 必填 | 说明 |
|------|------|------|
| `autoforge` | 是 | 固定 `"1.0"` |
| `name` | 是 | 显示名称 |
| `description` | | 卡片短描述，不替代 README |
| `version` | | 语义化版本，默认 `1.0.0` |
| `entry` | | 相对包根的入口 |
| `language` | | `javascript` / `python` / `executable` |
| `category` | | `browser` / `local` / `scrape` / `file` / `system` |
| `categoryLabel` | | 浏览器自动化 / 本地程序 / 网页抓取 / 文件操作 / 系统 |
| `env` | | 环境配置 schema |
| `params` | | 运行参数 schema |
| `dependencies` | | JS 为 npm；Python 为 pip specifier。原生程序禁止声明 |
| `browser.headless` | | 默认 `false`。验证码 / 2FA 保持 `false` |
| `export.include` | | 仅 JS/Python ZIP 导出时补充静态分析不到的资源。原生包忽略此字段 |

## env 与 params

不要混用。

| | env | params |
|---|-----|--------|
| 用途 | 账号、密码、API 地址、Token | 订单号、日期、本次要处理的文件 |
| 变化 | 按环境长期固定 | 每次运行可能不同 |
| 平台 | 脚本详情 → **配置** Tab | 脚本详情 → **运行参数** Tab |
| 访问 | `ctx.env.KEY` / `ctx.env.get("KEY")` | `ctx.params.KEY` / `ctx.params.get("KEY")` |

选用：换环境才变 → env；每次任务才变 → params；每次运行上传的文件 → params 且 `type: "attachment"`。

缺 env 时，错误信息指向「配置」Tab。缺 params 时，指向「运行参数」Tab。

### type

`ctx.env` 与 `ctx.params` 的值**永远是字符串**。

| type | UI | 运行时的值 | 脚本内 |
|------|-----|------------|--------|
| `text`（默认） | 单行 | 字符串 | 直接用。仅此类型支持 `secret: true` |
| `textarea` | 多行 | 字符串 | 直接用 |
| `number` | 数字框；`ui: "slider"` 时为滑块加数字框 | 数字字符串 | `Number(raw)` / `int(raw or 0)`。滑块需 `min`、`max`、`step` |
| `select` / `radio` | 下拉 / 单选 | 选项 value | 直接用。必须有 `options` |
| `checkbox` | 多选 | JSON 数组字符串 | `JSON.parse` / `json.loads`。必须有 `options` |
| `boolean` | 开关 | `"true"` / `"false"` | `raw === "true"` |
| `attachment` | 文件多选 | JSON 数组字符串 | 解析出 `{ name, path, size? }` |

`options` 可以是 `["a","b"]` 或 `{ "label", "value" }`。`default` 也是字符串。

env 合并：清单默认值 → 全局 Profile 共享变量 → 脚本专属配置（最高）。

params 合并：清单默认值 → 该环境下次保存值 → 本次运行传入（最高）。

### 附件

每项：`name`（缓存文件名）、`path`（绝对路径）、可选 `size`。

- params：`{userData}/script-inputs/{scriptId}/params/{envId}/{paramKey}/`
- env：`{userData}/script-inputs/{scriptId}/env/{envId}/{key}/`

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

```python
import json

def parse_attachments(raw):
    if not raw or not str(raw).strip():
        return []
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return [i for i in items if isinstance(i, dict) and i.get("path")] if isinstance(items, list) else []
```

## JavaScript 上下文

```javascript
export async function run(ctx) {
  const { env, params, signal, log, sdk } = ctx
  log('INFO', '开始执行')
  if (signal.aborted) throw new Error('已取消')
  ctx.stage({ name: 'fetch', label: '拉取数据' })
  ctx.progress({ scope: 'task', current: 1, total: 1, label: '当前文件' })
  ctx.progress({ scope: 'total', current: 1, total: 10, unit: '条' })
  return { ok: true }
}
```

| 成员 | 说明 |
|------|------|
| `sessionId` / `scriptId` | 字符串 |
| `env` / `params` | `Record<string, string>` |
| `signal.aborted` | 用户停止或超时 |
| `log(level, message)` | `INFO` / `WARN` / `ERROR` |
| `sdk.browser.launch()` | Playwright Browser。依赖如 `playwright-core` |
| `sdk.paths.userData` / `scriptDir` | 字符串路径 |

`scope: "task"` 是当前子任务，`scope: "total"` 是整批。`current` 必填；省略 `total` 表示不确定进度。

## Python 上下文

独立子进程，需本机 Python 3.9+（设置 → Python）。属性是 snake_case，`stage` / `progress` 只能用关键字参数。

```python
async def run(ctx):
    ctx.log("INFO", "开始执行")
    if ctx.signal.aborted:
        return None
    ctx.stage(name="fetch", label="拉取数据")
    ctx.progress(scope="total", current=1, total=10, unit="条")
    browser = await ctx.sdk.browser.launch()
    script_dir = ctx.sdk.paths.script_dir  # pathlib.Path
    return {"ok": True}
```

| 成员 | Python |
|------|--------|
| 会话 / 脚本 | `ctx.session_id` / `ctx.script_id` |
| 路径 | `ctx.sdk.paths.user_data` / `script_dir`（`pathlib.Path`） |
| 浏览器 | `await ctx.sdk.browser.launch()`，`dependencies` 含 `playwright` |

`ctx.env` / `ctx.params` 仍是字符串字典，复合类型的解析规则与 JS 相同。

浏览器脚本在 `finally` 里关闭 page 和 browser。参考 `examples/playwright-py/`。

## 返回值与产物

- 返回值写入 `session.result`；抛错则失败，不覆盖上一次成功结果
- UI 展示最近一次**成功**运行：对象和数组格式化为 JSON，字符串原样，`null` / `undefined` / `None` 不显示
- 「产物目录」按钮要求返回**普通对象**，且下列字段中第一个非空字符串是本机绝对路径：`outputDir`（推荐）→ `outputPath` → `artifactDir` → `artifactsDir` → `exportDir` → `savedTo`

```javascript
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export async function run(ctx) {
  const outDir = join(ctx.sdk.paths.scriptDir, 'output', 'run')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'result.json'), JSON.stringify({ ok: true }))
  return { outputDir: outDir, files: ['result.json'] }
}
```

```python
async def run(ctx):
    out_dir = ctx.sdk.paths.script_dir / "output" / "run"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "result.json").write_text("{}", encoding="utf-8")
    return {"outputDir": str(out_dir.resolve()), "files": ["result.json"]}
```

## 依赖

| 语言 | 清单 dependencies | 安装位置 |
|------|-------------------|----------|
| JavaScript / TypeScript | npm 包名 → 版本 | 脚本目录 `npm install`；全局包在设置 → 全局 npm 依赖 |
| Python | pip specifier | `{scriptDir}/.venv`；全局包在设置 → Python → 全局 Python 依赖 |
| executable | 禁止 | 平台不安装 DLL 或系统运行库 |

pip 镜像源和运行超时在设置 → Python。超时对 JS 与 Python 共用，`0` 表示不限制。

## README

包根可选 `README.md`（大小写精确）。脚本详情 → **说明** Tab 渲染它。图片用相对包根的路径。`readme.md`、子目录 README、在清单里声明路径都不行。短描述仍写在 `description`。

## 原生可执行程序

只包装用户已经提供的当前平台主程序。不要编译、不要伪造二进制。

- 入口必须是包根内的普通文件（Windows PE、macOS Mach-O 或 Linux ELF），目标平台等于当前系统
- 不支持目录、符号链接、DLL、`.app` 包，也不支持一份清单映射多平台入口
- 不声明 `dependencies` 或 `browser`
- 不接收命令行参数。`env` 以原始键名注入；每个 param 同时出现在 `AUTOFORGE_PARAM_<大写键>`（非字母数字变为 `_`）和 `AUTOFORGE_PARAMS_JSON`
- 另外注入 `AUTOFORGE_SESSION_ID`、`AUTOFORGE_SCRIPT_ID`、`AUTOFORGE_SCRIPT_DIR`。清单 env 不能覆盖这三个最终值
- 两个 param 键规范化后相同（如 `order-id` 与 `order_id`）则清单非法
- 首次从界面运行要用户确认 SHA-256。定时任务、批量运行和 MCP 不能弹窗授权，只能跑已经确认且字节未变的入口
- stdout 记为 INFO，stderr 记为 ERROR，退出码 0 为成功

## 导入

- JS / Python：导入含 `autoforge.json` 与入口的目录。单文件 `.js` / `.mjs` / `.cjs` / `.py` 会由平台包装
- TypeScript：导入构建产物所在、且能按 `entry` 找到文件的目录
- 原生：有清单的目录，或本地无清单的当前平台可执行文件 / 目录 / ZIP
- 分发 zip 不要打进 `node_modules/`、`.venv/`、`.env` 和密钥。Hub 安装的 zip 必须自带 `autoforge.json`

最小示例：`examples/hello-world/`、`examples/hello-world-py/`、`examples/playwright-py/`。
