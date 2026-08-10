# 文本输入框文件路径拖入设计

## 背景

Autoforge 的脚本导入区已经可以从 Electron 拖放事件中读取本地文件的绝对路径，但应用中的普通文本输入框和多行文本框无法直接接收拖入的文件路径。用户需要先手动复制路径，尤其在配置脚本参数和环境变量时效率较低。

## 目标

1. 在所有可编辑的文本 `input` 与 `textarea` 上支持拖入本地文件或目录并写入绝对路径。
2. 保持现有 `v-model` 与手写 `@input` 处理方式兼容，使既有保存、校验和脏状态逻辑照常触发。
3. 在文件拖至有效输入框上方时提供统一、克制的主题高亮反馈。
4. 复用 Electron `webUtils.getPathForFile()` 的路径解析能力，不通过 IPC 或主进程读取文件内容。

## 非目标

- 不向 `number`、`checkbox`、`radio`、`file`、`password` 或只读输入框写入路径。
- 不修改选择框、Cron 构建器、搜索框或脚本附件字段的语义。
- 不读取、上传、复制、移动或导入拖入的文件；功能只写入路径字符串。
- 不更改脚本导入区域已有的拖入处理。

## 方案

新增全局 Vue 指令 `v-file-path-drop`，在主窗口的 Vue 应用创建时注册。指令仅绑定原生 `HTMLInputElement` 和 `HTMLTextAreaElement`，并由 renderer 全局事件处理统一将有效文件拖放附着到符合条件的文本控件。

路径解析继续在 preload 中执行：新增通用的 `setupFilePathDropTarget(element)`，从 `DragEvent.dataTransfer.files` 或回退的 `items` 中使用 `webUtils.getPathForFile()` 提取系统绝对路径。现有脚本导入的路径收集逻辑共用该底层提取函数。

有效目标条件：

- `textarea` 必须未禁用且未只读。
- `input` 必须未禁用且未只读，且 `type` 为省略类型或 `text`、`search`、`url`、`email`、`tel`。
- `password`、`number`、`checkbox`、`radio`、`file`、`hidden`、日期/时间类及其他非文本输入类型不绑定。

每次拖放提取到的路径按原始拖入顺序、以换行符连接，并完全替换控件当前值。使用原生 `input` 事件（`bubbles: true`）通知 Vue，确保 `v-model` 与现有 `@input` 回调都更新对应状态。没有可解析路径时不改变控件值。

## 交互与可访问性

- 只有存在可解析文件路径时才拦截 `dragover` 和 `drop`，避免妨碍非文件拖放或其他组件的拖拽行为。
- 有效文件悬停时给控件添加 `is-file-path-drop-target` 类，使用现有主题变量呈现边框与轻度内阴影高亮。
- `dragleave`、`drop`、指令卸载和控件失效时移除高亮类。
- 不改变焦点、不弹 Toast、不新增键盘快捷键；拖入结果与用户手动输入等价。

## 接口与文件范围

- `src/preload/script-drop.ts`：抽取路径收集函数；新增绑定到单个输入元素的路径拖放函数。
- `src/preload/index.ts`：将新函数暴露为 `window.autoforge.files.setupPathDropTarget`。
- `src/renderer/src/env.d.ts`：补充 preload API 类型。
- `src/renderer/src/directives/file-path-drop.ts`：封装指令绑定/卸载和目标类型判定，调用 preload API。
- `src/renderer/src/main.ts`：全局注册 `file-path-drop` 指令。
- `src/renderer/src/assets/main.css`：添加主题一致的拖入高亮样式。

## 测试计划

1. preload 路径收集：单文件、多文件顺序、`items` 回退、无文件路径。
2. preload 绑定：可解析路径写入换行分隔文本、派发可冒泡 `input` 事件、无路径不改值、拖入反馈清理。
3. renderer 指令：仅为允许的文本输入和文本框绑定，排除密码、数值、复选框和只读/禁用控件，并在卸载时解绑。
4. 手工验收：参数文本框和环境变量文本框的单文件、多文件拖放；确认 `v-model` 已更新；检查深浅主题与窄窗口下高亮无溢出。

## 验收标准

1. 用户可将文件或目录拖到任一符合范围的文本输入框或文本框，绝对路径立即写入。
2. 多文件路径按拖入顺序以换行符写入，不因路径内空格产生歧义。
3. 路径写入后，依赖 `v-model` 或 `@input` 的表单状态同步更新。
4. 非文本及只读/禁用控件不接收路径，也不显示拖入高亮。
5. 文件拖入的视觉反馈在离开、放下或组件卸载后清除。
6. 脚本导入拖放行为不回归。
