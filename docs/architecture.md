# Autoforge 架构说明

> 当前应用版本：**1.42.0** · 详见 [v1.42.0 版本说明](./v1.42.0.md)

## 设计原则

1. **零内置脚本**：应用本身不包含任何业务脚本，所有脚本均为用户上传的可插拔包
2. **脚本即包**：每个脚本是一个独立目录，包含 `autoforge.json` 清单 + 入口文件 + 可选依赖
3. **环境分离**：脚本声明需要哪些变量（schema），具体值由「环境 Profile」提供
4. **生命周期可观测**：每次运行有明确的阶段（校验 → 装依赖 → 启动 → 运行 → 完成/失败），日志与进度实时推送

## 应用运行环境与 userData

| `AppEnv` | 启动方式 | userData 目录（Windows） |
|----------|----------|--------------------------|
| `development` | `npm run dev` | `%APPDATA%/autoforge-development/` |
| `production` | `npm run build` / `preview` / 安装包 | `%APPDATA%/autoforge-production/` |

旧版 `%APPDATA%/autoforge/` 扁平布局在首次启动 v1.10+ 时作为迁移源，复制到上述目录并重写库内绝对路径。模块：`app-data-root.ts`。

## 目录结构

```
userData/                     # autoforge-development 或 autoforge-production
├── autoforge.db              # SQLite：脚本注册表、环境、分类、配置、执行历史、小记
├── *.migrated.bak            # 旧版 JSON 迁移备份（如有）
├── script-inputs/            # 运行参数附件缓存
├── scripts/
│   └── {scriptId}/
│       ├── autoforge.json    # 脚本清单（元数据 + env/params schema + 依赖）
│       ├── index.mjs | index.py
│       ├── package.json      # JS 依赖（运行时自动生成）
│       ├── node_modules/     # JS 脚本级 npm 依赖
│       └── .venv/            # Python 脚本级 pip 依赖
├── runtime/
│   ├── package.json          # 全局共享 npm 依赖
│   └── node_modules/
└── runtime-python/
    └── .venv/                # 全局共享 Python 依赖
```

## 核心模块

