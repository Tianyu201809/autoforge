<div align="center">

# Autoforge

### 自动化脚本散落在各处，环境配置重复录入，运行结果难以追溯——Autoforge 把它们收进一个本机桌面工作台。

[![Version](https://img.shields.io/badge/version-1.9.0-blue)](docs/v1.9.0.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[快速开始](#安装) · [看示例](#see-it-work) · [脚本开发](#脚本开发) · [版本说明](docs/v1.9.0.md) · [更新日志](docs/CHANGELOG.md)

</div>

---

> [!IMPORTANT]
> **本机运行，数据留在你的电脑上。**
>
> | 关注点 | 说明 |
> |--------|------|
> | 会执行什么 | 你导入的 JS / Python 脚本；可调用 Playwright 启动浏览器 |
> | 会写哪些文件 | `%APPDATA%/autoforge/` 下的 SQLite 数据库、脚本目录、依赖缓存 |
> | 会访问网络吗 | 仅在安装 npm / pip 依赖或脚本自身发起请求时 |
> | Python | 调用你本机已安装的 Python 3.9+，应用不捆绑解释器 |
> | 如何卸载 | Windows「添加或删除程序」卸载 Autoforge；`userData` 目录可手动删除以清除全部数据 |

```bash
git clone <repo-url> && cd Autoforge && npm install && npm run dev
```

---

## The Problem

写自动化脚本不难，难的是**反复配置环境、找不到上次日志、定时任务和手动运行各跑一套**。Autoforge 把脚本当作可导入的「包」统一管理：一份清单声明需要什么变量，平台负责装依赖、跑任务、记历史。

如果你用过 cron + 手写 shell 的组合，核心思路类似——区别是 Autoforge 提供了可视化界面、多环境 Profile、实时日志，以及 JavaScript / Python 双语言运行时。

---

## See It Work

导入内置示例后，在详情 Tab 点击「运行」，终端面板会实时输出：

```
[INFO] 开始执行
[INFO] 环境变量 GREETING=Hello
[INFO] 运行参数 TARGET=Autoforge
[INFO] 执行完成
```

最小脚本包只需两个文件：

```
hello-world/
├── autoforge.json
└── index.mjs
```

```javascript
export async function run(ctx) {
  ctx.log('INFO', `Hello ${ctx.params.TARGET ?? 'World'}`)
  return { ok: true }
}
```

应用内 **开发指南** 可一键导入 `examples/hello-world/` 与 `examples/hello-world-py/`。

---

## Install

### 环境要求

- Node.js 18+
- Windows x64（当前主要目标平台）
- Python 3.9+（仅运行 Python 脚本时需要）

### 开发模式

```bash
git clone <repo-url>
cd Autoforge
npm install          # postinstall 自动下载 Playwright 浏览器
npm run dev
```

### 打包安装程序

```bash
npm run dist:win     # 输出至 release/
```

<details>
<summary><b>其他命令</b></summary>

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译主进程、预加载与渲染进程 |
| `npm run preview` | 预览编译产物 |
| `npm run install:browsers` | 手动安装 Playwright 浏览器 |
| `npm run generate:icons` | 从 SVG 生成应用图标 |

</details>

---

## Getting Started

1. **启动应用** — `npm run dev` 或安装 `release/` 下的 NSIS 安装包
2. **导入示例** — 开发指南 → 导入 `hello-world`
3. **填写参数** — 详情 Tab 填写运行参数，配置 Tab 设置环境变量
4. **运行** — 点击「运行」，在终端面板查看日志
5. **（可选）定时** — 详情 → 定时任务，填写 Cron 表达式

Python 脚本：先在 **设置 → Python** 检测并配置解释器路径，再导入 `hello-world-py`。

---

## 功能概览

- **双语言运行时** — JavaScript（主进程）与 Python（子进程），共用 `run(ctx)` 契约
- **脚本管理** — 导入、拖拽、分类、收藏、归档、分页、搜索与排序
- **多环境 Profile** — 开发 / 测试 / 生产等环境变量集
- **运行参数** — 文本、多类型字段与附件参数
- **运行与日志** — 一键运行 / 停止 / 重启；实时日志与进度回显
- **执行历史** — 按日汇总，点击查看详情弹窗
- **定时任务** — 六段 Cron，卡片显示执行周期
- **依赖管理** — 脚本级 + 全局 npm / pip 依赖，安装结果缓存
- **浏览器自动化** — 内置 Playwright；`ctx.sdk.browser.launch()`
- **界面** — 6 套皮肤、托盘、悬浮球、全局快捷键 `Ctrl+Shift+A`、小记面板

<details>
<summary><b>环境变量 vs 运行参数</b></summary>

| | **环境变量 `env`** | **运行参数 `params`** |
|---|---|---|
| 用途 | 固定环境配置：账号、Token、API 地址 | 业务输入：订单号、日期范围、任务 ID |
| 变化频率 | 按环境长期固定 | 每次运行可能不同 |
| 配置位置 | 详情 → **配置** Tab | 详情 → **详情** Tab |
| 脚本内访问 | `ctx.env.KEY` | `ctx.params.KEY` |

**选用原则：** 换环境才变的值放 `env`；每次任务才变的值放 `params`。

</details>

---

## 脚本开发

### run(ctx) 上下文

```typescript
interface ScriptRunContext {
  sessionId: string
  scriptId: string
  env: Record<string, string>
  params: Record<string, string>
  signal: AbortSignal
  log: (level, message) => void
  stage: (input) => void      // 阶段回显
  progress: (input) => void   // 进度回显
  sdk: {
    browser: { launch: () => Promise<Browser> }
    paths: { userData: string; scriptDir: string }
  }
}
```

入口函数支持 `run(ctx)`、`main(ctx)` 或 `default`（JS）。

### 导入方式

1. **脚本包目录** — 包含 `autoforge.json` 的文件夹
2. **单文件** — `.js` / `.mjs` / `.cjs` / `.py`，平台自动包装为脚本包

### 内置示例

| 示例 | 说明 |
|------|------|
| `examples/hello-world/` | JS 最小示例，演示 `env` 与 `params` |
| `examples/hello-world-py/` | Python 最小示例 |
| `examples/playwright-py/` | Python Playwright 浏览器自动化 |

完整字段说明见 [脚本包规范](docs/script-spec.md)（安装包内亦随附）。

---

## How It Works

Autoforge 是 Electron 桌面应用：**零内置脚本**，只做平台。用户脚本存放在 `userData/scripts/`，由执行引擎按生命周期（校验 → 装依赖 → 启动 → 运行 → 完成）调度。

<details>
<summary><b>架构与数据流</b></summary>

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer (Vue 3)                      │
│  Sidebar · ScriptCard · DetailPanel · LogConsole · …   │
└────────────────────────┬────────────────────────────────┘
                         │ IPC
┌────────────────────────▼────────────────────────────────┐
│                    Main Process                          │
│  script-runner · dependency-manager · scheduler · db     │
└────────────────────────┬────────────────────────────────┘
                         │ import / spawn
┌────────────────────────▼────────────────────────────────┐
│              用户脚本包 (userData/scripts/{id}/)          │
└─────────────────────────────────────────────────────────┘
```

**本机数据目录**（Windows 通常为 `%APPDATA%/autoforge/`）：

```
userData/
├── autoforge.db              # SQLite 持久化
├── scripts/{id}/             # 脚本包与依赖
├── runtime/                  # 全局 npm 依赖
├── runtime-python/           # 全局 Python 依赖
└── script-inputs/            # 运行参数附件
```

详见 [架构说明](docs/architecture.md)。

</details>

---

## 技术栈

Electron 34 · Vue 3 · TypeScript · Tailwind CSS 4 · Playwright Core · sql.js · node-cron

---

## 文档

| 文档 | 内容 |
|------|------|
| [v1.9.0 版本说明](docs/v1.9.0.md) | 当前版本功能清单、数据目录与迁移说明 |
| [v1.0.0 版本说明](docs/v1.0.0.md) | 首个正式版基线 |
| [更新日志](docs/CHANGELOG.md) | 版本变更记录 |
| [架构说明](docs/architecture.md) | 模块职责、数据流、后续迭代方向 |
| [脚本包规范](docs/script-spec.md) | `autoforge.json` 完整字段 |

---

## FAQ

**脚本跑在沙箱里吗？** JavaScript 脚本在主进程 Node 环境运行；Python 脚本在独立子进程中运行。两者均无严格资源隔离，请只导入可信脚本。

**如何从 ScriptBox 迁移？** 旧版 `scriptbox.json` 仍可导入；v1.2+ 会自动将 JSON 数据迁移至 SQLite。

**Python 脚本需要什么？** 本机 Python 3.9+，在设置页配置路径。依赖通过 pip 安装至脚本 `.venv`。

---

## License

MIT
