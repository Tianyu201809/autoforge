# 流水线 Schema 参数与配置隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 流水线完全复用脚本 schema 控件，并保证流水线参数、配置和附件与脚本单独运行的数据严格隔离。

**Architecture:** 流水线编辑器只编辑 `PipelineNode.paramValues`、`PipelineMeta.paramsByEnv` 和 `PipelineMeta.configByEnv`。执行时由流水线运行器生成最终参数/环境对象，并通过脚本运行器的“已解析值”入口直接执行，从而跳过脚本自身参数、配置的解析与写回。

**Tech Stack:** Electron、TypeScript、Vue 3 Composition API、Vite、SQLite JSON 字段。

## Global Constraints

- 流水线执行不得读取或写回脚本的 `paramsByEnv`、`configByEnv`。
- 普通脚本运行行为保持不变。
- 所有字段复用现有 `SchemaValueField`，不复制 schema 控件逻辑。
- 流水线附件必须使用独立 storage scope。
- 不新增数据库迁移，不修改现有流水线 JSON 结构。
- 未经用户明确要求不创建 Git 提交。

---

### Task 1: 为脚本运行器增加隔离执行入口

**Files:**
- Modify: `src/main/services/script-runner.ts:45-155`
- Verify: `src/main/services/script-runner.ts`

**Interfaces:**
- Consumes: `ScriptStartOptions.resolvedParams?: Record<string, string>`、`ScriptStartOptions.resolvedEnv?: Record<string, string>`。
- Produces: 普通脚本沿用原解析流程；流水线可传入最终值并跳过脚本存储读写。

- [ ] **Step 1: 扩展内部启动选项**

在 `ScriptStartOptions` 中增加：

```ts
resolvedEnv?: Record<string, string>
resolvedParams?: Record<string, string>
```

并让 `startAndWait()` 的最后一个参数继续接受这两个字段及原有回调字段。

- [ ] **Step 2: 按来源选择最终环境值**

将环境解析改为：

```ts
const env = options?.resolvedEnv
  ? { ...options.resolvedEnv }
  : {
      ...scriptStore.resolveEnvForScript(script, resolvedEnvId),
      ...(options?.envOverrides ?? {})
    }
```

流水线传入 `resolvedEnv` 时，不再调用 `resolveEnvForScript()`，因此脚本自己的 `configByEnv` 不会进入流水线。

- [ ] **Step 3: 按来源选择最终参数并阻止写回**

将参数解析和保存改为：

```ts
const params = options?.resolvedParams
  ? { ...options.resolvedParams }
  : scriptStore.resolveParamsForScript(script, resolvedEnvId, runtimeParams)

if (!options?.resolvedParams) {
  scriptStore.setScriptParams(scriptId, resolvedEnvId, params)
}
```

两条路径都继续调用 `validateEnvForScript()` 和 `validateParamsForScript()`。

- [ ] **Step 4: 定向检查脚本运行器**

Run: `npx eslint src/main/services/script-runner.ts`

Expected: 退出码为 `0`。

### Task 2: 生成严格隔离的流水线执行值

**Files:**
- Modify: `src/main/services/script-store.ts:120-139`
- Modify: `src/main/services/pipeline-runner.ts:117-130, 162-204`
- Verify: `src/main/services/pipeline-runner.ts`, `src/main/services/script-store.ts`

**Interfaces:**
- Consumes: 脚本 schema 默认值、全局环境 Profile、流水线 `configByEnv/paramsByEnv`、节点固定参数和映射结果。
- Produces: `resolvedEnv`、`resolvedParams`，供 Task 1 的隔离入口使用。

- [ ] **Step 1: 添加不读取脚本配置的环境解析方法**

在 `ScriptStore` 中新增 `resolveEnvForPipeline(script, envId)`，仅合并 schema 默认值和环境 Profile：

```ts
resolveEnvForPipeline(script: ScriptMeta, envId?: string): Record<string, string> {
  const resolvedEnvId = envId ?? this.getDefaultEnvironment().id
  const profile = this.getEnvironment(resolvedEnvId)
  const resolved: Record<string, string> = {}
  for (const def of script.envSchema) {
    const defaultVal = defaultSchemaValue(def)
    if (defaultVal) resolved[def.key] = defaultVal
  }
  for (const [key, value] of Object.entries(profile?.variables ?? {})) {
    if (value !== undefined && value !== '') resolved[key] = value
  }
  return resolved
}
```

该方法不得读取 `script.configByEnv`。

- [ ] **Step 2: 在流水线运行器中合并流水线配置**

先读取流水线命名空间配置，再覆盖到基础环境：

```ts
const pipelineEnv = this.resolveNodeValues(
  pipeline,
  node,
  script.envSchema.map((field) => field.key),
  runtimeParams,
  'env',
  session.envId
)
const resolvedEnv = {
  ...scriptStore.resolveEnvForPipeline(script, session.envId),
  ...pipelineEnv
}
```

- [ ] **Step 3: 通过隔离入口启动脚本节点**

将映射后的 `mappedParams` 和 `resolvedEnv` 放入 `startAndWait()` 的 options：

```ts
{
  resolvedParams: mappedParams,
  resolvedEnv,
  onLog: (line) => this.handleChildLog(session, nodeSession, line),
  onSession: (childSession) => { /* 保留现有状态同步 */ }
}
```