| 模块 | 职责 |
|------|------|
| `app-data-root` | 按 `AppEnv` 配置 userData 路径；旧数据迁移、路径重写与修复 |
| `db` | SQLite 持久化（sql.js WASM、防抖写入、临时文件原子替换） |
| `script-workspace` | 脚本包的导入、存储、读写 |
| `script-registry` | 脚本 CRUD，对接 store |
| `script-store` | 持久化：脚本元数据、环境 Profile、应用配置（含小记、超时、Python 路径） |
| `environment-repository` | 环境 Profile 读写、变量加解密、明文迁移与不可读记录保护 |
| `script-runner` | 执行引擎：JS `utilityProcess` 宿主、Python 子进程分流；同脚本多实例并发（≤5）与 `startBatch` |
| `script-host` | 在 Electron `utilityProcess` 中加载 JS 入口，向主进程传递运行事件 |
| `python-script-runner` | spawn Python 子进程、stdout 协议解析、取消与超时 |
| `python-resolver` | 解释器路径解析、版本检测、`autoforge_runtime` 根目录 |
| `python-dependency-manager` | 脚本 `.venv`、pip install、requirements 生成 |
| `python-isolated-env` | Python 子进程隔离环境变量（UTF-8、PYTHONPATH 等） |
| `executable-inspector` | 按文件头识别 PE / Mach-O / ELF、判断主程序候选与目标平台 |
| `executable-package-discovery` | 扫描无清单来源，返回零个、一个或多个原生入口候选 |
| `executable-script-runner` | 原生子进程环境变量构建、执行位修复、启动、输出采集与进程树终止 |
| `executable-trust-store` | 按 `scriptId + 入口路径 + SHA-256` 持久化原生程序运行授权 |
| `script-package-exporter` | 导出计划与 ZIP 写出：JS / Python 静态依赖收集、`executable` 整目录打包、安全过滤与 500 MB 上限 |
| `execution-history` | 运行记录持久化、按日查询、详情弹窗、重启后 reconcile |
| `script-param-inputs` | 运行参数附件 staging 与缓存清理 |
| `dependency-manager` | 依赖安装门面：按 `language` 委托 npm 或 pip |
| `script-deps-cache` | 依赖 lock 文件，跳过未变更的重复安装 |
| `script-sdk` | 向 JS 脚本注入 browser、paths 等能力 |
| `browser-path` | Playwright 浏览器路径解析与 launch 策略（JS / Python 共用配置） |
| `scheduler` | Cron 定时触发 |
| `category-service` | 内置与自定义分类管理（邻接表树，任意深度） |
| `shared/category-tree` | 分类建树、子孙收集、环检测、递归计数 |
| `shared/instance-slots` | 多实例槽规范化与上限校验 |
| `main-window-mode` | 托盘、悬浮球、全局快捷键等窗口模式 |
| `floating-ball-window` | 悬浮球独立窗口与拖放定位 |
| `terminal-window` | 独立终端日志窗口 |
| `log-bus` / `script-lifecycle` | 日志广播与生命周期事件 |
| `hub-bridge-server` | 本机 HTTP 桥（`127.0.0.1:19276`）：`/health`、`/install`、CORS、安装锁 |
| `hub-script-installer` | Hub zip 下载、解压、定位 `autoforge.json` 包根、调用 registry 导入 |
| `hub-credential-store` | 主进程保存和清理 Hub 凭据；隔离 token 访问，向渲染进程提供脱敏账户信息 |
| `hub-client` | 调用 Hub 登录、脚本列表、搜索和分类接口；统一处理 `q`、`category`、分页与错误状态 |
| `HubPluginCenterPanel` | 原生脚本中心 UI：插件市场、我的脚本、团队脚本、详情 Markdown、安装/更新操作 |
| `mcp-control-server` | 本地 Named Pipe / Unix Socket 控制面、握手、认证、请求路由与连接限制 |
| `mcp/control-client` | MCP adapter 到主进程的 descriptor 发现、握手和断线重连 |
| `mcp/tool-definitions` / `resource-definitions` | Agent 工具、只读 Resources、结果封装和错误转换 |
| `run-event-store` / `mcp-audit` | session 快照、增量日志、终态等待和脱敏审计 |

## Hub 一键安装数据流

```
Hub 网页
    └─ POST 127.0.0.1:19276/install { hubScriptId, installToken }
        └─ hub-bridge-server 校验 Origin 和请求体
            └─ 按设置中的 Hub 源构造下载 URL
                └─ hub-script-installer 下载并核对 X-Autoforge-Sha256
                    └─ 解压 → scriptRegistry.importFromPath()
                        └─ showMainWindow + EVENT_HUB_SCRIPT_INSTALLED

脚本中心
    └─ hub-client 申请安装令牌与期望 SHA-256
        └─ 下载并同时核对内容哈希、响应头和令牌响应
            └─ 解压 → scriptRegistry.importFromPath()
```

本机桥只接受来自已配置 Hub 源的浏览器请求。网页请求不再携带下载地址，Hub 一次性安装令牌有效期为 120 秒。校验失败时删除临时下载，不进入解压和导入流程。完整契约见 [v1.42.0 P0 实施设计](./superpowers/specs/2026-11-06-p0-bridge-runner-storage-design.md)。

## 执行生命周期

```
queued → validating → installing-deps → starting → running → completed
                                                      ↘ error（脚本错误 / 超时）
                                                      ↘ stopped（用户主动停止）
```

运行超时由 `AppConfig.script.runTimeoutSeconds` 控制（设置 → Python → 运行超时），`0` 表示不限制。

## 数据流

### JavaScript

