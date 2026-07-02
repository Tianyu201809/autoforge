---
name: autoforge-script-create
description: 为 Autoforge 新建脚本包（autoforge.json + run(ctx)），支持 JavaScript 与 Python。Use when the user invokes /autoforge-script-create, asks to create a new Autoforge script, scaffold a script package, add env/params schema, or build browser/local automation scripts for Autoforge.
disable-model-invocation: true
---

# Autoforge 脚本创建（/autoforge-script-create）

在 Autoforge 中新建符合平台规范的脚本包。权威规范见 [docs/script-spec.md](../../docs/script-spec.md)；字段速查见 [reference.md](reference.md)。

**支持语言：** JavaScript（`index.mjs` / `.js`）· Python（`index.py`，需 `language: "python"`）

---

## 铁律

1. **先澄清、后写码** — 未完成需求澄清与用户确认前，禁止创建文件或写实现代码（遵循 superpowers `brainstorming` 的 HARD-GATE）。
2. **语言必问** — 除非用户已明确指定，必须在澄清阶段询问脚本语言（JavaScript / Python）。
3. **env 与 params 禁止混用** — 换环境才变的放 `env`，每次任务才变的放 `params`。
4. **单一事实来源** — 以 `docs/script-spec.md` 为准；本 skill 与 reference 冲突时以 spec 为准。

---

## 总流程

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1  需求澄清（superpowers brainstorming 规范化流程）      │
│   探索上下文 → 逐条提问 → 方案对比 → 迷你设计 → 用户批准        │
└───────────────────────────┬─────────────────────────────────┘
                            ▼ 用户明确批准
┌─────────────────────────────────────────────────────────────┐
│ Phase 2  脚手架与实现                                         │
│   autoforge.json → 入口 run(ctx) → 依赖声明 → 本地验证         │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3  交付汇报                                             │
│   路径 / Tab 说明 / 测试步骤 / 导入方式                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1：需求澄清（Superpowers 规范化流程）

**启动本 skill 后，先 invoke / 遵循 `brainstorming` skill 的原则**（不必写完整平台级 design doc，但澄清纪律相同）。

### 1.1 探索项目上下文（先做，再提问）

读取并理解：

| 资源 | 用途 |
|------|------|
| [docs/script-spec.md](../../docs/script-spec.md) | 字段、env/params、SDK、依赖 |
| `examples/hello-world/` | JS 最小示例 |
| `examples/hello-world-py/` | Python 最小示例 |
| `examples/playwright-py/` | Python 浏览器自动化 |
| [reference.md](reference.md) | 本 skill 速查 |

若用户指定了分类（browser / file 等），对照 spec 中同类示例。

### 1.2 澄清问题清单（逐条提问，每次只问一个）

**必须覆盖的项**（可从对话推断则跳过并说明推断依据）：

| 顺序 | 主题 | 说明 |
|------|------|------|
| **1** | **脚本语言** | **必问（除非已明确）**：`JavaScript` 或 `Python` |
| 2 | 脚本名 | kebab-case 目录名，如 `order-export` |
| 3 | 显示名称与用途 | 一句话描述脚本做什么 |
| 4 | 分类 | `browser` / `local` / `scrape` / `file` / `system` |
| 5 | env vs params | 哪些键放 env（配置 Tab），哪些放 params（详情 Tab） |
| 6 | params 控件类型 | `text` / `textarea` / `number` / `select` / `radio` / `checkbox` / `boolean` / `attachment` |
| 7 | 浏览器脚本 | 是否需要 `ctx.sdk.browser`；`browser.headless` 默认 |
| 8 | 依赖 | JS → npm 包名；Python → pip 包名与版本约束 |
| 9 | 产物落盘 | 是否需要 UI「产物目录」快捷入口（返回值含 `outputDir` 等） |
| 10 | 落盘位置 | 本仓库 `examples/<name>/` 还是用户指定路径 |

**语言澄清示例（第一个未决问题优先问这个）：**

> 脚本打算用哪种语言开发？
> - **A)** JavaScript（`index.mjs`，平台默认）
> - **B)** Python（`index.py`，需本机 Python 3.9+）

**Python 选型提示（用户选 B 或场景匹配时主动说明）：**

