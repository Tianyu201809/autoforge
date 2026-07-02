# Python 脚本执行支持 — 设计规格

**日期**：2026-07-02  
**状态**：已批准（方案 A）  
**决策**：方案 A — 使用用户本机 Python 3.9+，设置页可配置解释器路径

---

## 1. 背景与目标

Autoforge 当前仅支持 JavaScript 脚本执行（主进程 `dynamic import` + `run(ctx)`）。元数据层已为 Python 预留类型（`ScriptLanguage`、`language` 字段、UI 徽章、`.py` 导入），但 `script-runner` 与 `dependency-manager` 未实现 Python 分支。

**目标**：在不改变现有 JS 脚本行为的前提下，让 `language: "python"` 或入口为 `.py` 的脚本包能够：

1. 按与 JS 相同的生命周期运行（校验 → 装依赖 → 启动 → 运行 → 完成/失败/停止）
2. 使用相同的 `run(ctx)` 契约（env、params、log、stage、progress、sdk、返回值）
3. 复用现有 `@autoforge/ctl` 控制协议与执行历史/UI 展示
4. 依赖用户本机 Python 3.9+（设置页可指定路径）

**非目标（本期不做）**：

- 捆绑 embeddable Python 运行时
- Pyodide / WASM Python
- 子进程资源沙箱 / 超时（列入 Phase 3）
- 设置页全局 Python pip 依赖 UI（列入 Phase 3，IPC 可预留）

---

## 2. 现状摘要

| 模块 | Python 相关现状 |
|------|----------------|
| `shared/script-language.ts` | 类型与扩展名推断已实现 |
| `shared/script-contract.ts` | manifest 校验支持 `language: "python"` |
| `script-workspace.ts` | 导入 `.py` 单文件、忽略 `__pycache__` |
| `script-runner.ts` | 仅 JS `import()`，无语言分流 |
| `dependency-manager.ts` | 仅 npm |
| `script-sdk.ts` | 仅 Node Playwright |
| `shared/encoding.ts` | 子进程 UTF-8 含 `PYTHONIOENCODING` |
| UI | 卡片 Py 徽章；编辑器无 `.py` 高亮 |

---

## 3. 架构概览

```
ScriptRunnerService.executePackage()
  │
  ├─ script.language === 'javascript' → executeJsPackage()  [现有逻辑抽出]
  │
  └─ script.language === 'python'     → executePythonPackage() [新增]
         │
         ├─ PythonDependencyManager.installScriptDeps()
         ├─ resolvePythonExecutable()  ← AppConfig / 环境变量 / PATH
         ├─ spawn(python, -m autoforge_runtime, ...)
         └─ 解析 stdout 行协议 → log / stage / progress / result
```

Python 脚本在**独立子进程**中运行，与架构文档「子进程隔离」方向一致；取消运行通过终止子进程实现。

### 3.1 新增文件

| 路径 | 职责 |
|------|------|
| `src/main/services/python-runner.ts` | spawn、stdout/stderr 解析、取消、会话完成 |
| `src/main/services/python-dependency-manager.ts` | 脚本 `.venv`、pip install、requirements 生成 |
| `src/main/services/python-resolver.ts` | 解释器路径解析、版本检测 |
| `resources/python/autoforge_runtime/__init__.py` | 包入口 |
| `resources/python/autoforge_runtime/bootstrap.py` | 加载用户脚本、调用 `run(ctx)` |
| `resources/python/autoforge_runtime/context.py` | Context / Sdk 实现 |
| `resources/python/autoforge_runtime/protocol.py` | stdout 行协议封装 |
| `examples/hello-world-py/` | Python 示例脚本包 |

### 3.2 修改文件

| 路径 | 变更 |
|------|------|
| `src/main/services/script-runner.ts` | 语言分流；JS 逻辑重命名为 `executeJsPackage` |
| `src/main/services/dependency-manager.ts` | 门面：`installScriptDeps` 按 language 委托 |
| `src/shared/types/script.ts` | `AppConfig.python` |
| `src/shared/script-contract.ts` | 注释补充 Python 契约与 dependencies 语义 |
| `src/main/ipc/handlers.ts` | Python 检测 IPC、设置读写 |
| `src/preload/index.ts` / `env.d.ts` | 暴露 Python 检测 API |
| `src/renderer/src/components/SettingsPanel.vue` | Python 路径 + 检测按钮 |
| `docs/script-spec.md` | Python 章节 |
| `electron-builder` 配置 | 打包 `resources/python/**` |

