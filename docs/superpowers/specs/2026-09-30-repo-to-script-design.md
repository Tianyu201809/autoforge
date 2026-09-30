# 从 GitHub / Gitee 仓库导入并转换为脚本包 — 设计规格

**日期**：2026-09-30  
**状态**：已实现（路径 A 首版 v1.38.0 起；同日追加 git / SSH 拉取支持；随后追加路径 B 应用内 LLM 引擎）  
**关联**：`docs/script-spec.md`（脚本包规范）、`skills/repo-to-autoforge/SKILL.md`（转换技能，两条路径共用）

---

## 1. 背景与目标

Autoforge 目前的导入能力只覆盖**本机已有产物**：文件对话框、拖拽、内置示例、Hub 一键安装。用户手上大量可复用的自动化能力其实已经在 GitHub / Gitee 上以仓库形式存在，但仓库形态（库、CLI、Web 服务、monorepo）与 Autoforge 的脚本包契约（`autoforge.json` + `run(ctx)` 入口）之间存在落差，需要人工改造。

**目标**：在应用内提供「从仓库导入」入口，把仓库拉取到本机转换工作区，产出结构化仓库画像，并借助 AI（外部 Agent 经 MCP + `repo-to-autoforge` 技能）把仓库改造为可直接导入运行的 Autoforge 脚本包。地址输入支持 HTTPS 与 SSH 两种形态，覆盖 GitHub 与 Gitee。

**非目标（首版不做）**：

- 应用内直连大模型（路径 B）——见 §10
- 自动执行仓库中的任何代码（不装依赖、不跑构建、不跑测试）
- 自动生成适配代码（首版由 AI/Agent 完成，应用只负责拉取、画像、工作区与导入）
- 仓库版本追踪与增量更新（不自动跟随上游 commit）
- 代理配置界面（依赖 Electron 网络栈的系统代理）

---

## 2. 已确认决策

| 项 | 选择 | 理由 |
|----|------|------|
| 改动范围 | 主进程 + preload + 渲染进程 + 技能 | 全链路自洽 |
| AI 来源 | **两条路径并存**：① 委托外部 Agent（MCP + Skill）；② 应用内 LLM 引擎（OpenAI 兼容接口） | 路径 A 零成本零配置；路径 B 让没有 Agent 的用户也能一键转换，且共用同一份 `SKILL.md` |
| LLM 配置 | 独立设置分区，支持**多套配置**与切换，API Key 走独立凭据存储（safeStorage 加密） | 用户可能同时有 DeepSeek / 通义 / 自建网关，需要按任务切换 |
| 模型输出 | 约束为结构化 `ConversionPlan`，由主进程校验并写盘 | 不让模型直接写文件，路径与内容都可校验 |
| 构建执行 | 需**双重授权**（全局开关 + 每次转换勾选），命令走白名单 + 元字符校验 | 执行构建等于运行仓库作者代码，必须显式同意 |
| 拉取方式 | **按托管方分流**：GitHub 归档 zip；Gitee 与 SSH 地址走 `git clone --depth 1` | Gitee 公开归档端点已失效（详见 §2.1），且 SSH 地址只能经 git 拉取 |
| 地址形态 | 支持 `https://`、`git@host:owner/repo.git`、`ssh://git@host/owner/repo.git`、`/tree/<ref>` | 用户习惯直接复制平台上的克隆地址 |
| 私仓鉴权 | GitHub 支持访问令牌（归档 Bearer / git `http.extraHeader`）；Gitee 依赖本机 SSH 密钥或 git 凭据管理器 | 只实现可验证的鉴权方案，不臆造未验证的协议 |
| 网络代理 | 归档走 `electron.net.fetch`（跟随系统代理）；git clone 走系统 git 配置 | 免自建代理实现，覆盖国内访问 GitHub 场景 |
| 导入前置 | 必须通过 `validatePackageDirectory` 校验 | 复用既有契约，不引入第二套校验 |
| 产物目录 | 固定为 `<workspace>/.autoforge/package/` | 约定优于配置，Agent 与 UI 共享同一路径 |
| 是否自动跑 | **不自动运行**；导入后由用户点「运行」 | 第三方代码执行须用户显式确认 |

