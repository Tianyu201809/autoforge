# Autoforge MCP 集成设计

**日期**：2026-08-05  
**状态**：设计已确认，待规格文档审阅  
**范围**：本期只覆盖脚本控制核心，不包含 Prompts、依赖安装、分类、调度、窗口控制和任意 shell。

## 1. 背景与目标

Autoforge 是 Electron 本地桌面应用，主进程已经拥有脚本注册、工作区读写、环境 Profile、运行器、运行历史和日志事件。当前这些能力只通过 Electron IPC 提供给自有 renderer，外部 agent 无法安全复用。

本期目标是增加一个标准 MCP 接入层，让同一台电脑上的 MCP agent 能够：

- 查询脚本、文件、环境、运行 session、日志和执行历史；
- 异步启动、停止脚本，并查询最终结果；
- 创建、导入、编辑、删除脚本；
- 创建、修改、删除环境 Profile；
- 修改脚本环境值和运行参数；
- 通过 MCP resources 读取稳定的应用、脚本和 session 信息。

成功标准：

1. 不安装额外 Node 运行时的已安装版 Autoforge 可以被 MCP client 配置；
2. MCP 默认关闭，用户可在 Electron 设置中启用和关闭；
3. agent 能在长任务期间通过 session、日志 cursor 和等待工具可靠观察运行；
4. 所有写操作有明确确认门，敏感字段不会被读取或记录为明文；
5. MCP 不复制业务逻辑，IPC、Scheduler 和 MCP 使用同一个 Runner 实例；
6. Autoforge 未启动或 MCP 未启用时，agent 获得明确、可恢复的错误。

## 2. 非目标

本期明确不实现以下 MCP 能力：

- Prompts；
- npm/pip 或其他依赖安装；
- 分类管理；
- Cron 调度管理；
- 窗口显示、隐藏、置顶等控制；
- 任意 shell、命令行或系统进程执行；
- 远程网络访问、局域网访问和多用户共享；
- 自动修改第三方 agent 的 MCP 配置文件。

这些能力未来可以作为独立能力包设计，不进入本期权限模型和验收范围。

## 3. 已确认的产品决策

| 决策项 | 结论 |
| --- | --- |
| MCP client | 使用 Claude、Cursor、Codex 等 agent 宿主内置的 MCP client |
| 适配器 | `autoforge-mcp` 逻辑组件，随 Autoforge 安装包分发 |
| client 传输 | MCP 标准 `stdio` |
| adapter 到 app | Windows Named Pipe；macOS/Linux Unix Socket |
| Autoforge 未运行 | 不自动启动，返回 `app_not_ready` |
| 运行语义 | `start` 立即返回 session，使用查询/等待工具观察 |
| 运行参数 | MCP 默认不持久化；`persistParams: true` 视为写操作 |
| 敏感字段 | 读取脱敏或只返回元数据；允许写入但不回读旧值 |
| 写操作 | 导入、创建、覆盖、删除、文件写入、环境/参数修改要求 `confirm: true` |
| MCP 开关 | Electron 设置控制，默认关闭 |
| token | 主进程自动生成和轮换，默认不放入 agent 配置 |
| 配置分发 | Electron 提供复制配置片段，不默认修改第三方配置文件 |

## 4. 总体架构

### 4.1 进程边界

```text
MCP client
   │ stdio / MCP JSON-RPC
   ▼
autoforge-mcp adapter（独立进程）
   │ 本地 JSONL 控制协议
   ▼
Autoforge 主进程的 McpControlServer
   │
   ├── AutoforgeControlFacade
   │    ├── scriptRegistry / scriptWorkspace
   │    ├── scriptStore
   │    ├── ScriptRunnerService
   │    └── executionHistory
   └── RunEventStore / McpAuditService
```

适配器只负责 MCP 生命周期、工具和资源注册、MCP 错误转换以及本地连接重试。它不直接读取 SQLite、不访问脚本目录、不加载 Electron IPC，也不创建第二套 Runner。

