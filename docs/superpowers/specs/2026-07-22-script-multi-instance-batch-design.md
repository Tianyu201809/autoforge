# 单脚本多实例批量运行设计

## 背景

`ScriptRunnerService.start` 在同脚本已有 `running` session 时直接返回已有会话，无法并行开多个实例。参数按环境存在 `paramsByEnv`，一次只能保留一套。需求是支持「批量处理」：同一脚本可预置最多 5 个实例槽，各自独立参数/环境/浏览器配置，勾选后并行启动；单次运行入口保留。

需求 1（无限分类树）已单独规格实现，本规格仅覆盖多实例批量。

## 目标

- 每脚本可保存最多 **5** 个实例槽（名称 + envId + params + browser）。
- 批量面板勾选槽后启动；同一脚本运行中实例总数（含单次运行）**≤ 5**，超出拒绝并提示剩余名额。
- 保留详情页 ▶ 单次运行；批量为独立入口。
- 批量启动**不写回** `paramsByEnv`，避免污染单次运行配置。
- `RunSession` 可关联实例槽，日志页签能区分实例。
- 可停止单个 session，以及停止该脚本全部 running 实例。

## 非目标

- 超出 5 的排队自动续跑。
- 跨脚本复用实例槽。
- 全局（所有脚本合计）并发上限。
- 改造 JS 脚本为进程级隔离（接受同主进程多实例现状；Python 子进程隔离保持不变）。
- 定时任务按多实例槽展开（本期仍按单次逻辑调度，除非后续单独立项）。

## 方案选型

在 `script_preferences` 增加 JSON 列 `instance_slots`，与现有偏好同生命周期。Runner 以 `scriptId` 计数 running，取代「单活跃 session」早退。相对独立表更轻量，满足可保存预设需求。

## 数据模型

### ScriptInstanceSlot

```ts
interface ScriptInstanceSlot {
  id: string
  name: string
  envId: string
  params: Record<string, string>
  browser?: { headless?: boolean }
}
```

### 存储

- 迁移：`script_preferences` 表增加 `instance_slots TEXT NOT NULL DEFAULT '[]'`。
- `ScriptPreference.instanceSlots?: ScriptInstanceSlot[]`
- 经现有 list/enrich 路径合并到 `ScriptMeta.instanceSlots` 供渲染层读取。
- 上限：写入前校验 `length ≤ 5`；名称 trim 后非空；`envId` 必须存在；params 按脚本 `paramSchema` 校验。
- 卡片状态明确采用：保留 `status: 'running' | ...`，并增加 `activeSessionCount: number`（非 running 时为 0）。

### RunSession 扩展

```ts
interface RunSession {
  // ...existing
  instanceSlotId?: string
  instanceName?: string
}
```

## 运行时行为

### start 变更

- 删除：`getActiveSessionForScript` 早退返回已有 session。
- 新增：`countRunningSessions(scriptId)`；若 `count + 1 > 5` 则抛错（文案含剩余名额）。
- `start(scriptId, envId?, runtimeParams?, options?)` 中 `options` 扩展：
  - `persistParams?: boolean`（默认 `true`，兼容单次；批量传 `false`）
  - `instanceSlotId?: string` / `instanceName?: string`
  - `browserOverride?: { headless?: boolean }`（覆盖脚本默认 browser 配置，仅本 session）
- 批量路径：用槽的 `envId` / `params` / `browser`，`persistParams: false`。

### startBatch

- 输入：`scriptId` + `slotIds: string[]`（非空）。
- **预检**：所有槽存在；params/env 校验；`running + slotIds.length ≤ 5`。任一失败则整批不启动。
- 通过后按槽顺序 `start`；若中途异常（罕见），已启动的继续，向调用方返回成功/失败列表。

### stop

- 现有 `stop(sessionId)` 不变。
- 新增 `stopByScript(scriptId)`：停止该脚本所有 `running` session。

### 卡片 / 列表状态

- `ScriptItem` 的「是否运行中」改为可表达数量：例如 `runningCount`，或保留 `status: 'running'` 且另附 `activeSessionCount`。UI 显示「运行中 x/5」。

## UI 设计

### 入口

- 详情面板：保留 ▶；旁侧「批量」打开批量面板。
- 卡片右键：增加「批量运行…」。

### 批量面板

- 实例槽列表：勾选、名称、环境/参数摘要、编辑、删除；「添加实例」（满 5 禁用）。
- 编辑：名称、环境、参数表单（复用现有 Schema 控件）、无头模式。
- 底部：「启动所选」「停止全部」；显示 `running/5`。

### 日志

- LogConsole 多 session 页签标题优先显示 `instanceName`，否则脚本名 + session 短 id。

## 组件与 IPC

### 主进程

- 迁移 + preference 读写含 `instanceSlots`
- `script-store`：get/set slots，校验上限与字段
- `script-runner`：并发计数、`start` options、`startBatch`、`stopByScript`
- 浏览器覆盖在创建 SDK / 启动路径时生效（与现有 headless 读取点对齐）

### IPC（示意）

- `scripts:getInstanceSlots` / `scripts:setInstanceSlots`（或并入现有 preference API）
- `runner:start` 扩展 options
- `runner:startBatch`
- `runner:stopByScript`

### 渲染

- `BatchRunPanel.vue`（或等价命名）
- `DetailPanel` / `ScriptCard` 入口与 running 计数
- `useScriptRunner` 支持 batch / stopByScript

## 错误处理

| 场景 | 行为 |
|------|------|
| 添加第 6 个槽 | 拒绝；提示最多 5 个 |
| 启动将导致 running > 5 | 整批拒绝；提示还可开 N 个 |
| 预检参数/环境失败 | 整批不启动；指出哪个槽 |
| 单次运行时已满 5 | 拒绝并提示 |

## 改动文件（预期）

- `src/main/db/migrations/`（新迁移）
- `src/main/db/row-mappers.ts` / `script-repository.ts`
- `src/shared/types/script.ts`
- `src/main/services/script-store.ts`
- `src/main/services/script-runner.ts`
- `src/main/ipc/handlers.ts` / `src/preload/index.ts` / `env.d.ts`
- `src/renderer/.../BatchRunPanel.vue`（新建）
- `DetailPanel.vue` / `ScriptCard.vue` / `useScriptRunner.ts` / `LogConsole` 相关

## 验证

- 同脚本可并行多个 session；第 6 个被拒。
- 批量不修改 `paramsByEnv`；单次仍可 persist。
- 槽 CRUD 上限与校验。
- 勾选启动、running 计数、停止单个/全部、日志页签实例名。
- `npm run lint` / `npm run build`；有单测处覆盖并发计数与 persist 标志。

## 后续（可选）

- 定时任务按槽展开。
- JS 实例隔离加固。
- 批量结果汇总视图。
