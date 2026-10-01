# 仓库导入：多轮转换对话、思考过程与工作区删除 — 设计规格

**日期**：2026-10-01  
**状态**：待实现  
**关联**：`docs/superpowers/specs/2026-09-30-repo-to-script-design.md`（拉取、画像、两阶段 LLM 转换、构建授权仍以该规格为准）

---

## 1. 目标

在「从仓库导入」的转换步骤里，把一次性的「补充要求」改成可多轮的对话。用户可以在导入前反复提出要求，每一轮都带上先前对话，把脚本包整份重新生成。模型的思考过程可以展开查看。删除转换工作区时，连同本机克隆目录一起删除，并先做二次确认。

导入到脚本列表之后，不再继续这段对话。已导入脚本的目录不受工作区删除影响。外部 Agent 路径（复制交接提示词）保持不变。

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 对话位置 | 只在「从仓库导入」弹窗的转换步骤 |
| 跟进一轮的效果 | 带上先前对话，整份重新生成脚本包，不在旧文件上打补丁 |
| 思考过程 | 每一轮助手回复可展开；没有思考通道时不显示入口 |
| 对话保留 | 写在该工作区里，关掉弹窗再从「最近工作区」打开仍然在 |
| 取消 | 转换进行中可以取消；取消后上一份成功产物保留 |
| 删除 | 删除工作区前确认；确认后删除整个工作区目录，包括克隆的仓库 |
| 不做 | 导入后在脚本详情里继续聊；按文件打补丁；删脚本时连带删克隆 |

## 3. 对话交互

转换步骤用对话记录替换现在的单行补充要求和纯日志块。

- 还没有对话时，输入可以为空。点「开始转换」按仓库直接生成，与现在不填补充要求相同。
- 已经有对话时，必须写下新的要求才能发送。
- 一轮进行中，输入不可用，主按钮变为「取消」。不能同时开第二轮。
- 助手回复默认收起「思考过程」。展开后看到这一轮模型推理的原文。
- 回复正文只保留结果摘要：计划摘要、写入的文件、复制条目、构建是否执行、告警。
- 取消的一轮标成「已取消」。失败的一轮标成「失败」，并显示原因。
- 检测到可导入的 `autoforge.json` 后，仍进入现有的「导入并试运行」。导入成功后这段对话结束，不带到脚本详情。

阶段日志（「已接收 N KB」、构建输出）留在当前这一轮下面，不混进思考过程。

## 4. 数据流

### 4.1 工作区文件

```
<userData>/repo-workspaces/<taskId>/
├── repo/                              # 克隆或解压出的仓库
└── .autoforge/
    ├── profile.json
    ├── HANDOFF.md
    ├── conversation.json              # 对话记录
    ├── package/                       # 最近一次成功的脚本包
    └── package-next/                  # 进行中的一轮；成功后才替换 package/
```

`conversation.json` 只存在于该工作区，不进脚本库，也不进 SQLite。

```ts
type ConversionTurnStatus = 'running' | 'complete' | 'cancelled' | 'error'

interface ConversionTurn {
  id: string
  role: 'user' | 'assistant'
  /** 用户原话，或助手的结果摘要 */
  content: string
  /** 仅助手轮次。模型思考原文；没有则为空 */
  thinking?: string
  status: ConversionTurnStatus
  error?: string
  createdAt: string
}

interface ConversionConversation {
  turns: ConversionTurn[]
}
```

打开工作区时读出 `turns`，随 `RepoWorkspaceInfo` 返回。若文件里仍有 `running` 的助手轮次，读入时改为 `error`，原因是「上次转换未完成」，并删掉残留的 `package-next/`。用户消息在发送时立即写入。助手轮次在结束（成功、取消、失败）时写入最终内容。思考过程在生成期间节流刷新到同一条助手轮次，避免进程中断后完全丢失。

阶段日志只在当次转换期间显示，不写入 `conversation.json`。

### 4.2 发给模型的历史

沿用现有两阶段转换：计划骨架（JSON）之后逐文件生成正文。每一轮都重新跑完整两阶段。

放进提示词的历史只有：

- 先前每一轮的用户原话
- 先前每一轮助手的结果摘要（摘要、文件路径、告警）

不放入思考原文，不放入已生成文件的正文。仓库画像与仓库上下文仍按现有 `repo-digest` 规则每次附上。第一轮没有额外要求时，不添加「本轮要求」段落。

最新一条用户消息单独标成「本轮要求」，让模型按它重新设计整份脚本包。

### 4.3 思考过程

流式增量里，正文仍读 `delta.content`。思考过程先读 `delta.reasoning_content`，没有则读 `delta.reasoning`。非流式回退时按同样顺序读 `message` 上的这两个字段。都没有，则这一轮没有思考过程。