主进程新增 `McpControlServer`，它是唯一的外部控制入口。它通过 `AutoforgeControlFacade` 调用领域服务，使 renderer IPC 和 MCP 使用相同的校验、持久化和运行生命周期。

### 4.2 共享 Facade

当前 `registerIpcHandlers` 内部创建 `ScriptRunnerService`。实现 MCP 时需要把 Runner 和 Scheduler 的创建提升到应用运行时容器，或提供等价的共享访问对象，避免 MCP 自己实例化 Runner。

Facade 的职责是：

- 将脚本/环境/运行/历史操作组合成稳定的领域命令；
- 对外返回 JSON-safe DTO，不泄漏数据库行、Electron 对象或 class 实例；
- 统一处理脚本 ID、环境 ID、schema 校验、写入回滚和 scheduler reload；
- 在进入 MCP 层前完成 secret 脱敏和权限检查。

### 4.3 本地 endpoint descriptor

MCP 开启时，主进程在当前 `userData/runtime/mcp-endpoint.json` 写入运行时描述：

```json
{
  "protocolVersion": "1.0",
  "appVersion": "1.23.1",
  "appEnv": "production",
  "pid": 12345,
  "transport": "named-pipe",
  "endpoint": "\\\\.\\pipe\\autoforge-mcp-production-user",
  "token": "runtime-only-secret",
  "createdAt": "2026-08-05T00:00:00.000Z"
}
```

Windows endpoint 使用用户隔离的 Named Pipe 名称；macOS/Linux endpoint 使用 `${userData}/runtime/mcp.sock`。runtime 目录使用用户专属权限，Unix socket 和 descriptor 不对其他用户开放。descriptor 中的 token 只用于本机 adapter 握手，不通过 MCP 返回。

适配器可使用 `--app-env development|production` 选择 descriptor，也支持显式 `--endpoint` 作为诊断和多环境兜底参数。默认路径按现有 `app-data-root` 的 appData + 环境后缀规则解析。

### 4.4 内部控制协议

控制 socket 使用换行分隔 JSON。每行是一条完整消息，禁止在字段中拼接未转义换行。

请求：

```json
{"type":"request","id":"42","method":"scripts.get","params":{"scriptId":"abc"}}
```

成功响应：

```json
{"type":"response","id":"42","ok":true,"result":{"script":{"id":"abc"}}}
```

失败响应：

```json
{"type":"response","id":"42","ok":false,"error":{"code":"not_found","message":"脚本不存在","retryable":false}}
```

事件通知：

```json
{"type":"event","event":"session.updated","data":{"sessionId":"s1"}}
```

握手必须是连接后的第一条请求，参数包含 `protocolVersion`、adapter 名称和 descriptor token。主进程使用常量时间比较 token，版本不兼容或认证失败立即关闭连接。

固定限制：单帧 8 MiB；单个文本文件读/写 4 MiB；创建脚本的全部文件 payload 8 MiB；最多 8 个并发连接；每连接最多 16 个 in-flight 请求；普通读写请求超时 30 秒；`wait_for_session` 默认 30 秒、最大 60 秒。超限统一返回 `invalid_params` 或 `busy`。

## 5. MCP API 设计

### 5.1 工具命名

所有工具使用 `autoforge_` 前缀，工具描述必须包含用途、风险、参数 schema、结果结构和是否需要 `confirm`。

### 5.2 只读工具

