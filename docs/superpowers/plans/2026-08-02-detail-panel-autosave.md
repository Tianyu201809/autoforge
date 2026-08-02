# 详情面板运行参数与配置自动保存实现计划

> **For agentic workers:** 需要按任务逐项执行本计划；每项完成后运行对应验证，不创建提交或分支。步骤使用 checkbox 跟踪。

**Goal:** 让详情面板的“运行参数”和“配置”在修改后自动持久化并立即生效，同时保持编辑清单和批量运行面板的手动保存行为。

**Architecture:** 在 `DetailPanel.vue` 内增加参数/配置快照、400ms 防抖 timer 和串行保存队列，继续调用现有 `setParams`、`setEnvConfig` 与 `scripts.update` IPC。以已有 `paramsDirty`、配置快照和 `usePanelSaveFeedback` 作为状态边界，不修改公共 IPC、`SchemaValueField` 或 `BatchRunPanel`。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、现有 Electron preload IPC、现有 `usePanelSaveFeedback`。

## Global Constraints

- 只改 `src/renderer/src/components/DetailPanel.vue` 的“运行参数”和“配置” Tab。
- 文本/文本域停止输入约 400ms 后自动保存；select、radio、checkbox、boolean、attachment 变更进入同一自动保存队列。
- 批量运行面板实例预设、`autoforge.json` 编辑继续使用手动保存按钮。
- 不修改 `SchemaValueField`、IPC channel、数据库结构或 preload API。
- 初始化、切换环境和脚本刷新不得误触发保存；组件卸载时清理所有 timer。
- 不提交 git commit，不创建分支。

---

### Task 1: 增加参数与配置快照状态

**Files:**
- Modify: `src/renderer/src/components/DetailPanel.vue:184-220,404-454`

**Interfaces:**
- Produces `savedParamsSnapshot`、`savedConfigSnapshot`、`paramsSaveTimer`、`configSaveTimer` 和保存队列标记，供后续 watcher 与保存函数使用。

- [ ] **Step 1: 定义自动保存状态与 timer**

在现有 `saving`/`detailSaving` refs 附近加入：

```ts
const paramsSaveTimer = ref<ReturnType<typeof window.setTimeout> | undefined>()
const configSaveTimer = ref<ReturnType<typeof window.setTimeout> | undefined>()
const paramsSaveInFlight = ref(false)
const configSaveInFlight = ref(false)
const paramsSaveQueued = ref(false)
const configSaveQueued = ref(false)
let savedParamsSnapshot = ''
let savedConfigSnapshot = ''
let hydratingForm = false
```

使用 `let` timer 而非响应式 ref 也可以，但实现必须在 `onUnmounted` 中调用 `window.clearTimeout` 清理。

- [ ] **Step 2: 添加快照构建函数**

在 `plainParamVars()` 与 `plainEnvVars()` 附近定义：

```ts
function paramsSnapshot(values: Record<string, string>): string {
  return JSON.stringify(values)
}

function configSnapshot(): string {
  return JSON.stringify({
    envId: selectedEnvId.value,
    env: plainEnvVars(),
    cronExpression: normalizeCronExpression(cronExpression.value),
    cronEnabled: cronEnabled.value,
    defaultEnvId: selectedEnvId.value
  })
}
```

`syncParamVars()` 完成后设置 `savedParamsSnapshot = paramsSnapshot(plainParamVars())`；`syncEnvVars()` 与 `syncScheduleFromScript()` 完成后设置 `savedConfigSnapshot = configSnapshot()`，初始化阶段 `hydratingForm = true`，完成后设为 `false`。`plainParamVars()`/`plainEnvVars()` 使用 `Object.fromEntries(Object.entries(reactiveValue))` 生成 IPC 安全对象，dirty 计算不能使用 `toRaw` 绕过依赖追踪。

- [ ] **Step 3: 保持 dirty 计算与快照一致**

让 `paramsDirty` 直接比较 `paramsSnapshot(plainParamVars()) !== savedParamsSnapshot`，配置 dirty 判断使用 `configSnapshot() !== savedConfigSnapshot`。初始化和服务端刷新只更新快照，不调用保存函数。

### Task 2: 实现参数与配置保存队列

**Files:**
- Modify: `src/renderer/src/components/DetailPanel.vue:456-560,812-853`

**Interfaces:**
- Produces `saveParamsNow()`、`saveConfigNow()`、`scheduleParamsSave()`、`scheduleConfigSave()` 和 `flushAutoSaves()`。
- Consumes现有 `cleanupAttachmentDiff()`、`plainParamVars()`、`plainEnvVars()`、`window.autoforge.scripts.*`。

- [ ] **Step 1: 将参数保存逻辑改为可排队的自动保存函数**

把现有 `saveParams()` 的主体重构为：

```ts
async function saveParamsNow(): Promise<void> {
  if (hydratingForm || !paramsDirty.value) return
  if (paramsSaveInFlight.value) {
    paramsSaveQueued.value = true
    return
  }
  const envId = selectedEnvId.value
  const nextParams = plainParamVars()
  const nextSnapshot = paramsSnapshot(nextParams)
  const beforeParams = Object.fromEntries(
    props.script.paramSchema.map((def) => [def.key, savedParamValue(def)])
  )
  paramsSaveInFlight.value = true
  detailSaving.value = true
  try {
    await cleanupAttachmentDiff(props.script.paramSchema, beforeParams, nextParams, 'removed')
    const updated = await window.autoforge.scripts.setParams(props.script.id, envId, nextParams)
    if (!updated) throw new Error('无法保存运行参数')
    savedParamsSnapshot = nextSnapshot
    emit('refresh')
    const envName = environments.value.find((env) => env.id === envId)?.name ?? '当前环境'
    showSaveFeedback('success', '已自动保存', `${envName} 的运行参数已保存`)
  } catch (err) {
    showSaveFeedback('error', '保存失败', err instanceof Error ? err.message : '无法保存运行参数')
  } finally {
    paramsSaveInFlight.value = false
    detailSaving.value = false
    if (paramsSaveQueued.value) {
      paramsSaveQueued.value = false
      void saveParamsNow()
    }
  }
}
```