---

## 4. Python 脚本契约

### 4.1 入口要求

- 入口文件由 `autoforge.json` 的 `entry` 指定，默认语言为 python 时推荐 `index.py`
- 必须定义 **`run(ctx)`** 函数（同步或 async）
- 不支持仅 `default` 导出（Python 无此模式）；bootstrap 只查找模块级 `run`

### 4.2 Context API（与 JS 对齐）

```python
async def run(ctx):
    # 环境变量与运行参数 — 均为 str -> str
    ctx.env["API_URL"]
    ctx.params["ORDER_ID"]

    ctx.log("INFO", "开始")           # INFO | WARN | ERROR
    ctx.stage(name="import", label="导入数据", message="...")
    ctx.progress(scope="task", current=1, total=10, label="...", unit="条")

    if ctx.signal.aborted:
        return None

    browser = await ctx.sdk.browser.launch()
    user_data = ctx.sdk.paths.user_data
    script_dir = ctx.sdk.paths.script_dir

    return {"ok": True}
```

| 成员 | 类型 | 说明 |
|------|------|------|
| `session_id` | `str` | 会话 ID |
| `script_id` | `str` | 脚本 ID |
| `env` | `dict[str, str]` | 合并后的环境变量 |
| `params` | `dict[str, str]` | 本次运行参数 |
| `signal` | `AbortSignal` | `aborted` 属性；协作式取消 |
| `log(level, message)` | 方法 | 写入 UI 日志 |
| `stage(...)` | 方法 | 自定义阶段 |
| `progress(...)` | 方法 | scope=`task` \| `total` |
| `sdk.browser.launch()` | async | Playwright Chromium（Phase 2） |
| `sdk.paths.user_data` | `Path` | userData 目录 |
| `sdk.paths.script_dir` | `Path` | 脚本包目录 |

### 4.3 manifest 扩展

现有字段复用，不新增 manifest 版本：

```json
{
  "autoforge": "1.0",
  "name": "示例",
  "language": "python",
  "entry": "index.py",
  "dependencies": {
    "requests": ">=2.31.0"
  }
}
```

- `language` 省略时由 `entry` 扩展名推断（已有逻辑）
- `dependencies`：Python 脚本下键为 **PyPI 包名**，值为 **pip specifier**（与 npm 字段名相同，按 `language` 分流安装器）

---

## 5. Node ↔ Python 通信协议

所有结构化消息经 **stdout 单行 JSON 前缀** 输出，`flush=True`。

| 前缀 | 常量 | 载荷 | Node 处理 |
|------|------|------|-----------|
| `@autoforge/log ` | 新增 | `{"level":"INFO","message":"..."}` | `pushLogLine` |
| `@autoforge/ctl ` | 已有 | stage / progress JSON | `parseScriptControlMessage` |
| `@autoforge/result ` | 新增 | `{"value": <any JSON>}` | `completeSession` |
| `@autoforge/error ` | 新增 | `{"message":"..."}` | `failSession` |

**规则**：

- stderr 中非协议内容 → `ERROR` 级别日志
- 子进程 exit code ≠ 0 且未收到 `@autoforge/result` → 失败
- 普通 `print()` 不自动映射为日志（避免污染）；脚本应使用 `ctx.log`

### 5.1 启动环境变量

避免命令行长度限制，上下文经环境变量注入：

| 变量 | 内容 |
|------|------|
| `AUTOFORGE_SESSION_ID` | 会话 UUID |
| `AUTOFORGE_SCRIPT_ID` | 脚本 ID |
| `AUTOFORGE_ENTRY_PATH` | 入口文件绝对路径 |
| `AUTOFORGE_CTX_JSON` | JSON：`{env, params, browser, paths, sessionId, scriptId}` |
| `AUTOFORGE_RUNTIME_ROOT` | `autoforge_runtime` 包所在目录（打包后 `resources/python`） |
| `PYTHONPATH` | `runtime_root` + 脚本目录 + venv site-packages |
| `VIRTUAL_ENV` | 脚本 `.venv` 路径（若存在） |

