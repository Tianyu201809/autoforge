---
name: repo-to-autoforge
description: 把 GitHub / Gitee 上的既有项目转换成一个可直接在 Autoforge 里导入运行的脚本包。Use when the user asks to convert a repository into an Autoforge script, imports a repo from the "从仓库导入" panel, mentions a repo workspace path containing .autoforge/HANDOFF.md, or asks to wrap a CLI / library into an Autoforge script package.
---

# 仓库 → Autoforge 脚本包

把一个**已经存在的仓库**改造成符合 Autoforge 规范的脚本包。与 `autoforge-script-create`（从零新建脚本）的区别：这里的代码形态、依赖和入口都已由仓库决定，你的工作是**判断能否承载 + 写一层适配**，而不是重新实现业务。

权威规范见 `docs/script-spec.md`；`autoforge.json` 字段速查见 `skills/autoforge-script-create/reference.md`。本技能只补充「从既有仓库改造」特有的判断与流程。

> **本文件有两种消费方式**
>
> 1. **外部 Agent（Codex / Claude / Cursor）** 经 MCP 读取，按下面的流程手动完成转换。
> 2. **应用内 LLM 引擎** 把本文件正文作为 system prompt，并追加一段 JSON 输出契约，要求模型直接产出结构化的 `ConversionPlan`（而不是自由文本）。
>
> 因此：**保持本文件对「人/Agent」可读**，不要写成 JSON Schema。应用内引擎所需的输出格式约束由代码侧追加，不写在这里。

## 输入

用户通常给你其中之一：

1. 一个**转换工作区路径**（形如 `<userData>/repo-workspaces/<task>/`），里面有：
   - `repo/` — 原始仓库，只读参考
   - `.autoforge/profile.json` — 结构化仓库画像
   - `.autoforge/HANDOFF.md` — 完整交接说明（**先读它**）
   - `.autoforge/package/` — 产物目录，脚本包写到这里
2. 或直接一个仓库地址 / 一个本地目录。

拿到工作区时，第一步永远是读 `.autoforge/HANDOFF.md` 与 `.autoforge/profile.json`，不要先急着读源码。

### 拉取方式与 `repo/` 的形态

画像里的 `fetchMethod` 告诉你 `repo/` 是怎么来的，这会影响你能拿到什么信息：

| `fetchMethod` | 来源 | 注意 |
|---------------|------|------|
| `archive` | GitHub 归档 zip | 无 `.git`，拿不到提交历史；`commitSha` 通常为 `null` |
| `git` | `git clone --depth 1` | 有 `.git`，可用 `git log -1`、`git describe` 补充上下文；`commitSha` 有值 |

`git` 方式克隆的是**浅克隆**（`--depth 1`），`git log` 只有一条记录，不要试图回溯历史。

Gitee 与 SSH 地址必然走 `git`（Gitee 已不提供公开归档下载）；GitHub 优先归档，失败时才回退 git。所以如果用户在 Gitee 上遇到「未检测到 git」的提示，需要先安装 git。

## 第 0 步：判定可转换性

画像里的 `convertibility` 是启发式结论，**你必须自己复核**，因为它决定后面所有工作是否值得做。

| 级别 | 含义 | 你的动作 |
|------|------|----------|
| `direct` | 本身就是脚本 | 直接改写成 `run(ctx)` 契约 |
| `wrappable` | 库 / CLI，需要适配 | 写薄适配入口调用其 CLI 或 API |
| `needs-build` | 源码需先构建 | 先找已提交的构建产物；没有就如实告知用户，不要假装能跑。产物要**原样复制**进包目录（如 `dist/` → `vendor/dist/`），不要试图复述打包后的 bundle |
| `unsupported` | 形态不适合脚本化 | **不要硬造包**，说明原因并给替代建议 |

`unsupported` 的典型形态，遇到就不要勉强：

- 长期运行的 Web 服务 / 常驻进程（Express、Django、FastAPI 等）
- 纯 GUI 应用
- 依赖外部数据库、消息队列、K8s 等基础设施
- 只有原生二进制、且没有可用的源码构建路径
- 主要语言不是 JavaScript / Python，且没有可调用的 CLI

**诚实优先。** 一个跑不起来的包比一个「明确说不能转」的结论更糟。

## 第 1 步：确认承载方式

Autoforge 只有三种运行时，选最贴近仓库形态的那个：

| 仓库形态 | 选择 | 要点 |
|----------|------|------|
| Python 项目 / 有 CLI | `language: "python"`，`entry: "index.py"` | 适配入口里用 `subprocess` 调 CLI，或直接 `import` 其模块 |
| JS / Node 项目 / 有 CLI | `language: "javascript"`，`entry: "index.mjs"` | 适配入口里 `import()` 其模块，或用 `child_process` 调 CLI |
| 仓库自带当前平台可执行文件 | `language: "executable"` | 直接按原生程序导入，**不要**声明 `dependencies` |

两种主流适配模式：

**模式 A — 包装 CLI（最稳，优先选）**

