# Autoforge

**本机自动化脚本锻造与管理桌面应用**

Autoforge 是一个运行在 Windows 上的 Electron 桌面应用。它本身不包含任何业务逻辑，而是作为**脚本运行平台**：你把自动化脚本打包成标准目录，导入后即可在本机运行、配置环境、查看日志、设置定时任务。

---

## 核心思想

Autoforge 的设计围绕四个原则展开：

| 原则 | 含义 |
|------|------|
| **零内置脚本** | 应用只做平台，所有业务脚本由用户导入，可插拔、可替换 |
| **脚本即包** | 每个脚本是一个独立目录：`autoforge.json` 清单 + 入口文件 + 可选 npm 依赖 |
| **配置与代码分离** | 脚本声明「需要什么变量」（schema），具体值由环境 Profile 与运行参数提供 |
| **生命周期可观测** | 每次运行有明确阶段，日志实时推送，结果可追溯 |

### 环境变量 vs 运行参数

这是 Autoforge 最重要的概念区分：

| | **环境变量 `env`** | **运行参数 `params`** |
|---|---|---|
| 用途 | 固定环境配置：账号、Token、API 地址 | 业务输入：订单号、日期范围、任务 ID |
| 变化频率 | 按环境（开发/测试/生产）长期固定 | 每次运行可能不同 |
| 配置位置 | 脚本详情 → **配置** Tab | 脚本详情 → **详情** Tab |
| 脚本内访问 | `ctx.env.KEY` | `ctx.params.KEY` |

**选用原则：** 换环境才变的值放 `env`；每次任务才变的值放 `params`。

---

## 功能概览

- **脚本管理** — 导入脚本包目录或单文件（`.js` / `.mjs` / `.cjs`），支持拖拽导入、自定义分类、收藏、归档、搜索与排序
- **在线编辑** — 在应用内直接编辑入口代码与 `autoforge.json`
- **多环境 Profile** — 开发 / 测试 / 生产等环境变量集，脚本按环境独立配置
- **运行参数** — 文本参数与附件参数（`type: "attachment"`），支持多文件上传
- **运行与日志** — 一键运行、停止、重启；实时日志面板；运行结果展示
- **执行历史** — 按日汇总运行记录，支持搜索与状态统计（保留 90 天）
- **定时任务** — 基于 Cron 表达式（六段式：秒 分 时 日 月 周）自动触发
- **依赖管理** — 脚本级 npm 依赖（首次运行自动安装）+ 全局共享依赖
- **浏览器自动化** — 内置 Playwright 浏览器 bundle；脚本级无头模式；`ctx.sdk.browser.launch()` 启动
- **窗口模式** — 托盘常驻、桌面悬浮球、全局快捷键 `Ctrl+Shift+A`、浅色/深色主题
- **示例与开发指南** — 内置示例脚本与脚本开发规范文档

---

## 技术栈

- **桌面框架**：Electron 34 + electron-vite
- **前端**：Vue 3 + TypeScript + Tailwind CSS 4
- **脚本运行时**：Node.js ESM 动态加载（`import()`）
- **浏览器自动化**：Playwright Core
- **定时调度**：node-cron

---

## 快速开始

### 环境要求

- Node.js 18+
- Windows x64（当前主要目标平台）

### 安装与开发

```bash
# 克隆仓库
git clone <repo-url>
cd Autoforge

# 安装依赖（postinstall 会自动下载 Playwright 浏览器）
npm install

# 启动开发模式
npm run dev
```

### 构建与打包

```bash
# 编译
npm run build

# 预览编译产物
npm run preview

# 打包 Windows 安装程序（NSIS）
npm run dist:win
```

安装包输出目录：`release/`。

---

## 脚本开发

### 最小脚本包

```
my-script/
├── autoforge.json
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

### run(ctx) 上下文

```typescript
interface ScriptRunContext {
  sessionId: string
  scriptId: string
  env: Record<string, string>      // 合并后的环境变量
  params: Record<string, string>   // 本次运行的业务参数
  signal: AbortSignal              // 用户停止时 abort
  log: (level, message) => void
  sdk: {
    browser: { launch: () => Promise<Browser> }
    paths: { userData: string; scriptDir: string }
  }
}
```

### 导入方式

1. **脚本包目录** — 包含 `autoforge.json` 的文件夹
2. **单文件** — `.js` / `.mjs` / `.cjs`，平台会自动包装为脚本包

### 内置示例

| 示例 | 说明 |
|------|------|
| `examples/hello-world/` | 最小可运行示例，演示 `env` 与 `params` 区分 |
| `examples/hello-scriptbox/` | 兼容旧版 ScriptBox 清单格式 |

应用内可通过 **开发指南** 面板一键导入示例并阅读完整规范。

---

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer (Vue 3)                      │
│  Sidebar · ScriptCard · DetailPanel · LogConsole · …   │
└────────────────────────┬────────────────────────────────┘
                         │ IPC
┌────────────────────────▼────────────────────────────────┐
│                    Main Process                          │
│  script-workspace  script-registry  script-store         │
│  script-runner     dependency-manager  script-sdk          │
│  scheduler         category-service  browser-path        │
└────────────────────────┬────────────────────────────────┘
                         │ dynamic import
┌────────────────────────▼────────────────────────────────┐
│              用户脚本包 (userData/scripts/{id}/)          │
│  autoforge.json · index.mjs · node_modules/             │
└─────────────────────────────────────────────────────────┘
```

### 执行生命周期

```
queued → validating → installing-deps → starting → running → completed
                                                      ↘ failed
                                                      ↘ stopped（用户取消）
```

### 本机数据目录

```
userData/
├── autoforge.db              # SQLite：脚本注册表、环境、分类、配置、执行历史
├── script-inputs/            # 运行参数附件缓存
├── scripts/
│   └── {scriptId}/
│       ├── autoforge.json
│       ├── index.mjs
│       ├── package.json      # 依赖安装时自动生成
│       └── node_modules/
└── runtime/
    ├── package.json          # 全局共享依赖
    └── node_modules/
```

---

## 项目结构

```
Autoforge/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts          # 应用入口
│   │   ├── db/               # SQLite 持久化层
│   │   ├── ipc/handlers.ts   # IPC 路由
│   │   └── services/         # 核心业务服务
│   ├── preload/              # 预加载桥接（contextBridge）
│   ├── renderer/             # Vue 前端
│   └── shared/               # 主进程与渲染进程共享类型与契约
├── examples/                 # 内置示例脚本包
├── docs/                     # 架构说明与脚本开发规范
├── scripts/                  # 构建辅助脚本
├── build/                    # 应用图标等资源
└── resources/browsers/       # 打包的 Playwright 浏览器
```

---

## 常用 npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（热更新） |
| `npm run build` | 编译主进程、预加载与渲染进程 |
| `npm run dist:win` | 生成 Windows 安装包 |
| `npm run install:browsers` | 手动安装 Playwright 浏览器 |
| `npm run generate:icons` | 从 SVG 生成应用图标 |

---

## 文档

- [v1.0.0 版本说明](docs/v1.0.0.md) — 正式版功能清单、数据目录与迁移说明
- [更新日志](docs/CHANGELOG.md) — 版本变更记录
- [架构说明](docs/architecture.md) — 模块职责、数据流、后续迭代方向
- [脚本开发规范](docs/Autoforge脚本开发规范文档说明.md) — `autoforge.json` 完整字段说明

---

## 许可证

MIT