| 工具 | 主要参数 | 行为 |
| --- | --- | --- |
| `autoforge_list_scripts` | 过滤、分页、排序 | 返回脚本元数据、状态、schema 摘要和运行计数 |
| `autoforge_get_script` | `scriptId` | 返回详情、入口、语言、env/params schema、环境 ID 和实例槽位 |
| `autoforge_list_script_files` | `scriptId` | 返回安全相对路径、入口标记、文件类型和大小 |
| `autoforge_read_script_file` | `scriptId`、相对路径、可选 limit | 返回 UTF-8 或 base64 内容，禁止绝对路径和路径穿越 |
| `autoforge_list_environments` | 可选分页 | 返回 Profile 元数据和变量键 |
| `autoforge_get_environment` | `envId`、可选 `scriptId` | 有脚本 schema 时返回非 secret 值；否则只返回变量键和存在性 |
| `autoforge_list_sessions` | 可选脚本过滤 | 返回当前进程内 session 快照 |
| `autoforge_get_session` | `sessionId` | 返回状态、phase、结果、错误和时间字段 |
| `autoforge_get_session_logs` | `sessionId`、cursor、limit | 返回日志、`nextCursor` 和是否存在 `log_gap` |
| `autoforge_wait_for_session` | `sessionId`、timeoutMs | 等待终态；超时不改变脚本状态 |
| `autoforge_get_execution_history` | 脚本、状态、日期、分页 | 查询持久化执行历史 |

### 5.3 执行工具

| 工具 | 主要参数 | 行为 |
| --- | --- | --- |
| `autoforge_start_script` | `scriptId`、`envId`、params、browserOverride、persistParams | 默认 `persistParams: false`，成功立即返回新 session |
| `autoforge_stop_session` | `sessionId` | 停止单个运行 session |
| `autoforge_stop_script` | `scriptId` | 停止该脚本全部 running session |

启动工具默认不要求 `confirm`，因为它只创建运行 session；当 `persistParams` 为 true 时必须显式确认。现有脚本 schema、环境校验、并发上限和运行超时继续由 `ScriptRunnerService` 执行。

### 5.4 写工具

| 工具 | 主要参数 | 行为 |
| --- | --- | --- |
| `autoforge_create_script` | manifest、入口内容、可选文件 map、`confirm` | 在 staging 目录创建并校验包，成功后注册新脚本 |
| `autoforge_import_script` | 本地绝对文件/目录路径、`confirm` | 仅导入本地文件或目录，不接受 URL；复用工作区校验和导入逻辑 |
| `autoforge_write_script_file` | `scriptId`、安全相对路径、内容、`confirm` | 临时文件写入后 rename；manifest 变更后重新校验并同步元数据 |
| `autoforge_update_script_meta` | `scriptId`、允许字段、`confirm` | 修改名称、描述、图标、浏览器模式等字段 |
| `autoforge_delete_script` | `scriptId`、`confirm` | 先停止 session，再删除数据库记录和工作区 |
| `autoforge_create_environment` | Profile、`confirm` | 创建环境并返回 ID/元数据，不返回 secret 值 |
| `autoforge_update_environment` | `envId`、patch、`confirm` | 更新名称、描述、默认标记和变量；响应只返回变更键 |
| `autoforge_delete_environment` | `envId`、`confirm` | 按现有环境删除规则执行，失败时返回业务错误 |
| `autoforge_set_script_env` | `scriptId`、`envId`、values、`confirm` | 写入脚本在指定 Profile 下的 env 配置 |
| `autoforge_set_script_params` | `scriptId`、`envId`、values、`confirm` | 写入该环境下保存的运行参数 |

所有写工具缺少确认时返回 `confirmation_required`，包含目标、变更类型和影响摘要，不执行任何部分操作。写入值可以包含 secret，但响应只返回 `{ changedKeys, secretKeys, persisted }` 等元数据。

### 5.5 Resources

提供稳定、只读的 resource URI 模板：

- `autoforge://app/status`
- `autoforge://scripts`
- `autoforge://scripts/{scriptId}/manifest`
- `autoforge://sessions/{sessionId}`
- `autoforge://sessions/{sessionId}/logs`

资源内容使用与工具相同的 DTO 和脱敏规则。客户端不支持资源订阅时，仍可通过查询工具完成全部流程。本期不提供 Prompts。

## 6. 异步运行与事件模型

### 6.1 RunEventStore