不再把流水线环境作为普通 `envOverrides` 依赖脚本解析路径。

- [ ] **Step 4: 静态验证隔离边界**

Run: `rg -n "resolveParamsForScript|setScriptParams|script\.paramsByEnv|script\.configByEnv" src/main/services/pipeline-runner.ts`

Expected: 无匹配结果。

### Task 3: 在节点属性抽屉复用 Schema 控件

**Files:**
- Modify: `src/renderer/src/components/PipelineEditorView.vue:1-725, 891-1050`
- Reuse: `src/renderer/src/components/SchemaValueField.vue`
- Reuse: `src/renderer/src/components/ParamAttachmentField.vue`

**Interfaces:**
- Consumes: `ScriptMeta.paramSchema`、`ScriptMeta.envSchema`、`SchemaValueField`。
- Produces: 节点固定参数编辑、按环境流水线参数/配置编辑、状态日志展示。

- [ ] **Step 1: 引入 Schema 控件并定义节点属性页签**

导入 `SchemaValueField`，增加：

```ts
type InspectorTab = 'params' | 'config'
const inspectorTab = ref<InspectorTab>('params')
```

- [ ] **Step 2: 增加命名空间字段和值更新辅助函数**

提供明确的 key 和附件 scope：

```ts
function pipelineFieldKey(node: PipelineNode, fieldKey: string): string {
  return `${node.id}.${fieldKey}`
}

function pipelineAttachmentKey(node: PipelineNode, fieldKey: string): string {
  return ['pipeline', draft.value?.id || 'draft', node.id, fieldKey]
    .map((segment) => segment.replace(/[^A-Za-z0-9_.-]/g, '_'))
    .join('__')
}

function setRuntimeValue(kind: 'params' | 'config', key: string, value: string): void {
  const target = kind === 'params' ? runtimeValues : runtimeConfig
  target.value = { ...target.value, [key]: value }
}
```

- [ ] **Step 3: 替换节点固定参数输入**

右侧节点检查器对每个 `paramSchema` 字段使用：

```vue
<SchemaValueField
  :def="field"
  :model-value="fixedParamValue(selectedNode, field.key)"
  :script-id="selectedNode.scriptId"
  :attachment-storage-key="pipelineAttachmentKey(selectedNode, `fixed.${field.key}`)"
  :show-key="false"
  show-clear
  @update:model-value="setFixedParamValue(selectedNode, field.key, $event)"
/>
```

该事件只能修改 `selectedNode.paramValues`。

- [ ] **Step 4: 实现参数与配置页签**

右侧节点属性抽屉显示环境选择器和“参数 / 配置”卡片式页签。参数页显示当前节点的固定参数和当前环境运行参数，配置页显示当前节点 `envSchema`；字段的 `modelValue` 分别来自 `node.paramValues`、`runtimeValues` 和 `runtimeConfig`。

每个字段均传入完整 schema、节点 `scriptId` 和独立附件 scope。不得调用 `window.autoforge.scripts.setParams()`、`scripts.update()` 或脚本配置保存 API。

- [ ] **Step 5: 将运行设置收敛为状态与日志**

底部运行设置只保留节点状态、失败信息和流水线日志，移除参数、配置和环境入口；运行开始或失败时自动展开，日志合并逻辑保持不变。

- [ ] **Step 6: 清理禁用的旧表单模板**

删除 `v-if="false"` 的旧参数/配置表单，避免同时维护两套实现。

- [ ] **Step 7: 定向检查 Vue 文件**

Run: `npx eslint src/renderer/src/components/PipelineEditorView.vue`

Expected: 退出码为 `0`。

### Task 4: 回归验证隔离和字段格式

**Files:**
- Verify: `src/main/services/script-runner.ts`
- Verify: `src/main/services/pipeline-runner.ts`
- Verify: `src/main/services/script-store.ts`
- Verify: `src/renderer/src/components/PipelineEditorView.vue`

**Interfaces:**
- Consumes: Tasks 1-3 的执行入口和 UI。
- Produces: 可构建、可静态验证且满足隔离约束的实现。

- [ ] **Step 1: 运行差异检查和定向 ESLint**

Run: `git diff --check; npx eslint src/main/services/script-runner.ts src/main/services/pipeline-runner.ts src/main/services/script-store.ts src/renderer/src/components/PipelineEditorView.vue`

Expected: 两条命令退出码均为 `0`。

- [ ] **Step 2: 运行完整构建**

Run: `npm run build`

Expected: main、preload、renderer 三个 bundle 构建成功。

- [ ] **Step 3: 手动验证 schema 控件**

创建包含 `textarea`、`number`、`select`、`radio`、`checkbox`、`boolean`、`attachment` 的脚本，将其加入流水线，确认固定参数、流水线参数和配置入口的控件与脚本详情一致。

- [ ] **Step 4: 手动验证双向隔离**

1. 在脚本详情中保存参数和配置 A。
2. 在流水线同一环境中保存不同的参数和配置 B。
3. 单独运行脚本，确认使用 A。
4. 运行流水线，确认使用 B。
5. 再次打开脚本详情和流水线，确认两边保存值均未被对方覆盖。
6. 分别删除脚本附件和流水线附件，确认不会删除另一侧仍在使用的文件。
