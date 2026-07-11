<div align="center">

# Autoforge

### 自动化脚本散落在各处，环境配置重复录入，运行结果难以追溯——Autoforge 把它们收进一个本机桌面工作台。

[![Version](https://img.shields.io/badge/version-1.15.0-blue)](docs/v1.15.0.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[快速开始](#install) · [看示例](#see-it-work) · [脚本开发](#脚本开发) · [版本说明](docs/v1.15.0.md) · [更新日志](docs/CHANGELOG.md)

</div>

---

> [!IMPORTANT]
> **本机运行，数据留在你的电脑上。**
>
> | 关注点 | 说明 |
> |--------|------|
> | 会执行什么 | 你导入的 JS / Python 脚本；可调用 Playwright 启动浏览器 |
> | 会写哪些文件 | `%APPDATA%/autoforge-development/`（dev）或 `autoforge-production/`（安装包/preview）下的 SQLite、脚本与依赖 |
> | 会访问网络吗 | 安装 npm / pip 依赖、脚本自身请求，以及从 Hub 一键安装时下载脚本 zip；应用运行时在本机 `127.0.0.1:19276` 提供安装桥（不对外网开放） |
> | Python | 调用你本机已安装的 Python 3.9+，应用不捆绑解释器 |
> | 如何卸载 | Windows「添加或删除程序」卸载 Autoforge；删除上述 `autoforge-*` 目录可清除全部数据 |

```bash
git clone <repo-url> && cd Autoforge && npm install && npm run dev
```

---

## The Problem

写自动化脚本不难，难的是**反复配置环境、找不到上次日志、定时任务和手动运行各跑一套**。Autoforge 把脚本当作可导入的「包」统一管理：一份清单声明需要什么变量，平台负责装依赖、跑任务、记历史。

如果你用过 cron + 手写 shell 的组合，核心思路类似——区别是 Autoforge 提供了可视化界面、多环境 Profile、实时日志，以及 JavaScript / Python 双语言运行时。

---

## See It Work

导入内置示例后，在详情 Tab 点击「运行」，确认对话框后终端面板会实时输出：

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
- Windows / macOS / Linux（预构建安装包支持多平台）
- Python 3.9+（仅运行 Python 脚本时需要）

### 预构建安装包（推荐）

从 [GitHub Releases](https://github.com/Tianyu201809/autoforge/releases) 下载对应平台的安装包：

| 平台 | Release 格式 | 安装方式 |
|------|--------------|----------|
| Windows | `.zip`（内含 NSIS `.exe`） | 解压后运行 `.exe` 安装 |
| macOS | `.dmg` | 打开磁盘映像，拖入「应用程序」 |
| Linux | `.tar.gz`（内含 `.AppImage`） | 解压后赋予执行权限并运行 |

> **Windows 下载提示：** Release 以 `.zip` 发布，避免浏览器直接拦截 `.exe` 下载。

发布流程：更新 `package.json` 中的 `version` 后推送 `v*` 标签至 GitHub，CI 将自动构建并上传至 Releases。

> **macOS 未代码签名提示：** 当前 macOS 安装包未经 Apple 代码签名。首次打开时若被 Gatekeeper 拦截，请右键点击应用选择「打开」，或在 **系统设置 → 隐私与安全性** 中允许运行。

### 开发模式

```bash
git clone <repo-url>
cd Autoforge
npm install          # postinstall 自动下载 Playwright 浏览器
npm run dev
```

### 本地打包

```bash
npm run dist:win     # Windows NSIS → release/
npm run dist:mac     # macOS DMG（需在 macOS 上）
npm run dist:linux   # Linux AppImage（需在 Linux 上）
```

<details>
<summary><b>其他命令</b></summary>

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译主进程、预加载与渲染进程 |
| `npm run preview` | 预览编译产物（使用 production 数据目录） |
| `npm run prod` | build + preview 快捷组合 |
| `npm run install:browsers` | 手动安装 Playwright 浏览器 |
| `npm run generate:icons` | 从 SVG 生成应用图标 |
| `npm run dist:mac` | 打包 macOS DMG → `release/` |
| `npm run dist:linux` | 打包 Linux AppImage → `release/` |

</details>

---

## Getting Started

1. **启动应用** — `npm run dev`，或从 [GitHub Releases](https://github.com/Tianyu201809/autoforge/releases) 下载对应平台安装包（Windows `.zip`、macOS `.dmg`、Linux `.tar.gz`）；本地打包产物在 `release/`
2. **导入示例** — 开发指南 → 导入 `hello-world`
3. **填写参数** — 详情 Tab 填写运行参数，配置 Tab 设置环境变量
4. **运行** — 点击「运行」，确认后在终端面板查看日志
5. **（可选）定时** — 详情 → 定时任务，填写 Cron 表达式

Python 脚本：先在 **设置 → Python** 检测并配置解释器路径，再导入 `hello-world-py`。

---

## 功能概览

- **双语言运行时** — JavaScript（主进程）与 Python（子进程），共用 `run(ctx)` 契约
- **脚本管理** — 导入、拖拽、Hub 一键安装、分类、收藏、归档、分页、搜索与排序
- **多环境 Profile** — 开发 / 测试 / 生产等环境变量集
- **运行参数** — 文本、多类型字段与附件参数
- **运行与日志** — 一键运行 / 停止 / 重启；实时日志与进度回显
- **执行历史** — 按日汇总，点击查看详情弹窗
- **定时任务** — 六段 Cron，卡片显示执行周期
- **依赖管理** — 脚本级 + 全局 npm / pip 依赖，安装结果缓存
- **浏览器自动化** — 内置 Playwright；`ctx.sdk.browser.launch()`
- **界面** — 6 套皮肤、托盘、悬浮球、全局快捷键 `Ctrl+Shift+A`、小记面板；设置 / 执行历史 / 开发指南以居中弹窗呈现

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

1. **脚本包目录** — 包含 `autoforge.json` 的文件夹（侧边栏导入或拖拽）
2. **单文件** — `.js` / `.mjs` / `.cjs` / `.py`，平台自动包装为脚本包
3. **Autoforge Hub** — 本机已启动 Autoforge 时，在 Hub 点击「添加到本地」；桌面端从公开 zip URL 下载并导入（`127.0.0.1:19276`）

Hub 契约见 [桌面端规格](docs/superpowers/specs/2026-07-11-hub-local-install-design.md) 与 [Hub 端规格](docs/superpowers/specs/2026-07-11-hub-local-install-hub-side-design.md)。
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

**本机数据目录**（v1.10+ 按启动方式隔离）：

| 启动方式 | 目录（Windows） |
|----------|-----------------|
| `npm run dev` | `%APPDATA%/autoforge-development/` |
| 安装包 / `preview` | `%APPDATA%/autoforge-production/` |

```
autoforge-{development|production}/
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
| [v1.15.0 版本说明](docs/v1.15.0.md) | 当前版本：Hub 一键安装到本地 |
| [v1.11.0 版本说明](docs/v1.11.0.md) | 功能弹窗、UI 优化 |
| [v1.10.0 版本说明](docs/v1.10.0.md) | 数据隔离、运行确认 |
| [v1.9.0 版本说明](docs/v1.9.0.md) | 功能基线 |
| [v1.0.0 版本说明](docs/v1.0.0.md) | 首个正式版基线 |
| [更新日志](docs/CHANGELOG.md) | 版本变更记录 |
| [架构说明](docs/architecture.md) | 模块职责、数据流、后续迭代方向 |
| [脚本包规范](docs/script-spec.md) | `autoforge.json` 完整字段与 zip 分发 |

---

## FAQ

**脚本跑在沙箱里吗？** JavaScript 脚本在主进程 Node 环境运行；Python 脚本在独立子进程中运行。两者均无严格资源隔离，请只导入可信脚本。

**如何从 Hub 安装脚本？** 先启动本机 Autoforge，再在 Hub 点击「添加到本地」。桌面端须能访问 Hub 给出的公开 zip URL。详见 [v1.15.0](docs/v1.15.0.md)。

**如何从 ScriptBox 迁移？** 旧版 `scriptbox.json` 仍可导入；v1.2+ 会自动将 JSON 数据迁移至 SQLite。

**Python 脚本需要什么？** 本机 Python 3.9+，在设置页配置路径。依赖通过 pip 安装至脚本 `.venv`。

---

## License

MIT