- 数据处理、现有 Python 库、团队 Python 栈 → 选 Python
- 浏览器自动化：Python 侧用 `playwright` pip 包 + `await ctx.sdk.browser.launch()`
- 依赖写入 `autoforge.json` 的 `dependencies`，首次运行自动 pip 安装至脚本 `.venv`
- 可在 **设置 → Python** 配置解释器路径与 pip 镜像

**JavaScript 选型提示：**

- 平台默认路径；浏览器用 Playwright（`playwright-core` 等 npm 依赖）
- 单文件 `.js` / `.mjs` / `.cjs` 导入时平台会自动包装为脚本包

### 1.3 方案对比（有意义时）

当实现路径不唯一时，给出 **2～3 种方案 + 权衡 + 推荐**，例如：

- 纯本地文件处理 vs 浏览器自动化
- Python `requests` vs JS `axios` 拉 API
- 参数全部放 params vs 敏感 URL/Token 放 env

**推荐一项并说明理由**，等用户确认。

### 1.4 迷你设计（澄清完成后）

用结构化摘要呈现（不必单独写 spec 文件，除非用户要求）：

1. **语言与入口**：`javascript` + `index.mjs` 或 `python` + `index.py`
2. **目录结构**：文件列表
3. **autoforge.json 要点**：`name`、`category`、`env[]`、`params[]`、`dependencies`、`browser`
4. **run(ctx) 主流程**：阶段划分（`stage` / `progress`）
5. **返回值**：是否含 `outputDir`
6. **验证方式**：如何本地跑、如何导入 Autoforge

**HARD-GATE：** 询问「以上设计是否可以开始实现？」— 用户明确同意后再进入 Phase 2。

---

## Phase 2：脚手架与实现

### 任务清单

```
Task Progress:
- [ ] 确认目标目录（默认 examples/<name>/）
- [ ] 创建 autoforge.json（含 language / entry / env / params / dependencies）
- [ ] 创建入口文件并实现 async run(ctx)
- [ ] 浏览器脚本：launch + abort 时关闭 browser
- [ ] 有文件输出：返回 outputDir（本机绝对路径）
- [ ] 对照 script-spec 检查 schema 默认值均为字符串
- [ ] 本地验证（见下文）
```

### 目录结构

**JavaScript（推荐 `index.mjs`）：**

```
examples/<name>/
├── autoforge.json
└── index.mjs
```

**Python：**

```
examples/<name>/
├── autoforge.json    # "language": "python", "entry": "index.py"
└── index.py
```

### autoforge.json 模板（按语言选用）

**JavaScript：**

```json
{
  "autoforge": "1.0",
  "name": "显示名称",
  "description": "脚本说明",
  "version": "1.0.0",
  "entry": "index.mjs",
  "category": "local",
  "env": [],
  "params": [],
  "dependencies": {}
}
```

**Python：**

```json
{
  "autoforge": "1.0",
  "name": "显示名称",
  "description": "脚本说明",
  "version": "1.0.0",
  "language": "python",
  "entry": "index.py",
  "category": "local",
  "env": [],
  "params": [],
  "dependencies": {}
}
```

浏览器脚本按需添加 `"browser": { "headless": true }`。

### run(ctx) 入口约定

**JavaScript：**

```javascript
export async function run(ctx) {
  const { env, params, log, signal, sdk } = ctx

  log('INFO', '开始执行')
  if (signal.aborted) throw new Error('已取消')

  return { ok: true }
}
```

**Python：**

```python
async def run(ctx):
    ctx.log("INFO", "开始执行")
    if ctx.signal.aborted:
        raise RuntimeError("已取消")

    value = ctx.params.get("KEY", "")
    return {"ok": True, "value": value}
```

### 语言差异速查

| 项 | JavaScript | Python |
|----|------------|--------|
| manifest | 可省略 `language`（默认 JS） | 必须 `"language": "python"` |
| 入口 | `export async function run(ctx)` | `async def run(ctx):` |
| 环境/参数 | `ctx.env.KEY` / `ctx.params.KEY` | `ctx.env.get("KEY")` / `ctx.params.get("KEY")` |
| 日志 | `ctx.log('INFO', msg)` | `ctx.log("INFO", msg)` |
| 阶段/进度 | `ctx.stage(...)` / `ctx.progress(...)` | 同名方法，snake_case 关键字参数 |
| 路径 | `ctx.sdk.paths.scriptDir` | `ctx.sdk.paths.script_dir` |
| 浏览器 | `await ctx.sdk.browser.launch()` | 同左；`dependencies` 含 `playwright` |
| 依赖安装 | npm → 脚本目录 `node_modules` | pip → 脚本目录 `.venv` |
| 单文件导入 | `.js` / `.mjs` / `.cjs` | `.py` |