```
用户选择环境 Profile
    ↓
scriptStore.resolveEnvForScript(script, envId)
    ↓ 合并 schema 默认值 + Profile 变量
scriptStore.validateEnvForScript()
    ↓
scriptRunner.executeJsPackage()
    ↓ utilityProcess.fork(script-host)
script-host 动态导入入口 → resolveScriptEntryFn(run | main | default)
    ↓ 宿主消息
主进程更新会话、日志、阶段和进度 → UI
```

### Python

```
（同上 env 解析与校验）
    ↓
scriptRunner.executePythonPackage()
    ↓ resolvePythonExecutable() + PythonDependencyManager
spawn(python, -m autoforge_runtime, ...)
    ↓ stdout 行协议（@autoforge/ctl）
run(ctx) → log / stage / progress / result → UI
```

JS 与 Python 共用 `shared/script-progress.ts` 定义的进度类型。JS 的 `AbortSignal` 在宿主进程内创建，停止时主进程发送 `abort` 并等待 1000 ms，之后仍未退出则终止宿主及已上报的浏览器进程。Python 通过终止子进程取消运行。

### 原生程序

```
（同上 env 解析与校验）
    ↓
校验入口路径、普通文件、非符号链接、工作区边界
    ↓ executable-inspector 重新识别文件头与当前平台
executable-trust-store 校验 SHA-256 授权
    ↓ 未授权且 interactive 时 awaiting-confirmation
spawn(entry, [], { cwd: scriptDir, shell: false })
    ↓ env 注入 AUTOFORGE_PARAM_* / AUTOFORGE_PARAMS_JSON
stdout / stderr 增量分行 → 日志总线 → UI
```

原生程序不实现 `run(ctx)`，不使用控制协议，输入统一通过环境变量传递。停止与超时终止整个进程树。

## 脚本导出数据流

```
脚本卡片「导出 ZIP」
    ↓
buildScriptExportPlan(script, manifest)
    ├─ javascript / python：入口递归静态依赖 + export.include + 扩展名白名单
    └─ executable：校验清单与入口 → 遍历整个工作区根目录（不解析二进制，忽略 export.include）
    ↓ 路径规范化、工作区边界、非符号链接、按语言强制排除、500 MB 上限
预览确认 → 保存对话框
    ↓
writeScriptExportZip()（复用同一套语言相关校验）
    ↓
返回文件名、文件数与总大小
```

两个分支的排除集合不同：源码脚本额外排除 `.json`、数据库、表格、日志、压缩包和 `dist`/`release` 等构建目录；原生包只排除依赖与缓存目录、`.autoforge-*` 内部文件、`.env` 系列和 `.pem`/`.key`/`.p12`/`.pfx`/`.crt`/`.cer` 凭据文件。

导出计划与写盘阶段共享 `assertSafeFile`，预览通过的文件集合与最终落盘内容一致。导出不携带原生程序的信任记录，目标机器首次运行仍须重新授权。

## Hub 授权与脚本中心数据流

```
Autoforge 渲染进程
    └─ preload.loginHub()
        └─ 主进程生成 state + PKCE
            └─ 系统浏览器打开 Hub 授权页
                └─ 127.0.0.1:19276/auth/callback
                    └─ 校验 state / code / PKCE
                        └─ hub-credential-store 保存凭据
                            └─ 返回脱敏账户信息

脚本中心
    └─ hub-client.listScripts({ scope, q, category, page })
        └─ Hub 返回 distributions.category 与脚本元数据
            └─ 卡片/详情渲染 README（markdown-it → DOMPurify）
                └─ hub-bridge-server /install
                    └─ hub-script-installer 导入 registry
                        └─ EVENT_HUB_SCRIPT_INSTALLED
                            └─ 主页面刷新并选中新脚本
```

授权回调只接受本机回环请求；凭据不通过页面脚本直接持有。脚本安装完成事件由主进程广播，保证脚本中心和主页面共享最新 registry 状态。

