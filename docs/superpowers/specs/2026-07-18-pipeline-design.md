# 流水线功能设计

## 背景与目标

Autoforge 当前以单个脚本为运行单元。脚本已经具备统一的 `run(ctx)` 入口、`ctx.env` 环境配置、`ctx.params` 运行参数和返回结果。流水线功能在此基础上允许用户把已有脚本按顺序串联，前一个脚本的返回值传递给后一个脚本，最终以流水线方式运行并查看结果。

第一版范围限定为线性流水线：节点按固定顺序执行，不支持条件分支、并行和循环。

## 设计决策

### 1. 流水线是独立资源

流水线不生成临时脚本包，也不修改被引用的脚本目录。它作为独立资源保存，拥有自己的名称、节点顺序、输入 schema、环境配置、运行参数、运行状态和执行历史。

流水线节点只保存脚本引用和编排信息。脚本被删除或不可用时，流水线在运行前校验并提示具体节点。

### 2. 输入输出协议

每个节点仍使用现有脚本运行契约：

- `ctx.env`：该节点解析后的环境变量。
- `ctx.params`：该节点解析后的业务参数。
- `ctx.input`：上一个节点的完整返回值；第一个节点的值为空。
- `run(ctx)` 返回值：当前节点结果。

节点结果既作为下一个节点的 `ctx.input`，也写入流水线会话的步骤结果列表。流水线最终结果默认为最后一个节点的返回值，同时保留所有节点的状态、时间和结果。

### 3. 参数和环境配置隔离

流水线页面展示所有节点输入参数和配置的总和，但内部按节点隔离保存，避免多个脚本出现同名参数时互相覆盖：

```ts
{
  "node-read-order": { "ORDER_ID": "A1001" },
  "node-generate-report": { "OUTPUT_DIR": "D:\\reports" }
}
```

流水线的 `paramSchema` 和 `envSchema`由节点 schema 聚合生成，字段带有节点上下文用于展示和定位。运行时再还原为每个节点自己的参数与环境对象。

### 4. 输入映射

流水线支持两种输入来源，并同时保留：

- `previous-result`：上一步完整返回值，始终可通过 `ctx.input` 访问。
- `pipeline-input`：流水线级输入参数，可映射到任意节点参数。

映射使用简单的点路径，例如 `data.orderId`、`items.0.name`、`result.filePath`，不引入表达式语言。映射值优先级高于脚本默认值和已保存值。

```ts
interface InputMapping {
  source: 'previous-result' | 'pipeline-input'
  sourcePath?: string
  targetParam: string
}
```

如果未配置映射，节点仍可读取完整的 `ctx.input`。如果映射路径不存在，节点不启动，流水线直接失败并展示“源字段不存在”。

## 数据模型

```ts
interface PipelineMeta {
  id: string
  name: string
  description?: string
  nodes: PipelineNode[]
  envSchema: EnvVarDefinition[]
  paramSchema: ParamDefinition[]
  configByEnv?: Record<string, Record<string, string>>
  paramsByEnv?: Record<string, Record<string, string>>
  starred?: boolean
  archived?: boolean
}

interface PipelineNode {
  id: string
  scriptId: string
  name: string
  order: number
  inputMappings?: InputMapping[]
}
```

建议新增 SQLite 表：

- `pipelines`
- `pipeline_nodes`
- `pipeline_preferences`
- `pipeline_execution_records`
- `pipeline_node_execution_records`

流水线执行历史与脚本历史分开存储，避免现有脚本记录查询依赖脚本目录元数据。

## 执行架构

新增 `PipelineRunnerService` 负责编排，复用现有脚本运行器的校验、依赖安装、JS/Python 执行、日志、进度、停止和生命周期能力。脚本执行器需要提供可等待完成的内部调用，供流水线逐节点等待，而不是仅返回已创建的会话。

执行顺序：

1. 创建流水线会话并校验流水线输入。
2. 校验所有节点引用的脚本、环境和参数。
3. 启动当前节点并等待完成。
4. 保存节点结果和生命周期状态。
5. 将节点结果作为下一节点的 `ctx.input`，并解析输入映射。
6. 成功执行全部节点后生成流水线最终结果。

流水线会话保留节点执行明细：

```ts
{
  final: lastResult,
  steps: [
    { nodeId, scriptId, status, result, startedAt, finishedAt }
  ]
}
```

任意节点失败时默认停止后续节点，但保留已经完成节点的结果。停止流水线时，同时停止当前脚本节点；最终状态区分 `failed` 和 `stopped`。

## 制作页交互

第一版制作页采用左右两栏：

- 左侧：可用脚本列表，支持搜索和分类筛选。
- 右侧：线性流水线画布，展示节点顺序和连接关系。

用户可以添加、删除、拖拽排序节点，修改节点显示名称，查看节点参数和配置，配置输入映射，保存或另存为流水线。

保存前校验：

- 至少包含一个节点。
- 所有脚本引用仍然存在。
- 节点顺序连续。
- 映射目标参数存在。
- 映射源路径格式合法。
- 同一目标参数没有冲突映射。
- 不存在循环引用。

## 运行与展示

流水线像脚本一样提供运行、停止、收藏、归档和历史查看入口。运行面板展示整体状态和节点进度：

```text
流水线运行中
├─ ✓ 读取订单       已完成
├─ ● 生成报表       运行中
└─ ○ 发送邮件       等待中
```

运行参数页面按节点分组展示聚合后的参数和配置。流水线历史详情展示最终结果、每个节点结果、失败节点和完整日志。

新增 IPC / preload API：

```ts
window.autoforge.pipelines.list()
window.autoforge.pipelines.create()
window.autoforge.pipelines.update()
window.autoforge.pipelines.delete()
window.autoforge.pipelines.run()
window.autoforge.pipelines.stop()
window.autoforge.pipelines.getSession()
```

## 验证范围

- 参数与环境配置聚合及节点隔离。
- 同名参数不会互相覆盖。
- 节点严格按顺序执行。
- `ctx.input` 完整传递。
- 点路径映射成功、缺失和冲突场景。
- 任意节点失败后停止后续节点。
- 停止流水线会终止当前脚本。
- JS 和 Python 脚本均可作为节点。
- 流水线执行历史、节点明细和最终结果展示。

## 非目标

第一版不包含条件分支、并行节点、循环节点、跨流水线嵌套、远程执行和复杂表达式映射。