启动命令：

```bash
{pythonExecutable} -m autoforge_runtime
```

`autoforge_runtime/bootstrap.py` 读取环境变量，动态 `importlib` 加载 `AUTOFORGE_ENTRY_PATH` 对应模块，调用 `run(ctx)`。

### 5.2 共享协议常量

在 `src/shared/script-protocol.ts`（新文件）集中定义前缀，`script-progress.ts` 的 `SCRIPT_CONTROL_PREFIX` 从该处 re-export，避免 Python/TS 漂移。

---

## 6. Python 解释器解析（方案 A）

### 6.1 配置

```typescript
// AppConfig
python?: {
  /** 用户指定的 python.exe / python3 绝对路径 */
  executablePath?: string
  /** 最低版本，默认 "3.9" */
  minVersion?: string
}
```

持久化于现有 SQLite config repository（与 `browser.executablePath` 同级）。

### 6.2 解析顺序

1. `AppConfig.python.executablePath`（非空且文件存在）
2. 环境变量 `AUTOFORGE_PYTHON`
3. 平台探测（`spawn` 执行 `{cmd} --version`）：
   - Windows：`py -3`、`python`、`python3`
   - macOS / Linux：`python3`、`python`

### 6.3 版本校验

- 执行 `{executable} -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"`
- 主版本 ≥ 3，次版本 ≥ 9
- 失败时抛出可读错误：「未检测到 Python 3.9+，请在 设置 → Python 中配置解释器路径」

### 6.4 设置页 UI

- 输入框：Python 可执行文件路径
- 按钮「检测 Python」：调用 IPC `PYTHON_DETECT`，显示版本与路径
- 按钮「浏览…」：文件选择（Windows `.exe`，其他平台任意）

---

## 7. 依赖管理

### 7.1 脚本级（Phase 1）

目录结构：

```
userData/scripts/{scriptId}/
├── autoforge.json
├── index.py
├── requirements.txt      # 运行时从 dependencies 生成，不强制用户维护
└── .venv/                # 自动创建；删除脚本时一并删除
```

流程：

1. 读取 manifest `dependencies`
2. 若无依赖 → 跳过 installing-deps
3. 写入 `requirements.txt`（格式：`package==version` 或 `package>=version`）
4. `{python} -m venv .venv`（已存在则跳过创建）
5. `{venv}/bin/pip install -r requirements.txt`（Windows 为 `Scripts/pip.exe`）
6. 阶段日志：`正在安装 pip 依赖…` / `依赖安装完成`

`dependency-manager.installScriptDeps(scriptDir, language)` 门面委托。

### 7.2 全局 Python 依赖（Phase 3）

- 目录：`userData/runtime-python/.venv`
- 复用现有 `DEPS_*` IPC 时需增加 `language` 参数或独立 channel
- **本期不实现 UI**，架构预留

### 7.3 JS 行为不变

- `language === 'javascript'` 时仍走 npm + `userData/runtime/node_modules`
- manifest 中 `dependencies` 语义由 `language` 决定，不在同一脚本混用两种包管理器

---

## 8. 执行生命周期

| 阶段 | Python 行为 |
|------|------------|
| `queued` | 与 JS 相同 |
| `validating` | 检查 entry 存在；`resolvePythonExecutable()` |
| `installing-deps` | pip install 至 `.venv` |
| `starting` | spawn 子进程 |
| `running` | 解析 stdout，更新 session / runProgress |
| `stopping` | 用户停止 |
| `completed` / `failed` / `stopped` | 写 execution-history，广播 UI |

### 8.1 取消

1. `abortController.abort()` → `PythonScriptRunner.stopChild(sessionId)`
2. Windows：`taskkill /PID {pid} /T /F`；Unix：`SIGTERM`，2s 后 `SIGKILL`
3. Python bootstrap 注册 SIGTERM handler，设置 `ctx.signal._aborted = True`
4. session 状态 `stopped`，与 JS 一致

### 8.2 session.pid

spawn 成功后写入 `RunSession.pid`，便于调试与强制终止。

---

## 9. SDK：browser 与 paths