## 已交付能力（截至 v1.42.0）

| 能力 | 模块 / 入口 |
|------|-------------|
| 无限嵌套分类树 | `category-service` / `category-tree` · v1.20+ `parent_id` |
| 单脚本多实例批量 | `instance-slots` / `script-runner.startBatch` · v1.20+ 槽 ≤5、并发 ≤5 |
| Hub 一键安装到本地 | `hub-bridge-server` / `hub-script-installer` · v1.15+ `127.0.0.1:19276` |
| Hub 安装来源和包校验 | Hub 一次性令牌、Origin 校验、SHA-256 端到端核对 |
| AutoforgeHub 入口 | `AppConfig.hub` · 设置 + 侧边栏 · v1.19+ |
| 多平台 GitHub Releases | `.github/workflows/release.yml` · v1.14+ |
| 开发 / 生产数据隔离 | `app-data-root` · v1.10+ 独立 userData 目录 |
| SQLite 持久化 | `db` · v1.2+ 自 JSON 自动迁移；v1.42+ 防抖写入与原子替换 |
| JavaScript 脚本 | `script-runner` / `script-host` · v1.42+ 独立 `utilityProcess`，支持停止和超时终止 |
| 环境变量加密 | `environment-repository` / `safeStorage` · v1.42+ 加密保存并迁移旧明文 |
| Python 脚本 | `python-script-runner` · 子进程 + `autoforge_runtime` |
| 原生可执行程序 | `executable-inspector` / `executable-script-runner` / `executable-trust-store` · v1.27+ PE / Mach-O / ELF，SHA-256 运行授权 |
| 脚本包 ZIP 导出 | `script-package-exporter` · 卡片「导出 ZIP」；v1.31+ 原生包整目录打包，上限 500 MB |
| 多类型 schema | `script-contract` · env/params：`text`、`textarea`、`number`、`select`、`radio`、`checkbox`、`boolean`、`attachment` |
| 参数按环境绑定 | `script-store` · `paramsByEnv` |
| 运行进度回显 | `script-progress` · `ctx.stage()` / `ctx.progress()` |
| 运行超时 | `script-runner` · 设置 → 运行超时（秒） |
| 依赖安装缓存 | `script-deps-cache` · lock 文件跳过重复安装 |
| 全局 npm / pip 依赖 | `dependency-manager` · 设置 → 全局依赖 / Python 依赖 |
| 执行历史 | `execution-history` · 侧边栏；点击条目详情弹窗 |
| 附件参数 | `script-param-inputs` · 详情 Tab |
| 自定义分类 | `category-service` · 侧边栏「管理分类」 |
| 拖拽导入 | `preload/script-drop` · 主窗口拖放 |
| 脚本列表分页 | `useScriptStore` · 每页 12 条 |
| 分类筛选规则 | `useScriptStore` · 选择分类时基于全部脚本，不叠加运行状态、收藏、定时或归档筛选 |
| 按上传时间排序 | `script-registry` · 列表排序选项 |
| 脚本无头模式 | `browser-path` · 详情概览 / `autoforge.json` |
| 浏览器自动化 | `script-sdk` / Python `context.py` · Playwright |
| 托盘 / 悬浮球 / 快捷键 | `main-window-mode` · `floating-ball-window` · 设置 |
| 多皮肤主题 | `useTheme` · 6 套深浅预设 |
| 小记面板 | `useScratchpad` · 标题栏；存入 `AppConfig.scratchpad` |
| 脚本开发 Skill | `skills/autoforge-script-create/` · 随安装包分发 |
| 规范文档下载 | 开发指南 · `script-spec.md` Markdown 导出 |
| 入口函数别名 | `resolveScriptEntryFn` · `run` / `main` / `default`（JS） |
| 运行二次确认 | `useConfirmDialog` · 详情面板与卡片快捷运行 |
| 功能弹窗 | `AppFeatureModal` · 设置 / 执行历史 / 开发指南居中模态 |
| 本地 MCP 控制 | `mcp-control-server` / `mcp` · Agent 查询、运行、编辑脚本与环境；默认关闭 |