### 2.1 为什么 Gitee 必须走 git

实现首版时 Gitee 使用 `https://gitee.com/{owner}/{repo}/repository/archive/{ref}.zip`，实测结论（2026-09-30）：

| 端点 | 结果 |
|------|------|
| `repository/archive/master.zip` | 404（该仓库默认分支是 `main`） |
| `repository/archive/main.zip` | **200 但返回 HTML**（Gitee 前端页面），不是 zip |
| `{owner}/{repo}/archive/main.zip` | 404 |
| `api/v5/repos/{o}/{r}/zipball` | **401**，公开仓库也要求登录态 |

即 Gitee 已不再提供可匿名访问的归档下载。同时默认分支不可假定为 `master`（Gitee 新仓库默认 `main`）。因此 Gitee 统一走 `git clone`，默认分支由 git 自行解析，顺带解决分支猜测问题。

GitHub 侧不受影响：`archive/HEAD.zip` 会 302 到 codeload 并解析为 commit，`archive/{ref}.zip` 直接可用。

---

## 3. 架构与数据流

```
渲染进程 RepoImportModal
    │ preload api.repo.fetch({ url, ref?, token? })
    ▼
IPC repo:fetch ──► repo-conversion-service
    ├─ repo-url.parseRepoUrl()          解析 owner/repo/ref/transport/cloneUrl
    ├─ repo-workspace.prepareRepoWorkspace()   建工作区
    ├─ repo-fetcher.fetchRepo()         按策略路由：
    │     ├─ GitHub  ──► 归档 zip 下载 + 安全解压 + 剥离顶层目录
    │     │               （失败且本机有 git 时回退 git clone）
    │     └─ Gitee / SSH ──► git clone --depth 1（需本机 git）
    ├─ repo-analyzer.analyzeRepoDirectory()     产出 RepoProfile（含 commit 与拉取方式）
    ├─ writeWorkspaceProfile()          写 .autoforge/profile.json
    └─ writeWorkspaceHandoff()          写 .autoforge/HANDOFF.md
    │ 进度事件 event:repo-convert-progress（phase 驱动）
    ▼
渲染进程展示画像 + 交接提示词
    │ 用户复制提示词 → 外部 Agent（Codex / Claude / Cursor）
    ▼
Agent 读取 HANDOFF.md，把脚本包写入 .autoforge/package/
    │
    ▼
IPC repo:import ──► detectPackageRoot + validatePackageDirectory
    └─ scriptRegistry.importFromPath() → 落库 → 选中脚本 → 用户点运行
```

关键点：**应用从不执行仓库代码**。拉取是纯文件操作（`git clone` 只做检出，不跑钩子之外的任何仓库逻辑），转换是 Agent 的职责，执行由用户在既有运行确认流程里触发。

---

## 4. 仓库画像与可转换性分级

`repo-analyzer` 对解压后的目录做有界遍历（最多 6000 文件 / 8 层深度，跳过 `.git`、`node_modules`、`.venv`、`dist`、`build` 等依赖与产物目录），产出 `RepoProfile`：

| 字段 | 说明 |
|------|------|
| `languages` | 按字节排序的语言分布（扩展名映射） |
| `manifests` | 识别到的依赖清单文件 |
| `entryCandidates` | `package.json` 的 `main`/`bin` + 常见入口文件名 |
| `runtimeDependencies` | npm `dependencies` + pip（requirements / pyproject）合并去重 |
| `hasBuildScript` | `scripts.build`、打包器配置、或 `tsconfig` + TS 源码 |
| `hasWebServer` | Web 框架依赖，或 `scripts.start` 匹配 server 语义 |
| `hasMonorepo` | `workspaces`、`pnpm-workspace.yaml`、`lerna.json`、`nx.json` |
| `hasNativeBinary` | 出现 `.exe`/`.dll`/`.so`/`.dylib` 等扩展名 |
| `license` | 读取 `LICENSE*` 前 8 KB 做特征匹配 |
| `risks` | 风险列表，UI 原样展示 |
| `convertibility` / `convertibilityReason` | 分级结论与理由 |

**分级规则（按优先级短路）**：

