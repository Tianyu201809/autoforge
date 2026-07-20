# 流水线两侧面板折叠按钮优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将流水线左右侧栏的展开/收起控件改造成占用更小、方向更明确且具备焦点反馈的极窄边缘把手。

**Architecture:** 继续使用 `PipelineEditorView.vue` 内的 `leftCollapsed`、`rightCollapsed` 状态和现有面板宽度计算，仅调整折叠态占位宽度、按钮语义属性与 CSS 外观。运行抽屉、节点属性、参数配置和画布数据不改动。

**Tech Stack:** Vue 3 `<script setup>`、Lucide Vue icons、组件内 scoped CSS、Electron Vite。

## Global Constraints

- 收起状态侧栏宽度约为 26px，不再保留 48px 宽空轨道。
- 左右按钮使用相反方向箭头，点击切换对应折叠状态。
- 保留面板拖拽调宽、双击恢复默认宽度和运行抽屉布局逻辑。
- 不新增依赖，不修改运行时数据、节点数据或持久化接口。
- 修改后必须通过定向 ESLint、生产构建和 `git diff --check`。

---

### Task 1: 更新折叠按钮语义与结构

**Files:**
- Modify: `src/renderer/src/components/PipelineEditorView.vue:930-1081`

**Interfaces:**
- Consumes: 现有 `leftCollapsed`、`rightCollapsed`、`workflow-collapse-button` 样式和 `ChevronLeft`/`ChevronRight` 图标。
- Produces: 两个带 `aria-label` 的可键盘操作折叠按钮，继续触发原有状态切换。

- [ ] **Step 1: 为左右按钮补充 aria 属性和状态标记**

将按钮保持为原有 `@click` 行为，同时增加 `type="button"`、`aria-label`、`aria-expanded`，并在按钮上区分 left/right 方向类名，确保屏幕阅读器能识别当前面板状态。

- [ ] **Step 2: 保留收起态内容隐藏规则**

确认 `v-if="!leftCollapsed"`、`v-if="!rightCollapsed"` 继续控制内容和拖拽手柄，避免把手收起后渲染隐藏内容造成空白占位。

### Task 2: 重做极窄边缘把手样式

**Files:**
- Modify: `src/renderer/src/components/PipelineEditorView.vue:1207-1214`

**Interfaces:**
- Consumes: `leftSidebarStyle`、`rightSidebarStyle` 的宽度计算和现有 CSS 变量。
- Produces: 展开态贴边胶囊把手、收起态 26px 侧栏边缘把手、hover/focus-visible/active 反馈和平滑过渡。

- [ ] **Step 1: 缩小收起态布局占位**

将 `.workflow-sidebar.is-collapsed` 与 `.workflow-inspector.is-collapsed` 的宽度和 flex-basis 统一调整到 26px，并设置紧凑内边距；保留 `> :not(.workflow-collapse-button)` 隐藏规则。

- [ ] **Step 2: 设计贴边把手视觉**

将 `.workflow-collapse-button` 改为窄胶囊/边缘把手：固定约 22px 宽、34px 高，靠近面板内侧边缘，使用半透明面板背景、细边框和轻阴影；左右侧通过修饰类调整圆角和定位，避免按钮悬空。

- [ ] **Step 3: 添加交互反馈与无障碍焦点**

为 hover、active、focus-visible 增加主题色、轻微横向位移和可见 outline；动画只作用于 transform/background/border，不改变面板布局高度。

### Task 3: 验证布局与编译结果

**Files:**
- Test: `src/renderer/src/components/PipelineEditorView.vue`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的模板及 CSS 修改。
- Produces: 可通过静态检查和生产编译的折叠控件实现。

- [ ] **Step 1: 运行定向 ESLint**

Run: `npx eslint src/renderer/src/components/PipelineEditorView.vue`

Expected: exit code 0，无 lint 输出。

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`

Expected: main、preload 和 renderer bundle 均显示 `built`，命令退出码为 0。

- [ ] **Step 3: 检查差异格式和改动范围**

Run: `git diff --check; git status --short`

Expected: 无空白错误，仅包含本次面板 UI 与计划/规格文档相关改动。