新增主进程级 `RunEventStore`，在应用运行时订阅 `logBus`：

- 每个 session 保存递增 `seq` 的日志环形缓冲；上限为 2,000 行或 2 MiB，先达到者淘汰旧日志；
- 保存最近一次 `RunSession` 快照；
- `get_session_logs` 支持 cursor/limit，旧 cursor 超出窗口时返回 `log_gap` 和当前尾部 cursor；
- `wait_for_session` 监听 session 更新并在 completed/error/stopped 时解析；超时、取消和断开连接时移除 listener；
- JS 与 Python 运行产生的日志都通过现有 `logBus` 进入同一缓冲。

### 6.2 事件转发

控制面只向订阅了对应 session 的连接转发 `session.updated`、`log.appended` 等事件。adapter 可以将它们映射为 MCP resource update notification，但通知不是正确性依赖。发送队列超过 1 MiB 时允许丢弃中间日志通知，并发送 `log_gap`；agent 使用 cursor 查询恢复。

### 6.3 重启语义

应用重启后内存 session 和日志缓冲会丢失。现有 `executionHistory` 启动 reconcile 会将未完成记录标记为 stopped，历史工具仍可查询。旧 session 若不再存在于 Runner，`get_session` 返回 `not_found`，agent 应改用 execution history 查询；旧日志不承诺恢复。

## 7. 安全、授权与审计

### 7.1 连接安全

- MCP 默认关闭；`AppConfig` 增加 `mcp.enabled`，默认值为 false。
- 仅创建本地 Named Pipe/Unix Socket，不新增 TCP 监听，不复用现有 `19276` Hub bridge。
- token 由 `randomBytes(32)` 生成，只保存在主进程内存和用户专属 descriptor；不写入 MCP client 配置。
- 轮换 token 时拒绝新请求、关闭现有连接、生成新 descriptor；旧 token 立即失效。
- 启动时清理与当前 PID/环境不匹配的 stale descriptor；adapter 不负责拉起 Autoforge。
- token 只能作为本机同用户的误连防护；同一用户权限下的恶意进程仍可能读取 descriptor，不能把它当作操作系统级沙箱。

### 7.2 写入和路径安全

- 每个写工具单独检查 `confirm === true`，不接受由其他调用继承的隐式确认；
- 脚本 ID 和环境 ID 必须先从 registry/store 解析；未知目标返回 `not_found`；
- 所有工作区文件路径必须是相对路径，使用 `relative` 和 `realpath` 校验根目录边界，拒绝绝对路径、`..`、空字节和 symlink 越界；
- 创建/导入先在临时目录校验 manifest、入口和文件数量，再原子激活；
- 删除脚本先停止活动 session，数据库与工作区删除失败时返回明确结果；
- 本期导入只接受用户明确提供的本地文件/目录，不下载 URL。

### 7.3 Secret 处理

- env/params schema 中 `secret: true` 的值读取时返回掩码或 `{ present: true }`；
- 无法关联脚本 schema 的通用环境读取只返回变量键和存在性；
- secret 可通过写工具设置，但响应不回显输入值；
- MCP request、错误 message、审计记录和调试日志不得包含 secret；
- 脚本源文件内容不做不可行的全文 secret 扫描，工具描述明确提示 agent 不应把凭据硬编码进源码。

### 7.4 审计

新增 `McpAuditService`，以 JSONL 写入 `userData/runtime/mcp-audit.jsonl`。每条记录包含时间、connectionId、requestId、工具/命令、目标 ID、确认状态、结果状态和错误码，不包含文件内容、参数值或 secret。文件达到 10 MiB 时轮换一次并保留上一份。

## 8. 错误、超时与回滚

控制协议和 MCP adapter 使用统一错误码：