同一轮里的多次模型调用（骨架、每个生成文件）按调用顺序拼接，每段前面加简短标签，例如「转换计划」「文件 index.mjs」。界面收到节流后的全文用于展开查看；落盘的 `thinking` 以主进程累计的完整文本为准。

### 4.4 产物替换

新一轮写入 `.autoforge/package-next/`，不直接改 `.autoforge/package/`。

成功且校验通过之后：

1. 若 `package/` 已存在，先改名为 `package-prev/`
2. 把 `package-next/` 改名为 `package/`
3. 删除 `package-prev/`

第 2 步失败时，把 `package-prev/` 改回 `package/`，并把这一轮标成失败。取消或失败发生在替换之前时，只删除 `package-next/`，`package/` 保持不变。

因此取消或失败之后，导入用的仍是上一份成功产物；若从未成功过，则仍然不能导入。

### 4.5 取消

新增 `repo:cancel-llm`，入参为 `taskId`。主进程为当前转换持有一个 `AbortController`，传给已有的 LLM `signal`。构建命令同样监听这个信号，并终止对应进程树。取消后该轮状态为 `cancelled`，进行中的请求停止，不替换 `package/`。

已有的「已有仓库正在转换」单任务锁保持不变。

## 5. 删除工作区

「最近工作区」里的删除先调用现有 `askConfirm`：

- 标题：删除工作区
- 说明：写明将删除的工作区绝对路径，并说明其中的克隆仓库和转换产物会一起删除；脚本列表里已经导入的脚本不会删除
- 确认按钮：删除
- 样式：`danger`

用户取消则什么都不做。确认后删除 `<userData>/repo-workspaces/<taskId>/` 整目录。删除使用可重试的递归删除。调用返回后若目录仍在，向用户提示删除失败，并保留列表项。目录已经不在，才提示已删除并刷新列表。

不删除脚本库中的脚本目录。

## 6. 错误处理

| 情况 | 结果 |
|------|------|
| 输出被截断、模型无内容、计划校验失败、写盘失败、构建失败 | 该轮 `error`，原因写入对话；删除 `package-next/`；旧 `package/` 保留 |
| 用户取消 | 该轮 `cancelled`；停止模型和构建；删除 `package-next/`；旧 `package/` 保留 |
| 替换 `package/` 失败 | 尽量恢复 `package-prev/`；该轮 `error` |
| 模型没有思考字段 | 不显示「思考过程」 |
| 已有对话时发送空消息 | 不发送 |
| 一轮尚未结束又发起转换 | 拒绝，沿用单任务锁的提示 |
| 工作区目录删不掉 | 提示失败，列表项保留 |

## 7. 模块

| 位置 | 改动 |
|------|------|
| `src/shared/llm-types.ts` | 对话轮次类型；转换请求带上对话历史 |
| `src/shared/repo-types.ts` | 工作区信息带上 `turns`；产物暂存目录名 |
| `src/shared/ipc-channels.ts` | `repo:cancel-llm`；思考过程事件 |
| `src/main/services/llm-client.ts` | 从流式与非流式响应中拆出思考文本 |
| `src/main/services/llm-converter.ts` | 把历史摘要写入提示词；写入 `package-next/`；成功后替换；响应取消 |
| `src/main/services/repo-build-runner.ts` | 构建接受取消信号并终止进程树 |
| `src/main/services/repo-workspace.ts` | 读写 `conversation.json`；删除后确认目录已消失 |
| `src/main/services/repo-conversion-service.ts` | 按 `taskId` 持有取消控制器 |
| `src/renderer/src/composables/useRepoImport.ts` | 对话状态、发送、取消、删除确认 |
| `src/renderer/src/components/RepoImportModal.vue` | 对话列表、可展开的思考过程、取消按钮 |

预加载脚本与 IPC handler 随新通道补齐。

## 8. 测试

- 流式帧里的 `reasoning_content` 与 `content` 分开累计；没有思考字段时思考文本为空。
- 第二轮提示词包含先前用户原话和助手摘要，不包含思考原文，也不包含文件正文。
- 成功时 `package-next/` 成为 `package/`；取消或失败后 `package/` 仍是上一份，`package-next/` 不保留。
- 删除工作区前必须经过确认。确认后目录不存在才算成功；目录仍在则返回失败。

## 9. 非目标

- 导入之后的脚本详情对话，以及现有「AI 修复」弹窗的思考过程。
- 只修改用户点名的文件。
- 删除脚本列表中的脚本时，连带删除仓库克隆。
- 自动运行导入后的脚本。