```
识别到 Web 服务依赖                  → unsupported
无 JS/Python 源码 且 有原生二进制     → unsupported
无 JS/Python 源码                    → unsupported
monorepo / workspace                 → needs-build
需要构建（TS / 打包器）              → needs-build
无入口候选                           → wrappable
文件 ≤12 且 依赖 ≤3                  → direct
其余                                 → wrappable
```

分级是**启发式提示，不是结论**。`HANDOFF.md` 与技能文档都明确要求 Agent 复核，`unsupported` 时不得硬造包。

---

## 5. 模块设计

### 新增

| 文件 | 职责 |
|------|------|
| `src/shared/repo-types.ts` | 共享类型与工作区路径常量 |
| `src/main/services/repo-url.ts` | 地址解析（https / scp / `ssh://` / `/tree/<ref>`）、拉取策略选择、GitHub 归档请求组装、分支名推断 |
| `src/main/services/git-clone.ts` | git 可用性探测（缓存）、浅克隆（SSH `BatchMode`、超时、进程树终止）、stderr 进度解析、commit/分支回读、失败原因翻译 |
| `src/main/services/repo-fetcher.ts` | 按策略路由归档下载或 git 克隆；归档停滞超时与 500 MB 上限、安全解压、顶层目录剥离；GitHub 归档失败回退 git |
| `src/main/services/repo-analyzer.ts` | 仓库画像与可转换性分级 |
| `src/main/services/repo-workspace.ts` | 工作区生命周期、画像读写、交接文档与提示词生成、产物探测 |
| `src/main/services/repo-conversion-service.ts` | 编排 fetch → analyze → 写工作区；导入产物 |
| `src/renderer/src/composables/useRepoImport.ts` | 导入流程状态机、引擎切换与动作 |
| `src/renderer/src/components/RepoImportModal.vue` | 四步模态交互（含引擎切换） |
| `src/shared/llm-types.ts` | LLM 配置、转换计划、进度与日志类型 |
| `src/main/services/llm-credential-store.ts` | 按配置 id 加密保存 API Key（可注入加密实现） |
| `src/main/services/llm-client.ts` | OpenAI 兼容 chat/completions 客户端；**SSE 流式**（空闲超时、与中止信号竞速读取、无流式自动回退）、JSON 模式与降级重试、连通性测试、错误翻译 |
| `src/main/services/llm-profile-service.ts` | 配置 CRUD、默认配置、构建授权、密钥解析 |
| `src/main/services/repo-digest.ts` | 有界仓库上下文生成（token 预算控制） |
| `src/main/services/repo-build-runner.ts` | 包管理器识别、构建命令白名单与元字符校验、命令执行与日志流 |
| `src/main/services/llm-converter.ts` | 两阶段转换：骨架（JSON，不含正文）+ 逐文件纯文本内容；解析校验、路径安全、构建产物复制、写包与清单生成 |
| `src/main/services/llm-repair.ts` | 修复计划解析与校验、清单补丁合并、修复编排（两阶段，纯 Node 依赖） |
| `src/main/services/script-repair-io.ts` | 修复上下文收集（工作区文件 / 清单 / 执行记录 / 日志）与改动应用（路径安全、入口保护、清单校验） |
| `src/main/services/llm-converter-runtime.ts` | 装配 Electron 依赖（net.fetch / 配置服务 / 技能读取 / 工作区读写） |
| `src/renderer/src/components/ScriptRepairModal.vue` | 「AI 修复」弹窗（失败上下文、补充要求、流式进度、改动清单） |
| `src/renderer/src/components/LlmProfilesPanel.vue` | 「设置 → 模型」配置页 |
| `skills/repo-to-autoforge/SKILL.md` | 转换方法论（随包分发，同时作为 LLM system prompt） |
| `skills/repo-to-autoforge/reference.md` | 转换速查表 |

### 修改

| 文件 | 改动 |
|------|------|
| `src/shared/ipc-channels.ts` | 新增 `REPO_*` 通道与 `EVENT_REPO_CONVERT_PROGRESS` |
| `src/main/ipc/handlers.ts` | 注册 6 个仓库相关 handler |
| `src/preload/index.ts` | 暴露 `autoforge.repo` |
| `src/renderer/src/env.d.ts` | `AutoforgeApi` 增加 `repo` |
| `src/renderer/src/components/Sidebar.vue` | 新增「从仓库导入」入口 |
| `src/renderer/src/App.vue` | 挂载模态、导入后选中脚本 |
| `package.json` | `extraResources` 随包分发新技能；`test:unit` 注册新测试 |