| 错误码 | 含义 | 是否可重试 |
| --- | --- | --- |
| `app_not_ready` | Autoforge 未启动或控制面未启用 | 是 |
| `auth_failed` | token/握手失败 | 否，需重新发现 descriptor |
| `protocol_mismatch` | adapter 与 app 协议版本不兼容 | 否 |
| `invalid_params` | 参数结构或大小不合法 | 否 |
| `not_found` | 脚本、环境或 session 不存在 | 否 |
| `confirmation_required` | 缺少显式确认 | 否，需重新调用 |
| `path_forbidden` | 文件路径越界或不安全 | 否 |
| `validation_failed` | manifest/schema/环境/参数校验失败 | 修正参数后可重试 |
| `conflict` | 目标状态冲突 | 修正状态后可重试 |
| `busy` | 连接、写锁或并发额度已满 | 是 |
| `timeout` | 控制请求或等待超时 | 是 |
| `internal` | 未分类内部错误 | 视情况 |

MCP 工具失败返回 `isError: true` 和 `{ code, message, retryable, details }`，生产模式不返回堆栈。`start_script` 的成功只表示 session 已创建；`wait_for_session` 超时只表示等待结束，不改变脚本状态。

脚本创建和文件写入使用 staging + 临时文件 + rename。manifest 写入后必须再次调用现有 package 校验；校验失败删除 staging 或恢复 backup，保证数据库 registry 与工作区不会只更新一半。

## 9. Electron 管理界面与配置

设置页新增 MCP 面板：

- 开关“允许本地 MCP 控制”；
- 显示 enabled/disabled、appEnv、PID、transport、连接数和最近连接时间；
- 复制 Windows、macOS/Linux、开发模式的 MCP 配置片段；
- 轮换凭据并断开全部 adapter 连接；
- 显示“应用未运行/未启用/版本不兼容”等状态。

Electron 不默认修改 Claude、Cursor、Codex 等第三方配置文件。复制出的配置示例使用已安装 Autoforge 的可执行文件并传递 `--mcp-stdio --app-env production`；开发模式使用 `npm run mcp -- --app-env development`。adapter 进程不创建窗口、不调用桌面初始化流程，只读取 descriptor 并连接已运行的主进程。

主进程在 `app.whenReady()` 完成数据库、Store、Runner 初始化后，根据 `mcp.enabled` 启动控制面；用户关闭 MCP 或应用退出时先拒绝新请求、排空连接、关闭 socket、删除 descriptor 和清理运行时句柄。

## 10. 预计代码落点

| 区域 | 计划模块 | 职责 |
| --- | --- | --- |
| shared | `src/shared/mcp-control-protocol.ts` | JSONL envelope、握手、错误和协议版本 |
| shared | `src/shared/mcp-types.ts` | MCP DTO、工具输入输出和资源类型 |
| main | `src/main/services/autoforge-control-facade.ts` | IPC/MCP 共享领域操作 |
| main | `src/main/services/mcp-control-server.ts` | Named Pipe/Unix Socket、握手、请求路由 |
| main | `src/main/services/run-event-store.ts` | session 快照、日志 ring buffer、cursor 和等待 |
| main | `src/main/services/mcp-audit.ts` | 结构化审计和轮换 |
| mcp | `src/mcp/stdio-server.ts` | MCP Server、stdio transport、工具/资源注册 |
| main/entry | `src/main/index.ts` 或独立 mcp entry | `--mcp-stdio` adapter 启动分支 |
| renderer | MCP 设置面板、preload IPC | 开关、状态、复制配置和凭据轮换 |
| config | AppConfig 与 IPC channel | 持久化 enabled 状态和管理接口 |
| packaging | electron-vite/electron-builder | 打包 MCP entry 和 SDK |

实现时通过运行时 Facade 共享现有 `ScriptRunnerService`，不在 `src/mcp` 复制 `script-runner`、`script-store` 或 `script-workspace` 逻辑。

## 11. 实施阶段

