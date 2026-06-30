# Autoforge 架构说明

## 设计原则

1. **零内置脚本**：应用本身不包含任何业务脚本，所有脚本均为用户上传的可插拔包
2. **脚本即包**：每个脚本是一个独立目录，包含 `autoforge.json` 清单 + 入口文件 + 可选依赖
3. **环境分离**：脚本声明需要哪些变量（schema），具体值由「环境 Profile」提供
4. **生命周期可观测**：每次运行有明确的阶段（校验 → 装依赖 → 启动 → 运行 → 完成/失败）

## 目录结构

```
userData/
├── autoforge.db              # SQLite：脚本注册表、环境、分类、配置、执行历史
├── autoforge-data.json.migrated.bak       # 旧版 JSON 迁移备份（如有）
├── execution-history.json.migrated.bak  # 旧版 JSON 迁移备份（如有）
├── script-inputs/            # 运行参数附件缓存
├── scripts/
│   └── {scriptId}/
│       ├── autoforge.json    # 脚本清单（元数据 + env schema + 依赖）
│       ├── index.mjs         # 入口（必须 export run）
│       ├── package.json      # 运行时自动生成（依赖安装时）
│       └── node_modules/     # 脚本级依赖
└── runtime/
    ├── package.json          # 全局共享依赖
    └── node_modules/         # 所有脚本可访问
```

## 核心模块

| 模块 | 职责 |
|------|------|
| `db` | SQLite 持久化（sql.js WASM，无需 native 编译） |
| `script-workspace` | 脚本包的导入、存储、读写 |
| `script-registry` | 脚本 CRUD，对接 store |
| `script-store` | 持久化：脚本元数据、环境 Profile、偏好（SQLite repository） |
| `script-runner` | 执行引擎：生命周期、动态加载、上下文注入 |
| `execution-history` | 运行记录持久化、按日查询、重启后 reconcile（SQLite） |
| `script-param-inputs` | 运行参数附件 staging 与缓存清理 |
| `dependency-manager` | npm install（脚本级 / 全局级） |
| `script-sdk` | 向脚本注入 browser、paths 等能力 |
| `browser-path` | Playwright 浏览器路径解析与 launch 策略 |
| `scheduler` | Cron 定时触发 |
| `category-service` | 内置与自定义分类管理 |
| `main-window-mode` | 托盘、悬浮球、全局快捷键等窗口模式 |
| `floating-ball-window` | 悬浮球独立窗口与拖放定位 |

## 执行生命周期

```
queued → validating → installing-deps → starting → running → completed
                                                      ↘ failed
                                                      ↘ stopped (用户取消)
```

## 数据流

```
用户选择环境 Profile
    ↓
scriptStore.resolveEnvForScript(script, envId)
    ↓ 合并 schema 默认值 + Profile 变量
scriptStore.validateEnvForScript()
    ↓
scriptRunner.executePackage()
    ↓ dynamic import(entry)
run(ctx) → 日志/结果 → UI
```

## v1.0.0 已交付能力

| 能力 | 模块 / 入口 |
|------|-------------|
| 执行历史 | `execution-history` · 侧边栏「执行历史」 |
| 附件参数 | `script-param-inputs` · 详情 Tab |
| 自定义分类 | `category-service` · 侧边栏「管理分类」 |
| 拖拽导入 | `preload/script-drop` · 主窗口拖放 |
| 脚本无头模式 | `browser-path` · 详情概览 / `autoforge.json` |
| 托盘 / 悬浮球 / 快捷键 | `main-window-mode` · `floating-ball-window` · 设置 |

## 还需关注的能力（后续迭代）

| 能力 | 说明 | 优先级 |
|------|------|--------|
| 脚本沙箱 | 子进程隔离，限制 fs/network | 高 |
| 脚本包版本管理 | 脚本包版本历史、回滚 | 中 |
| 导入校验 UI | 上传前预览 manifest、依赖冲突 | 中 |
| 脚本市场 | 远程下载脚本包 | 低 |
| 密钥保险库 | secret 类型变量加密存储 | 高 |
| 并发限制 | 同一脚本/全局最大并发数 | 中 |
| 超时控制 | 单次运行最大时长 | 中 |
| 脚本模板 | 脚手架一键创建新脚本 | 中 |

## 迁移说明

首次启动 v1.2+ 时，若存在旧版 JSON 数据（`autoforge-data.json` / `script-box-data.json` / `execution-history.json`），会自动导入 `autoforge.db` 并将原文件重命名为 `*.migrated.bak`。

旧版 ScriptBox 清单（`scriptbox.json`）仍可导入，保存后会写入 `autoforge.json`。
