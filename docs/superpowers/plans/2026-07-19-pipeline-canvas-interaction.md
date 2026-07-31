# 流水线画布交互优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with the approved design document; do not introduce subagents or third-party graph libraries.

**Goal:** 让流水线画布以更紧凑的卡片展示节点，并支持“上游完整输出 → 紧邻下游输入字段”的指针端口连线。

**Architecture:** 保持 `PipelineNode`、`PipelineInputMapping`、IPC 和运行器不变，所有新状态集中在 `PipelineEditorView.vue`。画布字段使用指针事件创建连接草稿，正式连接写入现有 `inputMappings`；节点和 SVG 连线继续共享画布世界层的平移/缩放。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、SVG path、现有 GSAP 动画、CSS variables。

## Global Constraints

- 仅允许当前节点输出连接到 `order` 紧邻的下一个节点输入字段。
- 空 `sourcePath` 表示传递上游节点完整返回值，不新增输出 schema。
- 不修改 `PipelineNode`、IPC、数据库和流水线运行器协议。
- 不引入第三方流程图库或新的运行时依赖。
- 保留脚本库原生拖入画布、节点排序、输入映射编辑、保存和运行。
- `prefers-reduced-motion: reduce` 下关闭连接流动和节点位移动画。
- 不添加测试文件；仓库目前没有画布单测，使用现有 lint/build 与手动验收清单。

---

### Task 1: 建立连接草稿与几何辅助状态

**Files:**
- Modify: `src/renderer/src/components/PipelineEditorView.vue:1-370`

**Interfaces:**
- Produces `ConnectionDraft`, `startConnection`, `updateConnectionPreview`, `finishConnection`, `cancelConnection`，供模板端口事件与画布事件调用。
- Reuses `PipelineInputMapping`, `fieldRefs`, `fieldPoint`, `measureConnections`，不改变共享类型。

- [ ] **Step 1: 定义连接状态类型与 refs**

在 `dragSource` 附近加入：

```ts
interface ConnectionDraft {
  sourceNodeId: string
  pointerX: number
  pointerY: number
}

const connectionDraft = ref<ConnectionDraft | null>(null)
const connectionPreviewPath = ref('')
```

- [ ] **Step 2: 增加相邻目标与路径函数**

实现以下函数并复用现有 `fieldPoint`：

```ts
function isAdjacentConnectionTarget(sourceNodeId: string, targetNodeId: string): boolean {
  if (!draft.value) return false
  const sourceIndex = draft.value.nodes.findIndex((node) => node.id === sourceNodeId)
  const targetIndex = draft.value.nodes.findIndex((node) => node.id === targetNodeId)
  return sourceIndex >= 0 && targetIndex === sourceIndex + 1
}

function bezierPath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const distance = Math.max(56, Math.abs(target.x - source.x) * 0.45)
  return `M ${source.x} ${source.y} C ${source.x + distance} ${source.y}, ${target.x - distance} ${target.y}, ${target.x} ${target.y}`
}
```

`measureConnections` 使用 `bezierPath` 生成正式路径，保留现有状态颜色计算。

- [ ] **Step 3: 实现开始、预览、完成和取消**

添加以下行为：

```ts
function startConnection(event: PointerEvent, node: PipelineNode): void
function updateConnectionPreview(event: PointerEvent): void
function finishConnection(node: PipelineNode, targetParam: string): void
function cancelConnection(): void
```

`startConnection` 记录源节点并刷新指针位置；`updateConnectionPreview` 将客户端坐标转换为 track 坐标后连接到指针；`finishConnection` 先校验目标是否为紧邻节点，再以 `{ source: 'previous-result', sourcePath: '', targetParam }` 替换同目标映射；非法目标不修改草稿；`cancelConnection` 清空两项连接态。

- [ ] **Step 4: 绑定取消快捷键并验证类型**

在画布键盘处理函数最前面处理 `Escape`：调用 `cancelConnection()` 并返回；保留方向键滚动逻辑。运行 `npx vue-tsc --noEmit`（若仓库未提供该命令，则记录不可用并进入后续 lint/build）。

预期：连接状态 API 完整，正式映射仍能被现有 `save()` 序列化。

---

### Task 2: 接入端口模板与指针事件

**Files:**
- Modify: `src/renderer/src/components/PipelineEditorView.vue:210-690`

**Interfaces:**
- Consumes Task 1 的连接状态函数。
- Produces可点击的源端口、目标端口和临时连接路径 DOM。

- [ ] **Step 1: 将输出字段改为端口按钮**

在 `pipeline-result-source` 内添加端口按钮，使用 `@pointerdown.stop.prevent="startConnection($event, node)"`，保留“完整输出”文案；移除该字段的 `draggable` 与 `@dragstart`。

- [ ] **Step 2: 为每个目标字段添加端口按钮**

在 `pipeline-param-drop` 右侧添加目标端口按钮，使用 `@click.stop="finishConnection(node, field.key)"`；目标字段本身保留固定值 input 和 `fieldRefs`，不再绑定 `dragover/drop`。

- [ ] **Step 3: 渲染临时连接路径**

在 `workflow-connections` SVG 的正式 `<g v-for>` 之后加入：

```html
<path
  v-if="connectionPreviewPath"
  class="workflow-connection-preview"
  :d="connectionPreviewPath"
  aria-hidden="true"
/>
```

给画布添加 `@pointermove="updateConnectionPreview"`，在 `@pointerdown` 之前保证端口事件使用 `.stop`；画布 `@keydown` 继续处理方向键与 `Escape`。

- [ ] **Step 4: 防止卡片控件触发平移**

