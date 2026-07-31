# 流水线 Schema 参数与配置隔离设计

## 目标

让流水线编辑器完全复用脚本 manifest 中的参数/环境配置 schema，同时保证流水线自己的参数和配置与脚本单独运行时保存的参数、配置互不读取、互不写回。

## 现状与根因

- 流水线运行抽屉和节点检查器目前使用普通文本输入，丢失 `number`、`textarea`、`select`、`radio`、`checkbox`、`boolean`、`attachment`、默认值、说明和必填信息。
- 配置编辑区域仍在已禁用的旧模板中，用户没有可用的配置入口。
- 流水线参数使用 `nodeId.fieldKey` 命名空间保存到 `PipelineMeta.paramsByEnv`，流水线配置使用相同规则保存到 `PipelineMeta.configByEnv`。
- `PipelineRunnerService` 将流水线值传给 `ScriptRunnerService` 后，脚本运行器仍会从脚本自身的保存数据解析参数/环境，并可能调用脚本参数保存接口，造成数据串扰。

## 设计

### 1. UI 字段复用

继续复用现有 `SchemaValueField` 和 `ParamAttachmentField`，不复制控件逻辑。

- 节点检查器的“固定参数”使用脚本节点自身的 `paramSchema`，值只写入 `PipelineNode.paramValues`。
- 右侧节点属性抽屉使用卡片式“参数 / 配置” Tab；“参数”内分为固定参数和当前环境运行参数，“配置”只显示当前节点的环境配置。
- 当前环境选择器放在右侧节点属性抽屉中，同时作用于运行参数和环境配置；切换环境时只读取当前流水线对应环境的数据。
- 底部运行设置抽屉只显示运行状态、节点进度、日志和错误信息，不再显示参数、配置或环境选择器。
- “运行参数”按节点保存，字段 key 使用 `${node.id}.${field.key}`，值只写入流水线的 `paramsByEnv`。
- “配置”按节点保存，字段 key 使用 `${node.id}.${field.key}`，值只写入流水线的 `configByEnv`。
- `SchemaValueField` 的 `type/options/default/required/secret/description` 原样传入，附件字段使用文件系统安全的 `pipeline__${pipelineId}__${node.id}__${field.key}` 作为附件存储 scope，避免与脚本单独运行的附件目录冲突。

### 2. 执行边界

为脚本运行器增加“已解析值”输入能力：

- 普通脚本运行保持现有行为：从脚本 schema、脚本保存值和运行时覆盖值解析，并继续保存脚本运行参数。
- 流水线运行由 `PipelineRunnerService` 传入最终的 `resolvedParams` 和 `resolvedEnv`；脚本运行器只校验并使用这些值，不再读取脚本的 `paramsByEnv/configByEnv`，也不调用脚本参数保存接口。
- `resolvedParams` 由节点固定值、当前流水线环境参数和输入映射按现有优先级合并。
- `resolvedEnv` 由环境 schema 默认值、全局环境 Profile 值和当前流水线配置覆盖值组成；脚本自己的 `configByEnv` 不参与流水线执行。
- 脚本 schema 仍用于校验字段类型关联的必填/附件约束，但校验失败只影响当前流水线节点。

### 3. 数据隔离约束

以下调用在流水线执行路径中禁止出现：

- `scriptStore.resolveParamsForScript()`
- `scriptStore.setScriptParams()`
- 读取 `script.paramsByEnv`
- 读取 `script.configByEnv`

流水线仍只使用：

- `PipelineNode.paramValues`
- `PipelineMeta.paramsByEnv[envId]`
- `PipelineMeta.configByEnv[envId]`
- 本次运行传入的命名空间参数

### 4. 交互与错误处理

- 选择节点后，右侧属性抽屉默认显示“参数”Tab；底部运行设置打开后直接显示状态与日志。
- 切换环境只切换流水线值，不修改脚本详情页的环境选择或保存值。
- 保存/运行失败时在流水线编辑器内显示错误信息；脚本单独运行的详情页数据不被更新。
- 附件移除只删除当前流水线 scope 产生的附件文件。

## 修改范围

- `src/renderer/src/components/PipelineEditorView.vue`：接入 schema 字段控件、右侧属性 Tab、环境切换、状态日志抽屉与流水线 scope 附件。
- `src/main/services/pipeline-runner.ts`：为流水线节点生成隔离的最终参数和环境值，并传递给脚本运行器。
- `src/main/services/script-runner.ts`：支持调用方传入已解析值；流水线模式下跳过脚本值解析和脚本参数写回。
- `src/main/services/script-store.ts`：提供不读取脚本配置的环境基础值解析方法，供流水线执行使用。

## 验证

1. `npm run build` 通过。
2. 修改文件的定向 ESLint 通过。
3. 静态检查流水线执行路径不再调用脚本参数解析/保存接口。
4. 手动验证：同一脚本先单独保存参数/配置，再在流水线中填写不同值；两种运行结果和后续打开的值互不覆盖。
5. 手动验证环境切换、不同 schema 控件和附件上传/移除均只影响当前流水线。