### env 与 params（两语言相同语义）

| | **env** | **params** |
|---|---|---|
| 用途 | 固定环境配置 | 本次业务输入 |
| 平台 | 脚本详情 → **配置** Tab | 脚本详情 → **详情** Tab |
| 访问 | 见上表 | 见上表 |

- 所有 schema 的 `default` 必须是**字符串**
- `checkbox` / `attachment` 值为 JSON 数组字符串，脚本内 `JSON.parse` / `json.loads`
- `boolean` 值为 `"true"` / `"false"`

完整类型表见 [reference.md](reference.md)。

### 日志 / 阶段 / 进度 / 产物 / 取消

```javascript
ctx.stage({ name: 'fetch', label: '拉取数据', message: '…' })
ctx.progress({ scope: 'task', current: 3, total: 10, label: '当前文件' })
ctx.progress({ scope: 'total', current: 450, total: 1000, unit: '条', label: '总进度' })
```

Python 等价：`ctx.stage(name="fetch", label="拉取数据", message="…")` 等。

**产物目录** — 返回普通对象且含本机绝对路径时，UI 显示快捷入口。字段优先级：

`outputDir` → `outputPath` → `artifactDir` → `artifactsDir` → `exportDir` → `savedTo`

**取消** — 监听 `signal.aborted` / `ctx.signal.aborted`；浏览器脚本 abort 时关闭 browser。

### 依赖示例

**JS 浏览器：**

```json
"dependencies": { "playwright-core": "^1.50.1" }
```

**Python 浏览器：**

```json
"dependencies": { "playwright": ">=1.50.0" }
```

**Python HTTP：**

```json
"dependencies": { "requests": ">=2.31.0" }
```

### 本地验证

| 语言 | 建议步骤 |
|------|----------|
| JavaScript | 在 Autoforge 中导入目录；或构造最小 ctx 手动调用 `run` |
| Python | 确认本机 Python 3.9+；导入后首次运行触发 pip 安装；参考 `examples/hello-world-py` |

导入前检查：

- [ ] `autoforge.json` 与入口文件同目录
- [ ] `entry` 指向存在的文件
- [ ] Python 包已声明 `language: "python"`
- [ ] 必填 env/params 在对应 Tab 可填写

---

## Phase 3：交付汇报

实现完成后，向用户汇报：

1. **包路径与语言** — 目录、`entry`、`language`
2. **配置 Tab（env）** — 各键含义与 type
3. **详情 Tab（params）** — 各键含义与 type（含 attachment/checkbox/boolean 取值格式）
4. **依赖** — npm 或 pip 包及首次运行安装说明
5. **浏览器** — 若适用，说明 `headless` 默认值
6. **产物** — 若适用，说明 `outputDir` 规则
7. **导入方式** — 拖入文件夹 / 选择目录 / 单文件上传
8. **Python 额外项** — 需 **设置 → Python** 检测通过；可选 pip 镜像

---

## 常见问题

| 现象 | 排查 |
|------|------|
| Python 脚本无法运行 | 设置页检测 Python；版本 ≥ 3.9 |
| pip 安装失败 | 设置页配置镜像；检查 `dependencies` 版本是否存在 |
| 浏览器 launch 失败 | JS 检查 playwright-core；Python 检查 `playwright` 依赖 |
| 缺参报错 | env 去 **配置** Tab；params 去 **详情** Tab |
| 无产物目录按钮 | 返回值须为对象且含 `outputDir` 等字段；且最近一次运行成功 |

---

## 参考示例（本仓库）

| 路径 | 语言 | 说明 |
|------|------|------|
| `examples/hello-world/` | JS | env + params 最小示例 |
| `examples/hello-world-py/` | Python | stage / progress / log |
| `examples/playwright-py/` | Python | browser SDK + env + params |

更多字段说明：[reference.md](reference.md) · [docs/script-spec.md](../../docs/script-spec.md)