- [ ] **Step 2: 将配置保存逻辑改为可排队的自动保存函数**

把现有 `saveConfig()` 主体重构为 `saveConfigNow()`，保存 `plainEnvVars()`、`selectedEnvId`、标准化后的 cron 表达式和 `cronEnabled`；调用 `setEnvConfig` 后调用 `scripts.update` 写入 `defaultEnvId` 与 schedule。请求成功后设置 `savedConfigSnapshot = configSnapshot()` 并显示“已自动保存”，失败显示错误且不覆盖本地值。

- [ ] **Step 3: 添加防抖调度与队列刷新**

实现：

```ts
function scheduleParamsSave(): void {
  if (hydratingForm || !paramsDirty.value) return
  if (paramsSaveTimer.value) window.clearTimeout(paramsSaveTimer.value)
  paramsSaveTimer.value = window.setTimeout(() => {
    paramsSaveTimer.value = undefined
    void saveParamsNow()
  }, 400)
}

function scheduleConfigSave(): void {
  if (hydratingForm || configSnapshot() === savedConfigSnapshot) return
  if (configSaveTimer.value) window.clearTimeout(configSaveTimer.value)
  configSaveTimer.value = window.setTimeout(() => {
    configSaveTimer.value = undefined
    void saveConfigNow()
  }, 400)
}

async function flushAutoSaves(): Promise<void> {
  if (paramsSaveTimer.value) {
    window.clearTimeout(paramsSaveTimer.value)
    paramsSaveTimer.value = undefined
    await saveParamsNow()
  }
  if (configSaveTimer.value) {
    window.clearTimeout(configSaveTimer.value)
    configSaveTimer.value = undefined
    await saveConfigNow()
  }
}
```

当参数/配置请求正在执行时，`saveParamsNow`/`saveConfigNow` 只设置 queued，不启动并发写入；当前请求结束后再次读取最新表单快照。

### Task 3: 接入 watcher、运行前刷新和模板

**Files:**
- Modify: `src/renderer/src/components/DetailPanel.vue:567-690,843-853,1231-1484`

**Interfaces:**
- Consumes `scheduleParamsSave()`、`scheduleConfigSave()`、`flushAutoSaves()`。
- Produces自动保存触发、运行前刷新和无手动保存按钮的两个 Tab。

- [ ] **Step 1: 监听参数与配置表单**

在现有 `watch(selectedEnvId, ...)` 后加入：

```ts
watch(paramVars, () => {
  if (!hydratingForm && paramsDirty.value) scheduleParamsSave()
}, { deep: true })

watch([envVars, cronExpression, cronEnabled], () => {
  if (!hydratingForm && configSnapshot() !== savedConfigSnapshot) scheduleConfigSave()
}, { deep: true })
```

切换环境前先 `void flushAutoSaves()`，再执行现有 `syncEnvVars()`/`syncParamVars()`；初始化和 `props.script` 刷新路径设置 `hydratingForm`，完成同步后刷新两个快照。

- [ ] **Step 2: 运行前刷新自动保存**

将 `runWithEnv()` 改为先执行 `await flushAutoSaves()`，再读取 `plainParamVars()` 并调用 runner；如果保存失败，保留现有表单值并让错误反馈可见，但仍使用当前本地参数启动，避免阻塞用户运行。

- [ ] **Step 3: 删除目标 Tab 的手动按钮**

删除“运行参数”底部包含取消/保存的 `<div v-if="script.paramSchema.length && (paramsDirty || detailSaving)">`，删除“配置”底部 `@click="saveConfig"` 的“保存配置”按钮。保留 `cancelParamsDraft`、`cancelDetailDraft` 仅供未使用代码清理后移除；编辑 Tab 与 BatchRunPanel 模板不改。

- [ ] **Step 4: 清理生命周期 timer**

在现有 `onUnmounted` 中清理 `paramsSaveTimer` 和 `configSaveTimer`，并调用 `void flushAutoSaves()`；确保不残留 timeout，不取消已经发出的 IPC。

### Task 4: 验证自动保存与非目标行为

**Files:**
- Test: `src/renderer/src/components/DetailPanel.vue`（现有仓库没有 Vue SFC 单测基础设施，按命令和人工回归验证）

- [ ] **Step 1: 运行 lint**

Run: `npm run lint`

Expected: 0 errors；允许保留仓库现有 warning。

- [ ] **Step 2: 运行单元测试**

Run: `npm run test:unit`

Expected: 20 项现有测试全部通过。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: main、preload、renderer 三段构建成功。

- [ ] **Step 4: 手动回归清单**

验证参数文本连续输入后停止 400ms 自动保存；select/checkbox/附件修改自动保存；配置环境变量与定时任务自动保存；切换环境、切换脚本、关闭详情面板不会丢失最后修改；点击运行前保存队列已刷新；保存失败可通过下一次修改重试；目标 Tab 无保存/取消按钮；编辑 Tab 和批量运行面板仍有手动保存按钮。