### 复用（未改动）

`safe-zip-package`（安全解压与路径穿越防护）、`script-workspace.validatePackageDirectory`、`script-registry.importFromPath`、`script-runner`（试运行）、`mcp-control-server`（Agent 导入通道）、`AppFeatureModal`、`useToast`。

---

## 6. IPC 契约

| 通道 | 入参 | 返回 |
|------|------|------|
| `repo:fetch` | `RepoFetchRequest` | `RepoWorkspaceInfo` |
| `repo:list-workspaces` | — | `RepoWorkspaceSummary[]` |
| `repo:get-workspace` | `taskId` | `RepoWorkspaceInfo \| null` |
| `repo:import` | `taskId` | `ScriptItem` |
| `repo:open-workspace` | `taskId`, `'root' \| 'repo' \| 'package'` | `boolean` |
| `repo:delete-workspace` | `taskId` | `boolean` |
| `repo:convert-with-llm` | `LlmConvertRequest` | `LlmConversionResult` |
| `llm:list-profiles` | — | `LlmProfileListResult` |
| `llm:upsert-profile` | `LlmUpsertProfileInput` | `LlmProfileView` |
| `llm:delete-profile` | `profileId` | `boolean` |
| `llm:set-active-profile` | `profileId \| null` | `LlmProfileListResult` |
| `llm:set-allow-build` | `boolean` | `LlmProfileListResult` |
| `llm:test-profile` | `profileId` | `LlmTestResult` |
| `event:repo-convert-progress` | — | `RepoConvertProgress` |
| `event:repo-convert-log` | — | `LlmConversionLogLine` |

`repo:convert-with-llm` 的 `allowBuild` 只有在**请求为 true 且全局 `llm.allowBuild` 也为 true** 时才生效（主进程侧做与运算，不信任渲染进程）。

`RepoConvertProgress.phase`：`validating` → `downloading`（归档）或 `cloning`（git）→ `extracting`（仅归档）→ `analyzing` → `workspace-ready`；应用内 LLM 引擎追加 `llm-preparing` → `llm-building`（可选）→ `llm-generating` → `llm-validating` → `llm-writing` → `complete`。异常统一为 `error`。

并发控制：`repo-conversion-service` 内置单任务锁，并发请求返回「已有仓库正在转换」。

---

## 7. 转换工作区与交接协议

```
<userData>/repo-workspaces/<taskId>/
├── repo/                       # 原始仓库（只读参考）
└── .autoforge/
    ├── profile.json            # 仓库画像
    ├── HANDOFF.md              # 完整交接说明（含技能正文附录）
    └── package/                # 产物目录 —— 脚本包写在这里
        ├── autoforge.json
        ├── index.mjs | index.py
        └── vendor/             # 复制进来的仓库源码
```

`taskId` 形如 `<repo>-<yyyyMMddHHmmss>-<rand4>`，可读且唯一。

**交接提示词**（UI 展示、可复制）只包含任务、三个绝对路径与硬性要求，**不复述完整规范**——完整规范在 `HANDOFF.md` 里。这样提示词保持短小，而 Agent 总能读到完整上下文。

`HANDOFF.md` 由 `buildHandoffDocument()` 生成，内容包括：工作区布局、画像摘要、风险提示、README 摘要、产物硬性要求（`autoforge.json` 必填字段、`run(ctx)` 签名、自包含、依赖只声明运行期、env/params 分工、`outputDir`）、按 `convertibility` 分支的转换策略、自检清单、导入方式，最后附 `repo-to-autoforge/SKILL.md` 正文。

产物探测：`detectPackageRoot()` 先看 `.autoforge/package/autoforge.json`，其次看其唯一子目录——兼容 Agent 多套一层目录的情况。

---

## 8. UI 交互

入口三处：侧边栏「从仓库导入」按钮（「上传脚本」下方）、最近工作区列表、后续可加入空状态卡片。