```javascript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function run(ctx) {
  const args = ['--json']
  if (ctx.params.QUERY) args.push(ctx.params.QUERY)
  ctx.log('INFO', `执行 ${ctx.params.QUERY ?? ''}`.trim())
  const { stdout } = await run('node', ['vendor/cli.js', ...args], {
    cwd: ctx.sdk.paths.scriptDir,
    maxBuffer: 32 * 1024 * 1024
  })
  const data = JSON.parse(stdout)
  ctx.log('INFO', `拿到 ${data.items?.length ?? 0} 条结果`)
  return { ok: true, count: data.items?.length ?? 0 }
}
```

**模式 B — 直接 import 其 API（仅在库有稳定公开 API 时）**

```javascript
export async function run(ctx) {
  const mod = await import(new URL('./vendor/index.js', import.meta.url).href)
  const result = await mod.doTheThing({ input: ctx.params.INPUT })
  return { ok: true, result }
}
```

Python 同理，优先 `subprocess` 调 CLI，其次 `import`。

## 第 2 步：让包自包含

Autoforge 导入脚本包时是**整目录复制**，所以：

1. 把适配入口需要的仓库文件**复制**进 `.autoforge/package/`（通常放 `vendor/` 子目录）。
2. 只复制真正会用到的文件，不要整仓拷贝。
3. **绝对不要**把 `node_modules`、`.venv`、`.git`、`dist`、构建缓存复制进去 —— 依赖由 Autoforge 按清单安装。
4. 检查复制进来的代码有没有相对路径假设（`__dirname`、`import.meta.url`、`sys.path`），必要时修正。

## 第 3 步：写 `autoforge.json`

最小可用形态：

```json
{
  "autoforge": "1.0",
  "name": "显示名称",
  "description": "一句话说明它做什么，以及来自哪个仓库",
  "version": "1.0.0",
  "language": "javascript",
  "entry": "index.mjs",
  "category": "local",
  "env": [],
  "params": [],
  "dependencies": {}
}
```

从仓库转换时特别要注意：

- **`dependencies` 只放运行期依赖**。仓库 `package.json` 里的 `devDependencies`、构建工具、测试框架一律不要写进去。
- 依赖值用宽松版本（`">=2.31.0"`），避免锁死到仓库当时的版本。
- 仓库用 `lock` 文件锁定了大量间接依赖时，只声明适配入口**直接**用到的那几个。
- 如果适配入口依赖仓库自身的本地文件（已复制到 `vendor/`），那部分**不需要**写进 `dependencies`。

## 第 4 步：设计 env / params

从仓库转换时，最容易犯的错是把仓库的配置项一股脑塞进 `params`。

| 仓库里的东西 | 放哪 | 理由 |
|--------------|------|------|
| API 地址、账号、Token、数据库连接 | `env`（`secret: true` 用于密钥） | 换环境才变 |
| 本次任务输入：关键词、日期、ID、文件 | `params` | 每次运行可能不同 |
| 仓库的 `--verbose` / `--dry-run` 之类开关 | `params` + `type: "boolean"` | 每次运行可选 |
| 仓库的枚举选项 | `params` + `type: "select"` + `options` | 让用户选而不是手打 |

不要暴露仓库的全部配置项 —— 只暴露**用户真正需要改的**。其余给合理默认值写死在适配入口里。

## 第 5 步：自检后再导入

导入前逐条确认：

1. `autoforge.json` 是合法 JSON，`entry` 指向包目录内真实存在的文件。
2. 入口导出了 `run(ctx)` / `main(ctx)` / `default`（Python 为 `def run(ctx)` / `async def run(ctx)` / `main(ctx)`）。
3. 包目录内不存在 `.git` / `node_modules` / `.venv`。
4. 入口里所有路径都基于 `ctx.sdk.paths.scriptDir` 解析，没有硬编码的绝对路径。
5. 需要联网 / 调用外部 CLI 的，在 `description` 或返回值里说明，便于用户理解风险。

导入方式（二选一）：

- 在 Autoforge 的「从仓库导入」窗口点击**导入产物**。
- 通过 MCP 调用 `autoforge_import_script`，`sourcePath` 传 `.autoforge/package/` 的绝对路径，带 `confirm: true`。

导入后建议**立即试运行一次**（`autoforge_start_script`），确认能跑通再告诉用户完成。跑不通就把真实报错回传给用户，不要掩饰。

## 汇报格式

完成后按这个结构汇报：

1. **判定结论** —— 可转换性级别与理由
2. **产物路径** —— `.autoforge/package/` 绝对路径
3. **承载方式** —— 语言、入口、适配模式（包装 CLI / 直接 import）
4. **配置项** —— env 与 params 各有哪些、为什么这样分
5. **依赖** —— 声明了哪些、为什么
6. **试运行结果** —— 成功 / 失败与真实输出
7. **遗留问题** —— 需要用户手动做的事（如先构建、提供 Token）

## 反模式（不要做）

- ❌ 为了「看起来能跑」而伪造数据或吞掉错误
- ❌ 把整个仓库塞进包目录
- ❌ 把 `devDependencies` 写进 `dependencies`
- ❌ 把 `unsupported` 的仓库硬转成包
- ❌ 未经用户确认就修改原仓库目录 `repo/` 里的文件
