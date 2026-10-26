---
name: autoforge-script-create
description: 通过多轮澄清创建符合 Autoforge 规范的脚本包（autoforge.json，以及 JavaScript、TypeScript、Python 或已有原生程序的 executable 入口）。在用户明确确认《脚本确认清单》之前不写代码。Use when the user invokes /autoforge-script-create, pastes the Autoforge script prompt, asks to create, scaffold, or generate an Autoforge script, 新建脚本, 写脚本, 脚本包, env/params, index.mjs, index.py, or wants an agent to follow Autoforge script rules.
---

# Autoforge 脚本创建

用多轮对话把脚本需求问清楚，再按 Autoforge 规范落盘。平台把「换环境才变的配置」和「每次运行才变的业务输入」放在不同 Tab；没问清就写代码，用户会在错误的地方填值，脚本也会读错字段。

若工作区是 Autoforge 仓库，实现前阅读 `docs/script-spec.md`。字段、上下文和原生程序细节阅读同目录 [reference.md](reference.md)。应用内「复制规则提示词」的正文是同目录 [agent-prompt.md](agent-prompt.md)，阶段与本文件一致。本文件管对话顺序，reference 管契约。两者冲突时以 `docs/script-spec.md` 为准。

## 阶段

一次只推进一个阶段。用户没说完需求时，不要把下面整张表一次倒出去。

```
Task Progress:
- [ ] 0 听需求
- [ ] 1 澄清
- [ ] 2 确认清单并等待明确同意
- [ ] 3 按契约实现
- [ ] 4 交付汇报
```

### 0 · 听需求

若用户还没描述要自动化的事，先用两三句说明流程：先澄清，确认后才写代码。然后请他用自己的话讲输入、输出和怎样算成功。

用户已经描述了任务时，直接进入澄清，不要让他重说一遍。

### 1 · 澄清

每次最多问 3 个彼此相关的问题，用用户正在使用的语言。能从上下文确定的项不要再问。含糊回答（「随便」「你看着办」）要收成明确选项，让用户选，不要替他决定后直接写文件。

确认清单里的每一项都要有答案：

| 项 | 要问清什么 | 为什么不能猜 |
|----|------------|--------------|
| 任务 | 输入、输出、成功标准、失败时怎么办 | 决定字段和返回值 |
| 身份 | kebab-case 目录名、显示名、一句话描述 | 目录名和卡片名称 |
| 分类 | `browser` / `local` / `scrape` / `file` / `system` | 平台分类 |
| 语言 | `javascript` / `typescript` / `python`；仅当用户**已经有**原生主程序时才用 `executable` | 入口形态完全不同，本技能不编译二进制 |
| 配置归属 | 换环境才变 → `env`（配置 Tab）；每次运行才变 → `params`（运行参数 Tab） | 两个 Tab 分开持久化，禁止混用 |
| 字段 | 每个 key 的 label、type、required、options、default | UI 由 schema 生成，值在运行时永远是字符串 |
| 浏览器 | 是否调用 `ctx.sdk.browser.launch()`；验证码 / 2FA 必须有头 | `headless` 写错会导致无法人工验证 |
| 依赖 | npm 或 pip 的包名与版本 | 平台按语言安装到不同位置 |
| 产物 | 是否要在界面显示「产物目录」 | 必须在返回对象里给绝对路径 `outputDir` |
| 取消 | 长任务是否检查中止信号 | 否则用户点停止后脚本仍继续 |
| 说明 | 是否写包根 `README.md` | 对应脚本详情「说明」Tab |

`type` 只能是 `text`、`textarea`、`number`、`select`、`radio`、`checkbox`、`boolean`、`attachment`。`select` / `radio` / `checkbox` 必须有 `options`。`number` 需要调整柄时加 `ui: "slider"`，并给出数字 `min`、`max`、`step`。

### 2 · 确认清单

澄清完成后输出《脚本确认清单》，然后停下。不要在同一条回复里附上完整脚本。

```markdown
## 脚本确认清单

- 目录名：
- 显示名：
- 描述：
- 分类：
- 语言 / 入口：
- 浏览器：
- 依赖：
- 产物：
- README：写 / 不写

### 配置 Tab（env）
| key | label | type | required | default | 说明 |

### 运行参数 Tab（params）
| key | label | type | required | default | 说明 |

### 行为
- 成功时：
- 缺必填时：
- 取消时：
- 验收：导入后怎样点一次算通过

请回复「确认」后我再写代码。要改哪一项直接说。
```

进入实现的条件只有一个：用户明确同意这份清单，且没有同时提出修改。例如「确认」「可以写」「就按这个写」。

- 用户改了某一项：更新清单，再次等待确认。
- 用户说「你看着办」：把假设写进清单的具体取值里，再等确认。
- 用户要求跳过确认：说明跳过会导致字段和语言未锁定，仍先给出清单。只有用户在看过清单后明确同意，才能写代码。

### 3 · 实现

先读 [reference.md](reference.md)，再落盘。只创建清单里有的字段和文件。

- JavaScript：`autoforge.json` + `index.mjs`，`export async function run(ctx)`
- TypeScript：源码编译后的入口必须是清单里的 `entry`（通常 `dist/index.js`），`dependencies` 同时写入清单
- Python：`language: "python"`，`entry: "index.py"`，`async def run(ctx)` 或同步 `def run(ctx)`
- executable：只为用户已有的原生主程序写清单，不生成二进制，不声明 `dependencies` 或 `browser`

脚本放在用户指定的位置。用户没指定、且当前仓库是 Autoforge 时，业务脚本用 `packages/<name>/`，给别人学的最小示例才用 `examples/<name>/`。

### 4 · 交付汇报

```markdown
## 已写好

- 路径：
- 语言 / 入口：
- 配置 Tab 要填的 env：
- 运行参数 Tab 要填的 params：
- 依赖与安装位置：
- 产物目录：有则说明 `outputDir`；无则写「无」
- 浏览器：是否无头
- 导入：把包含 `autoforge.json` 的目录导入 Autoforge 后，按验收步骤运行一次
```

## 写代码前再核对

这些错误平台不会在编辑器里拦下来，但一运行就错：

- `env` 和 `params` 混用，或提示用户去错误的 Tab
- 把 checkbox、boolean、attachment 当成非字符串。运行时它们仍是字符串：多选和附件是 JSON 数组字符串，开关是 `"true"` / `"false"`
- Python 使用 JS 的 camelCase 上下文字段。Python 是 `session_id`、`script_id`、`sdk.paths.user_data`、`sdk.paths.script_dir`，`stage` / `progress` 用关键字参数
- 需要「产物目录」按钮时，返回值不是普通对象，或路径不是本机绝对路径
- 用 executable 实现新的业务逻辑，或给原生包声明 `dependencies`