四步模态（复用 `AppFeatureModal`）：

1. **地址** — 输入仓库 URL，实时提示支持的格式；高级选项折叠（分支 / 私有仓库令牌）；下方列出最近工作区（可打开、可删除）
2. **拉取** — 进度条 + 阶段文案（下载 / 解压 / 分析），显示已下载字节与总量
3. **画像** — 仓库头部信息（owner/repo、分支、文件数、体积、许可证）+ 可转换性徽标 + 判定理由 + 语言/清单/入口/依赖四项摘要 + 风险提示 + 交接提示词（可复制、可打开工作区）
4. **导入** — 检测到 `autoforge.json` 后按钮变为「导入并试运行」，导入成功自动选中脚本并打开详情面板

失败态：错误以横幅形式就地展示，不弹独立对话框；拉取失败保留 URL 便于重试；`unsupported` 级别的仓库仍可查看画像与提示词，由用户决定是否继续。

---

## 8.1 应用内 LLM 引擎（路径 B）

### 配置模型

LLM 配置存放在 `AppConfig.llm`，**只含非敏感字段**：

```ts
llm?: {
  profiles?: LlmProfile[]      // id / name / baseUrl / model / temperature / maxOutputTokens / timeoutSeconds / extraHeaders
  activeProfileId?: string     // 默认配置
  allowBuild?: boolean         // 全局构建授权
}
```

API Key 按 `profileId` 存入 `userData/llm-credentials.json`（`safeStorage` 加密；不可用时退化为内存，重启需重填），**永不进入 AppConfig、SQLite、日志或工具结果**。

配置页位于「设置 → 模型」，支持：新增（含 DeepSeek / 通义千问 / 智谱 / Moonshot / 硅基流动 / OpenAI 预设）、编辑、删除、设为默认、测试连接。转换时可在弹窗内切换使用哪一套配置。

### 转换流程（两阶段）

```
repo/ + RepoProfile
    ↓ repo-digest：有界上下文（画像 → 文件树 → 依赖清单 → README → 入口候选正文，120k 字符预算）

阶段一 · 计划骨架（JSON）
    ↓ system prompt = SKILL.md 正文 + 骨架输出契约（明确要求「不要输出文件正文」）
ConversionPlanSkeleton：语言 / 入口 / 依赖 / env / params / buildCommands
                      + files[] = { path, purpose, source: 'generate' | 'copy', copyFrom? }
    ↓ parsePlanSkeleton：语言白名单、路径安全、copy 条目必须带 copyFrom

可选 · 构建（双重授权后，在 repo/ 中执行 buildCommands）

阶段二 · 逐文件生成（纯文本，非 JSON）
    ↓ 每个 source=generate 的文件单独一次请求，system prompt 要求「只输出文件内容，不要 JSON、不要代码块」
    ↓ stripCodeFence + 体积校验
    ↓ 合并为完整计划 → parseConversionPlan 完整校验（含入口覆盖检查）

写盘
    ↓ files 逐个路径校验后写入
    ↓ copies 从 repo/ 原样复制（文件或目录，跳过 .git/node_modules/.venv）
    ↓ autoforge.json 由 buildManifestFromPlan + validateManifest 生成
    ↓ 校验 entry 在磁盘上确实存在
```

**为什么分两阶段**：最初让模型一次性输出「含所有文件正文的 JSON」，实测在 2908 字符处报 `Unterminated string`。原因是这类请求同时踩中两个坑：

1. **输出截断** —— 代码正文占满 `max_tokens`，JSON 在中途被切断；
2. **转义脆弱** —— 代码里的引号、换行、反斜杠需要正确 JSON 转义，长正文极易出错。

拆成两阶段后：骨架不含正文，体积小到几乎不可能截断；文件正文以**纯文本**返回，完全绕开 JSON 转义。同时每个文件独立成败，报错能精确到文件名。

**为什么需要 `copies`**：构建产物（Vite/Webpack 打包出的 bundle）是模型无法逐字节复现的。早期设计只允许模型「生成」文件，导致构建出的 `dist/` 根本进不了脚本包——构建支持形同虚设。现在模型只需声明 `{ source: 'copy', copyFrom: 'dist/app.js' }`，主进程在构建完成后原样复制，目录复制同样支持（`from: 'dist'`, `to: 'vendor/dist'`）。