1. **协议和配置**：增加 AppConfig MCP 字段、endpoint descriptor、JSONL envelope、协议版本和错误码。
2. **共享运行时**：调整 Runner/Scheduler 初始化，增加 `AutoforgeControlFacade`、DTO、secret 脱敏和 `RunEventStore`。
3. **控制面与认证**：实现 Named Pipe/Unix Socket、握手、token 轮换、连接限制、审计和关闭 drain。
4. **stdio adapter 与 MCP surface**：接入官方 TypeScript MCP SDK，实现 tools/resources、异步 session 和错误转换。
5. **Electron UI、打包和文档**：实现设置面板、复制配置、`--mcp-stdio` 启动模式、三平台构建和客户端配置示例。

## 12. 测试与验收

### 12.1 单元测试

- JSONL 分帧、请求匹配、握手、token 常量时间比较和轮换；
- descriptor 读写、环境选择、stale descriptor 清理；
- Facade 的 ID/schema 校验、confirm 门和 secret 脱敏；
- 文件路径相对化、realpath 边界、symlink 拒绝和大小限制；
- 创建/导入/写 manifest 的 staging、回滚和元数据同步；
- RunEventStore 的 seq、cursor、log_gap、环形淘汰和 wait 清理；
- DTO JSON-safe 序列化、错误映射和审计脱敏。

### 12.2 集成测试

- MCP disabled 时 adapter 能初始化但所有控制调用返回 `app_not_ready`；
- 启用 MCP 后 stdio adapter 能发现 descriptor、完成握手并列出工具/资源；
- 脚本列表、详情、文件读写、创建、导入、删除和 manifest 回滚；
- 环境 Profile 和脚本 env/params 的读写、secret 掩码和 confirm 缺失；
- 启动长任务、等待终态、读取日志 cursor、停止 session、查询历史；
- 连接断开、服务关闭、token 轮换、并发读写和 busy 限制；
- 应用重启后的历史 reconcile 和旧 session 语义。

### 12.3 回归与平台验证

- `npm run test:unit`；
- `npm run lint`；
- `npm run build`；
- Windows Named Pipe、macOS/Linux Unix Socket 的 MCP smoke test；
- 已安装包执行 `Autoforge --mcp-stdio --app-env production` 时不创建 GUI 窗口、不初始化第二套数据库；
- 开发/生产数据目录互不串用，两个环境可独立生成 descriptor。

### 12.4 用户验收清单

1. Electron 关闭 MCP 时，agent 无法执行任何控制操作；
2. 未传 `confirm: true` 的写工具不会产生磁盘或数据库变更；
3. secret 值不出现在工具响应、日志、错误和审计文件；
4. agent 能异步运行脚本，在长任务中查询状态和增量日志；
5. script manifest 校验失败时 registry 和工作区保持原状；
6. 两个本地 agent 同时读取不会互相影响，冲突写入得到明确错误；
7. Autoforge 退出或重启后不会留下有效 descriptor 或悬挂 socket；
8. 未安装额外 Node 的用户可使用安装包提供的 MCP 启动命令。

## 13. 风险与取舍

- **同用户权限限制**：Named Pipe/Unix Socket 和 token 不能防御同一用户下的恶意程序；本期依赖本机用户信任，不承诺沙箱。
- **日志只保存在内存**：重启后旧 session 日志不可恢复，但执行历史仍可查询；将完整日志持久化留作后续需求。
- **renderer 与 MCP 状态差异**：Facade 和 RunEventStore 位于主进程，避免 MCP 依赖 renderer 是否打开。
- **安装包启动路径差异**：Electron 设置页必须生成平台正确的 executable path；客户端配置错误时提供复制和手动诊断信息。
- **多环境并行**：development/production 使用独立 descriptor、socket 和 userData；adapter 必须显式选择 appEnv，避免连错数据库。
- **写入与运行竞态**：运行中的脚本写入只影响后续启动；删除会先停止活动 session；同一脚本的写操作使用串行锁。

本规格不包含未列入本期范围的能力，后续扩展必须重新进行权限、工具契约和验收设计。