更新 `onCanvasPointerDown`：除按钮、输入框、选择框和文本域外，若事件目标位于 `.pipeline-node-card`、`.pipeline-field-links` 或 `.pipeline-mapping-row`，直接返回；仅空白区域允许设置 `isPanning` 和 pointer capture。

预期：点击输出端口可进入连接态，目标端口可完成/替换映射，输入框可编辑且不会启动画布平移；脚本库拖入行为不受影响。

---

### Task 3: 统一画布缩放并压缩卡片尺寸

**Files:**
- Modify: `src/renderer/src/components/PipelineEditorView.vue:35-65, 150-205, 560-590`
- Modify: `src/renderer/src/components/PipelineEditorView.vue:800-980`

**Interfaces:**
- Consumes Task 1 的 `fieldPoint`/路径测量逻辑。
- Produces共享 `canvasScale` 下同步缩放的卡片、字段、SVG 和临时连线。

- [ ] **Step 1: 移除卡片反向缩放**

删除节点卡片上的 `:style="{ zoom: 1 / canvasScale }"`。保留 `canvasTrackStyle` 对整个 track 的统一缩放/平移，使卡片和 SVG 同时变化；根据新的卡片宽度重新计算 track 最小宽高。

- [ ] **Step 2: 收紧缩放范围与滚轮步进**

将 `onCanvasWheel`、`setCanvasScale` 的边界统一为 `0.5` 到 `1.5`，滚轮步进保持 `0.1`，并让 `fitCanvasView` 结果落在同一边界内。缩放后继续 `nextTick(measureConnections)`，确保路径端点更新。

- [ ] **Step 3: 调整卡片与连接器 CSS**

将 `.pipeline-node-card` 的固定宽度改为 `flex-basis: 260px`、最小高度约 `260px`，内边距调为 `14px`；同步收紧 `.pipeline-field-links`、`.pipeline-param-drop` 和 `.pipeline-connector` 的宽高与间距。保留状态边框、选中态和运行态样式。

- [ ] **Step 4: 处理端口显示和连接态样式**

新增 `.pipeline-port-button`、`.pipeline-port-button.is-visible`、`.pipeline-node-card.is-connection-source`、`.pipeline-param-drop.is-connection-target`、`.workflow-connection-preview` 样式：默认端口低对比度，卡片/字段 hover 或连接态时显示；临时路径使用强调色、虚线和较低不透明度；正式路径保留现有成功/运行/错误颜色。

预期：默认视口可同时看到更多节点；缩放 50%–150% 时卡片、字段、连线同步变化，左右面板和工具栏不变。

---

### Task 4: 完成连接生命周期与异常边界

**Files:**
- Modify: `src/renderer/src/components/PipelineEditorView.vue:320-470, 710-990`

**Interfaces:**
- Consumes Task 1–3 的连接态、端口 DOM 和路径状态。
- Produces节点删除/排序/保存/重开后的稳定连接状态。

- [ ] **Step 1: 连接开始前清理冲突状态**

在 `startConnection` 先调用 `cancelConnection()`，再记录新的源节点；在 `selectNode`、`removeNode`、`moveNode` 前后清除连接草稿并调用 `nextTick(measureConnections)`。

- [ ] **Step 2: 处理目标替换和删除同步**

`finishConnection` 使用 `findIndex((mapping) => mapping.targetParam === targetParam)` 替换映射；`removeMapping` 删除后清空路径并重新测量；目标字段仅在源节点相邻且连接态存在时响应。

- [ ] **Step 3: 补齐生命周期清理**

在 `resetDraft`、`attemptLeave` 成功离开、组件 `onUnmounted` 中调用 `cancelConnection()`；在 `watch(() => JSON.stringify(draft.value?.nodes))` 中保留路径重测，避免断连节点造成异常访问。

预期：空白点击、`Escape`、非法目标和节点结构变化都不会留下临时路径或半条映射；保存失败仍保留草稿。

---

### Task 5: 运行验证与手动验收

**Files:**
- Verify: `src/renderer/src/components/PipelineEditorView.vue`
- Verify: `docs/superpowers/specs/2026-07-19-pipeline-canvas-interaction-design.md`

**Interfaces:**
- Consumes全部实现任务。
- Produces可交付的 lint/build 结果与手动验收记录。

- [ ] **Step 1: 运行静态检查**

运行：

```powershell
npm run lint
npm run build
```

预期：两条命令成功；若失败，区分本次组件改动错误与仓库已有错误，不修改无关问题。

- [ ] **Step 2: 验证节点密度与缩放**

启动开发环境后加入 3–4 个脚本，确认默认视口能看到至少两个以上卡片；依次点击缩小、放大、`Ctrl + 滚轮`、适配和重置，确认卡片、字段、SVG 连接线同倍率变化，工具栏/侧栏不变。

- [ ] **Step 3: 验证主动连线**

从节点 1 的“完整输出”端口点击开始，移动到节点 2 的输入字段，确认临时曲线和合法目标高亮；点击完成后确认映射行与正式曲线出现。再次连到另一个字段、重复连接同一字段、删除映射，分别确认替换和消失行为。

- [ ] **Step 4: 验证交互回归**

确认 `Escape`、点击空白、非法目标可取消；确认所有节点的输入框和下拉框可编辑；确认空白区域可平移、节点区域不会误平移；确认脚本库仍可拖入画布。

- [ ] **Step 5: 验证持久化与运行语义**

保存流水线，关闭并重新打开，确认 `source: 'previous-result'` 映射仍在；运行两节点流水线，确认下游收到上游完整返回值，且未引入新的 IPC 或运行器错误。