**为什么不让模型直接写文件**：模型输出被约束成 JSON 计划后，每一条路径都过 `assertSafePackagePath`（拒绝绝对路径、盘符、`..`、`.git`/`node_modules`/`.venv`），每个文件都过体积上限，清单由 `validateManifest` 重新生成而不是采信模型给的 `autoforge.json`。模型不可信，但它的输出是可校验的。

### 构建执行的安全边界

执行 `npm install` 等于运行仓库作者的 `postinstall`，因此设了三道闸：

1. **全局开关**：`llm.allowBuild`，默认关闭，开启时弹危险确认
2. **每次确认**：转换弹窗内单独的勾选框，且仅当全局开关已开启才显示
3. **命令校验**：首词必须在白名单（npm/pnpm/yarn/bun/node/npx/tsc/vite/webpack/rollup/esbuild/parcel/pip/python/uv/poetry/make/cmake/gcc/go/cargo/mvn/gradle 等），并拒绝反引号、`$`、`;`、`|`、`>`、`<`、换行与单个 `&`（`&&` 允许）；最多 5 条、每条 ≤500 字符

未授权时构建命令被跳过并在日志中告警，产物可能无法直接运行——这一点会明确提示用户，而不是静默失败。

### 流式输出

所有模型调用（骨架、逐文件内容、修复）都走 `chatStream`（SSE）。这不是为了「好看」，而是三个实际收益：

1. **空闲超时替代总超时** —— `timeoutSeconds` 的语义改为「多久没有新内容算卡死」。大文件生成只要持续有输出就不会被误杀；反过来，网络卡死能在 1 个超时周期内被发现。另设 15 分钟硬上限兜底。
2. **实时反馈** —— 增量经节流（300ms 或 4KB）汇总为「已接收 N KB」的进度事件，界面能看到模型正在产出。
3. **截断可判定** —— `finish_reason` 在流的最后一帧到达，与一次性请求同等可靠。

健壮性细节：

- **与中止信号竞速读取**。部分网关不会把 abort 传导进响应流，直接 `await reader.read()` 会永久挂起；实现里用 `Promise.race` 把读取与中止信号竞速，超时/取消一定能生效。
- **无流式自动回退**。一个增量都没收到（网关不支持 `stream: true` 或返回空流）时，自动改用一次性请求。
- **SSE 解析容错**。忽略 `:` 注释行与非 `data:` 行，处理跨块切断的行，末尾无换行的数据也会被处理。

### 导入后的修复回路

脚本导入后运行失败时，用户不必重新走一遍导入流程，可以直接让模型改。

```
详情面板「AI 修复」（仅在该脚本最近一次运行失败时出现）
    ↓ 渲染进程提供失败会话的日志行（主进程不持久化日志）
    ↓ 主进程收集：清单原文 + 工作区文本文件（单文件 ≤24 KB、合计 ≤120 KB）+ 最近 5 次执行记录
    ↓ 阶段一（JSON）：{ summary, diagnosis, files[], deleteFiles[], manifestPatch }
    ↓ 阶段二（纯文本）：逐个重写文件内容
    ↓ 应用改动（路径安全 + 入口保护 + 清单合并校验）
    ↓ 用户回到详情面板重新运行
```

设计要点：

- **只重写需要改的文件**。提示词明确要求「先判断根因、最小改动」，避免模型顺手重构无关代码。
- **缺依赖通过 `manifestPatch.dependencies` 补充**，而不是在代码里写 `try/except` 掩盖 `ImportError`。
- **入口保护**：如果修复会删除入口文件且同一次没有重新写入它，直接中止并报错。
- **禁止删除 `autoforge.json`**；清单合并后仍走 `validateManifest`，模型给出的非法 `type` 会被归一化为 `text`。
- **模型认为无法修复时**（`files` 为空且无其他改动），把 `diagnosis` 与 `warnings` 拼成可读原因返回，而不是抛一个「计划为空」的解析错误。