## 还需关注的能力（后续迭代）

| 能力 | 说明 | 优先级 |
|------|------|--------|
| JS 权限沙箱 | JS 已移至 `utilityProcess`，但脚本仍可访问本机文件和网络 | 高 |
| 脚本包版本管理 | 脚本包版本历史、回滚 | 中 |
| 导入校验 UI | 上传前预览 manifest、依赖冲突 | 中 |
| 并发限制 | 同一脚本 / 全局最大并发数 | 中 |
| 脚本模板 | 应用内脚手架一键创建新脚本 | 中 |
| 脚本中心离线浏览 | 脚本中心需要联网；无网络时不缓存已浏览过的列表与详情 | 低 |
| Hub 脚本去重更新 | 按 `hubScriptId` 覆盖已安装脚本的更新策略 | 中 |

## 迁移说明

首次启动 v1.2+ 时，若存在旧版 JSON 数据（`autoforge-data.json` / `script-box-data.json` / `execution-history.json`），会自动导入 `autoforge.db` 并将原文件重命名为 `*.migrated.bak`。

旧版 ScriptBox 清单（`scriptbox.json`）仍可导入，保存后会写入 `autoforge.json`。

## 相关文档

| 文档 | 内容 |
|------|------|
| [v1.42.0 版本说明](./v1.42.0.md) | 当前版本（安装校验、JS 宿主进程、SQLite 原子落盘与环境变量加密） |
| [v1.36.0 版本说明](./v1.36.0.md) | 分类筛选规则优化 |
| [v1.35.0 版本说明](./v1.35.0.md) | 插件中心并发安装、分栏缓存与界面主题优化 |
| [v1.31.0 版本说明](./v1.31.0.md) | 原生脚本导出 ZIP、500 MB 导出上限 |
| [v1.30.0 版本说明](./v1.30.0.md) | Hub 授权、脚本中心、搜索筛选、一键安装、账户设置 |
| [v1.27.0 版本说明](./v1.27.0.md) | 原生可执行程序导入、运行授权与进程托管 |
| [v1.26.0 版本说明](./v1.26.0.md) | 脚本分页跳转、文本输入路径拖入 |
| [v1.24.0 版本说明](./v1.24.0.md) | 本地 MCP、Agent 接入与安全控制 |
| [MCP 使用文档](./mcp.md) | 客户端配置、Token、安全与工具范围 |
| [v1.20.0 版本说明](./v1.20.0.md) | 分类树、多实例批量 |
| [v1.19.0 版本说明](./v1.19.0.md) | AutoforgeHub 入口 |
| [v1.15.0 版本说明](./v1.15.0.md) | Hub 一键安装 |
| [v1.11.0 版本说明](./v1.11.0.md) | 功能弹窗、UI 优化 |
| [v1.10.0 版本说明](./v1.10.0.md) | 数据隔离、运行确认 |
| [v1.9.0 版本说明](./v1.9.0.md) | 功能基线 |
| [CHANGELOG](./CHANGELOG.md) | 版本变更记录 |
| [脚本包规范](./script-spec.md) | `autoforge.json` 与 zip 分发 |
| [v1.42.0 P0 实施设计](./superpowers/specs/2026-11-06-p0-bridge-runner-storage-design.md) | 当前安装桥、JS 宿主、数据库落盘与环境变量加密契约 |
| [Hub 安装 · 桌面端历史规格](./superpowers/specs/2026-07-11-hub-local-install-design.md) | v1.15 初版契约，安装请求已由 v1.42.0 规格取代 |
| [Hub 安装 · Hub 端历史规格](./superpowers/specs/2026-07-11-hub-local-install-hub-side-design.md) | v1.15 初版契约，安装请求已由 v1.42.0 规格取代 |