### 9.1 paths（Phase 1）

由 `AUTOFORGE_CTX_JSON.paths` 注入，无额外 IPC。

### 9.2 browser（Phase 2）

- Python 依赖：`playwright`（版本与 `package.json` 中 `playwright-core` 对齐，如 `1.50.1`）
- `ctx.sdk.browser.launch()` 使用 `playwright.async_api`
- `executable_path` 从主进程传入（复用 `browser-path.ts` 解析结果）
- `headless` 来自 manifest / 脚本 meta `browser.headless`
- abort 时 bootstrap 关闭已 launch 的 browser 实例

**Phase 1** 可先 stub `browser.launch()` 抛出明确错误「浏览器 SDK 将在下一版本提供」，或直接进入 Phase 2 一并实现——实现计划中选择其一。

---

## 10. UI 与编辑器

| 项 | Phase | 说明 |
|----|-------|------|
| 设置页 Python 路径 | 1 | 见 §6.4 |
| hello-world-py 示例 | 1 | 开发指南 / examples 导入 |
| `script-spec.md` Python 章 | 1 | 与 JS 规范并列 |
| CodeEditor `.py` 高亮 | 2 | `useScriptFileEditor.languageForPath` 扩展 |
| 运行中 Py 徽章 / 日志 | 1 | 已有，无需改 |

---

## 11. 打包与资源路径

- `resources/python/` 纳入 electron-builder `extraResources` 或 `files`
- 运行时路径：
  - 开发：`join(app.getAppPath(), 'resources/python')`
  - 生产：`join(process.resourcesPath, 'python')`
- `PythonScriptRunner` 统一通过 `getPythonRuntimeRoot()` 解析

---

## 12. 错误处理

| 场景 | 用户可见错误 |
|------|-------------|
| 未找到 Python | 设置页引导 + 运行前 Error |
| Python 版本过低 | 需要 Python 3.9+，当前 x.y |
| 入口无 `run` | 脚本必须定义 run(ctx) 函数 |
| pip 失败 | 依赖安装失败: {stderr} |
| 脚本异常 | `@autoforge/error` 或 traceback → failed |

---

## 13. 测试计划

### 13.1 手动测试

1. 设置页：检测本机 Python、保存自定义路径
2. 导入 `examples/hello-world-py`，填写 env/params，运行成功并显示 result
3. 声明 `dependencies: {"requests": "..."}`，首次运行触发 installing-deps
4. 运行中点击停止 → status `stopped`
5. 原有 JS hello-world 回归无影响

### 13.2 自动化（可选，Phase 1 末）

- 单元测试：`python-resolver` mock spawn
- 单元测试：stdout 行协议解析（TS）
- 集成测试：需 CI 安装 Python，可标记 `optional`

---

## 14. 分阶段交付

### Phase 1 — MVP

- [ ] 语言分流 + `PythonScriptRunner`
- [ ] `autoforge_runtime` bootstrap + Context（log / result / error）
- [ ] pip + 脚本 `.venv`
- [ ] Python 解释器配置与检测
- [ ] `@autoforge/log` / `@autoforge/result` 协议
- [ ] 取消（kill 子进程）
- [ ] `examples/hello-world-py`
- [ ] 文档更新

### Phase 2 —  parity

- [x] stage / progress（`@autoforge/ctl`）
- [x] `ctx.signal` 协作式取消
- [x] browser SDK（Playwright Python）
- [x] 编辑器 Python 语法高亮

### Phase 3 — 增强

- [x] 全局 Python pip 依赖 UI
- [x] 运行超时
- [x] pip 镜像配置
- [x] 子进程 cwd / 环境隔离加固

---

## 15. 开放问题（实现前确认）

1. **Phase 1 是否包含 browser SDK stub 还是直接 Phase 2 再做？** 建议 Phase 1 仅 paths，`browser.launch()` 调用时返回友好错误。
2. **requirements.txt 是否提交到用户脚本包？** 建议仅运行时生成，不写入用户可见的持久文件（或写入但 `.gitignore` 由用户自行处理）；平台每次按 manifest 重新生成以保证一致。

---

## 16. 评审结论

- [x] 设计 approved — 可进入 implementation plan
- [ ] 需修改 — 见评审意见