| 风险 | 处置 |
|------|------|
| 拉取的是任意第三方代码 | 应用**不执行**仓库代码；归档只解压，git 只做浅检出 |
| 压缩包路径穿越 | 复用 `assertSafeZipEntryName`，拒绝绝对路径、盘符与 `..` |
| 压缩包炸弹 | 单文件与解压后总量上限 500 MB，条目数上限 2000 |
| git 参数注入 | `spawn` 使用 `shell: false` + 参数数组，并在地址前插入 `--` 分隔符，地址与分支名不会被 shell 解释 |
| git 交互式挂起 | `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、SSH `BatchMode=yes`，缺少凭据时快速失败而不是卡住 |
| SSH 主机指纹 | `StrictHostKeyChecking=accept-new`：接受新主机密钥但不接受变更，避免首次连接挂起 |
| 私仓令牌泄漏 | 令牌不写入工作区与数据库；git 场景通过 `GIT_CONFIG_VALUE_0` 环境变量传递（不进 argv，避免 `ps` 泄漏）；归档场景仅存在于单次请求头 |
| AI 生成代码直接执行 | 导入前强制 `validatePackageDirectory`；运行仍需用户在既有确认流程中显式同意 |
| 模型写入越界文件 | `assertSafePackagePath` 拒绝绝对路径、盘符、`..`、依赖与元数据目录；落盘前再用 `resolvePackageFilePath` 复核在包目录内 |
| 模型复制越界内容 | `copies[].from` 用 `assertSafeRelativePath` 校验并解析在 `repo/` 内；复制时跳过 `.git`/`node_modules`/`.venv`，文件数 ≤2000、总大小 ≤50 MB |
| 模型伪造清单 | `files` 中的 `autoforge.json` 被丢弃，清单由 `buildManifestFromPlan` + `validateManifest` 重新生成 |
| 模型产出超量内容 | 单文件 ≤512 KB、总大小 ≤4 MB、文件数 ≤60 |
| 模型输出被截断 | 读取 `finish_reason`，为 `length` 时抛出「调大最大输出 tokens」的可操作提示，并指出具体文件 |
| 流式读取永久挂起 | 读取与中止信号 `Promise.race`，即使网关不传导 abort 也能在空闲超时后中断 |
| 修复破坏入口 | 若修复会删除入口文件且同一次未重新写入，直接中止 |
| 修复删除清单 | `deleteFiles` 中出现 `autoforge.json` / `scriptbox.json` 时拒绝；所有删除路径须存在于当前工作区文件列表 |
| 修复写入越界 | 与转换共用 `assertSafePackagePath` / `resolvePackageFilePath`，路径必须落在脚本工作区内 |
| 修复引入非法清单 | 合并后仍走 `validateManifest`，非法 `type` 归一化为 `text`，失败则整次修复不落盘 |
| 构建命令注入 | 首词白名单 + 拒绝反引号/`$`/`;`/`|`/`>`/`<`/换行/单个 `&`；命令数 ≤5、长度 ≤500 |
| 构建命令偷偷执行 | 主进程侧做 `请求授权 && 全局授权` 与运算，不信任渲染进程传入的布尔值 |
| API Key 泄漏 | 独立凭据文件 + `safeStorage` 加密；不进入 AppConfig/SQLite/日志/工具结果；渲染进程只拿到 `hasApiKey` 布尔值 |
| 克隆超时占用磁盘 | 默认 10 分钟总超时，超时后终止整个进程树并清理目标目录 |
| 工作区残留 | UI 提供删除；工作区位于 `userData/repo-workspaces/`，随应用数据一起清理 |
| 许可证风险 | 画像识别许可证；缺失时写入风险提示，由用户判断 |

---

## 10. 已知限制与后续迭代

| 项 | 说明 | 优先级 |
|----|------|--------|
| 非 OpenAI 协议支持 | 目前只实现 OpenAI 兼容的 `/chat/completions`；未适配 Anthropic / Gemini 原生协议 | 中 |
| 修复不支持回滚 | 修复直接改写工作区文件，没有快照与「撤销上一次修复」 | 高 |
| 无 build 生命周期 | 依赖安装与构建发生在 `repo/` 工作区，产物仍须由模型声明 `copies`；Autoforge 本身不托管构建产物 | 中 |
| 修复不自动重跑 | 修复后需用户手动重新运行；未实现「修复 → 运行 → 再修复」的自动循环 | 中 |
| 多轮修正 | 转换阶段校验失败时不做自动重试；用户可以改补充要求后重新转换 | 中 |
| Gitee 私有仓库 HTTPS 令牌 | 目前 Gitee 私仓只能走 SSH 或本机 git 凭据管理器；未实现令牌直传 | 中 |
| 代理配置界面 | 归档与模型请求跟随系统代理、git 跟随 git 配置；未提供应用内代理设置与连通性自检 | 中 |
| 依赖映射精度 | `dependencies` 只支持包名 → 版本，monorepo / lock 文件的取舍由模型判断 | 中 |
| 上游版本追踪 | `commitSha` 已记录但未落库，无法提示上游更新或增量重转 | 中 |
| 转换产物信任记录 | 未对生成产物做 SHA-256 信任记录（可复用 `executable-trust` 思路） | 中 |
| 转换成功率度量 | 未统计各分级与各引擎下的实际成功比例，无法量化 prompt 质量 | 低 |
| 大仓画像截断 | 超过 6000 文件时画像截断，超过 120k 字符时上下文截断（已在 `risks` 中提示） | 低 |

---

## 11. 验证

单元测试：

- `src/main/services/repo-url.test.ts` — 地址解析（https / scp / `ssh://` / `.git` / `/tree/<ref>` / 非法输入）、拉取策略选择、归档请求组装（含 token 分支与 Gitee 报错）
- `src/main/services/repo-analyzer.test.ts` — 分级规则（direct / wrappable / needs-build / unsupported）、许可证识别、依赖收集、忽略目录、风险提示、commit 与拉取方式透传
- `src/main/services/git-clone.test.ts` — git 失败原因翻译（SSH 公钥、主机密钥、认证、网络、分支不存在、仓库不存在、兜底）
- `src/main/services/llm-converter.test.ts` — 路径安全（绝对路径 / 盘符 / `..` / 依赖目录）、骨架解析（copy 条目与 `copyFrom` 校验、文件数上限）、纯文本内容剥离代码块、合并校验（入口覆盖、越界路径、越界复制目标、伪造清单丢弃）、复制实现（单文件 / 目录递归 / 跳过依赖目录 / 源不存在 / 越界 / 上限）、端到端两阶段转换与截断报错
- `src/main/services/repo-build-runner.test.ts` — 构建命令白名单与元字符拒绝、命令数上限、包管理器识别、构建产物探测
- `src/main/services/llm-client.test.ts` — 接口地址归一化、请求头解析、401/404/非 JSON 错误翻译、`response_format` 降级重试、连通性测试、**流式**（增量累积与回调、注释行与非 data 行忽略、跨块切断行、空流回退、HTTP 错误、空闲超时、外部取消）
- `src/main/services/llm-repair.test.ts` — 修复计划解析（缺少 summary、删除清单文件、越界路径、无改动时的可读原因）、清单补丁合并与校验（依赖合并、入口/env/params 覆盖、非法 type 归一化）、端到端修复（根因分析、代码围栏剥离、依赖补充、上下文缺失与截断报错）
- `src/main/services/llm-credential-store.test.ts` — 多配置密钥隔离、单条清除、落盘无明文、加密不可用时退化为内存

端到端（2026-09-30 实测）：

| 用例 | 结果 |
|------|------|
| `https://gitee.com/Tianyu201809/coordinate-tool` | 修复前 404；修复后 git 克隆成功，`commitSha=7ecf2dcd…`，`resolvedRef=main` |
| `git@gitee.com:Tianyu201809/coordinate-tool.git` | SSH 克隆成功，与 HTTPS 得到同一 commit |
| `ssh://git@gitee.com/Tianyu201809/coordinate-tool.git` | 归一化为同一 `cloneUrl`，克隆成功 |
| 画像输出 | 正确识别 Vue 3 + Vite + ECharts 技术栈，判定 `needs-build` 并给出「需要构建流程」风险 |

手工验证路径：`npm run dev` → 侧边栏「从仓库导入」→ 粘贴地址 → 拉取 → 查看画像 → 复制提示词给 Agent → 导入产物 → 试运行。
