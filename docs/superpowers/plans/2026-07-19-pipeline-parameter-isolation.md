# 流水线参数隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让流水线节点参数与原始脚本参数完全独立，已有节点缺失值时按空值运行，不再读取脚本默认参数。

**Architecture:** 保留现有流水线数据结构：节点固定值使用 `PipelineNode.paramValues`，按环境运行值使用 `PipelineMeta.paramsByEnv`。只修改流水线参数解析和编辑器节点初始化/运行参数展示，不改变普通脚本运行器的参数解析。

**Tech Stack:** Electron、TypeScript、Vue 3、Vite、SQLite JSON 字段。

## Global Constraints

- 流水线执行不得读取原始脚本的 `savedParams`、`paramsByEnv` 或 `scriptStore.resolveParamsForScript()`。
- 已存在的 `PipelineNode.paramValues` 和 `PipelineMeta.paramsByEnv` 必须原样保留。
- 不新增数据库迁移；现有 JSON 字段足以表达隔离数据。
- 普通脚本运行逻辑保持不变。

---

### Task 1: 修改流水线节点参数解析

**Files:**
- Modify: `src/main/services/pipeline-runner.ts:188-204`
- Test/verify: `npm run build`

**Interfaces:**
- Consumes: `PipelineNode.paramValues`、`pipeline.paramsByEnv`、运行时 `runtimeParams`。
- Produces: 仅由流水线数据生成的 `Record<string, string>`，继续供 `startAndWait()` 使用。

- [ ] **Step 1: 删除原始脚本参数回退**

将 `resolveNodeParams()` 从“脚本参数 + 节点固定值 + 流水线值”改为仅合并流水线值：

```ts
private resolveNodeParams(
  pipeline: PipelineMeta,
  node: PipelineNode,
  script: ScriptMeta,
  runtimeParams: Record<string, string>,
  envId?: string
): Record<string, string> {
  const pipelineValues = this.resolveNodeValues(
    pipeline,
    node,
    script.paramSchema.map((field) => field.key),
    runtimeParams,
    'params',
    envId
  )
  return {
    ...(node.paramValues ?? {}),
    ...pipelineValues
  }
}
```

`script` 仍用于读取 schema key，不再调用 `scriptStore.resolveParamsForScript()`；`runtimeParams` 的流水线命名空间覆盖节点固定值，连线映射仍在后续 `applyMappings()` 中覆盖目标字段。

- [ ] **Step 2: 检查空值行为**

确认没有节点固定值、没有流水线环境值、没有运行时值时返回 `{}`，不从脚本存储补值；脚本自身的必填参数校验继续由 `ScriptRunnerService.start()` 执行。

- [ ] **Step 3: 运行构建验证**

Run: `npm run build`

Expected: main、preload、renderer 三个 bundle 均构建成功。

### Task 2: 确保编辑器只创建流水线参数

**Files:**
- Modify: `src/renderer/src/components/PipelineEditorView.vue:400-445, 580-610`
- Modify if needed: `src/main/services/pipeline-store.ts:50-105`
- Test/verify: `npx eslint src/main/services/pipeline-store.ts src/main/services/pipeline-runner.ts src/renderer/src/components/PipelineEditorView.vue`

**Interfaces:**
- Consumes: 节点 schema、`node.paramValues`、运行抽屉 `runtimeValues`。
- Produces: 节点固定参数写入流水线节点；运行参数写入流水线 `paramsByEnv`，不调用脚本参数保存接口。

- [ ] **Step 1: 检查节点创建默认值**

确认 `addNode()` 创建节点时使用 `paramValues: {}` 或不设置该字段，不调用 `scriptStore.resolveParamsForScript()`，也不把脚本保存参数复制到节点。

- [ ] **Step 2: 保持节点固定值独立编辑**

确认 `fixedParamValue()` 只从 `node.paramValues` 读取，`onFixedParamInput()` 只更新当前 draft 节点的 `paramValues`；保存时通过 `pipelines.update()` 持久化节点数据。

- [ ] **Step 3: 保持运行参数写入流水线存储**

确认 `run()` 继续将 `runtimeValues` 传给 `pipelines.setValues()` 和 `pipelines.start()`，键保持 `nodeId.paramKey` 命名空间；不要调用 `runner` 的参数保存 API。

- [ ] **Step 4: 运行前端 lint**

Run: `npx eslint src/main/services/pipeline-store.ts src/main/services/pipeline-runner.ts src/renderer/src/components/PipelineEditorView.vue`

Expected: 命令退出码为 0，无 lint 错误。

### Task 3: 回归验证参数隔离

**Files:**
- Inspect: `src/main/services/script-store.ts`
- Inspect: `src/main/services/script-runner.ts`
- Verify: `src/main/services/pipeline-runner.ts`, `src/renderer/src/components/PipelineEditorView.vue`

**Interfaces:**
- Consumes: 普通脚本运行参数链路和流水线运行参数链路。
- Produces: 可复现的隔离验证结果和最终构建产物。

- [ ] **Step 1: 静态搜索原始参数依赖**

Run: `rg -n "resolveParamsForScript|savedParams|script\.paramsByEnv" src/main/services/pipeline-runner.ts src/renderer/src/components/PipelineEditorView.vue`

Expected: 流水线文件不再出现这些原始脚本参数读取；普通脚本文件仍可保留自己的参数逻辑。

- [ ] **Step 2: 执行完整构建和差异检查**

Run: `git diff --check; npm run build`

Expected: 无空白错误，构建成功。

- [ ] **Step 3: 手动验证隔离场景**

1. 为脚本单独保存一个参数值。
2. 将脚本加入流水线，不设置节点固定值和流水线运行值，确认不会显示/使用该脚本保存值。
3. 在节点检查器设置固定值，运行后确认仅流水线使用该值。
4. 修改原始脚本参数后再次运行流水线，确认流水线结果不变。
5. 在运行抽屉设置流水线值，确认该值覆盖节点固定值且只影响流水线。

- [ ] **Step 4: 提交实现**

```bash
git add src/main/services/pipeline-runner.ts src/renderer/src/components/PipelineEditorView.vue src/main/services/pipeline-store.ts
git commit -m "fix: isolate pipeline script parameters"
```
