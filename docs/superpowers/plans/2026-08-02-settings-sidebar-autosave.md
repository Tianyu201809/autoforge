# 设置页侧边分类与自动保存实现计划

> **For agentic workers:** 需要按任务逐项执行本计划；每项完成后运行对应验证，不创建提交或分支。

**Goal:** 将设置弹窗改造成固定侧栏分类切换，并让普通配置失焦自动保存、环境编辑自动保存。

**Architecture:** 继续以 `SettingsPanel.vue` 作为设置容器，在组件内增加分类元数据、当前分类状态和保存状态协调器。普通配置通过现有 `config.get/set` 使用最小 patch；窗口模式保留现有 `window.api.setMode` 即时链路；环境 Profile 通过深度 watcher + 400ms 防抖调用现有 `env.update`。`AppFeatureModal.vue` 不新增业务逻辑，只调整调用宽度。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、Tailwind CSS v4、Lucide Vue、Electron preload IPC。

## Global Constraints

- 不修改 `AppConfig`、`EnvironmentProfile`、IPC channel、数据库结构或现有公开组件 API。
- 普通文本配置在 `blur` 时保存；环境 Profile 编辑采用 400ms 防抖；窗口行为继续即时生效。
- 移除“保存设置”和“保存环境”按钮，保留环境创建/删除和依赖安装/移除等明确动作按钮。
- 初始化赋值不得触发自动保存；组件卸载时清理所有 timer。
- 不新增第三方依赖，不提交 git commit，不创建分支。

---

### Task 1: 增加分类模型与自动保存协调器

**Files:**
- Modify: `src/renderer/src/components/SettingsPanel.vue:1-370`

**Interfaces:**
- Produces `SettingsSectionId`、`SETTINGS_SECTIONS`、`buildConfigPatch()`、配置保存状态和环境保存调度函数，供同一组件模板调用。

- [ ] **Step 1: 定义分类元数据与保存状态类型**

在现有 Lucide import 中加入分类所需图标，并在 `props` 后增加：

```ts
import type { Component } from 'vue'
import { AppWindow, Boxes, Code2, Globe2, ScrollText } from 'lucide-vue-next'
import type { AppConfig, BrowserStatusInfo, EnvironmentProfile, GlobalDependency, PythonStatusInfo } from '../../../shared/types/script'

type SettingsSectionId = 'overview' | 'window' | 'runtime' | 'tools' | 'logs'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface SettingsSection {
  id: SettingsSectionId
  label: string
  description: string
  icon: Component
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'overview', label: '概览', description: '产品与 Hub', icon: Boxes },
  { id: 'window', label: '窗口与外观', description: '显示与皮肤', icon: AppWindow },
  { id: 'runtime', label: '环境与运行', description: 'Profile 与运行时', icon: Globe2 },
  { id: 'tools', label: '开发工具', description: '编辑器', icon: Code2 },
  { id: 'logs', label: '日志与数据', description: '日志与目录', icon: ScrollText }
]

const activeSection = ref<SettingsSectionId>('overview')
const configSaveState = ref<SaveState>('idle')
const envSaveState = ref<SaveState>('idle')
const hydrating = ref(false)
let envSaveTimer: number | undefined
```

- [ ] **Step 2: 提取配置 patch 构建函数**

在现有 `save()` 前替换为纯函数和保存函数：

```ts
function buildConfigPatch(): Partial<AppConfig> {
  return {
    hub: { url: autoforgeHubUrl.value.trim() || undefined },
    browser: { executablePath: browserPath.value.trim() || undefined },
    python: {
      executablePath: pythonPath.value.trim() || undefined,
      pipIndexUrl: pipIndexUrl.value.trim() || undefined
    },
    script: {
      runTimeoutSeconds: runTimeoutSeconds.value > 0 ? Math.floor(runTimeoutSeconds.value) : undefined
    },
    externalEditor: { executablePath: externalEditorPath.value.trim() || undefined },
    logLevel: logLevel.value
  }
}

async function saveConfigNow(): Promise<void> {
  if (!initialized.value || hydrating.value) return
  configSaveState.value = 'saving'
  try {
    await window.autoforge.config.set(buildConfigPatch())
    configSaveState.value = 'saved'
  } catch (err) {
    configSaveState.value = 'error'
    pushToast({ type: 'error', title: '保存失败', message: err instanceof Error ? err.message : '无法保存设置' })
  }
}
```

删除旧的 `save()` 调用链和 `saving/saved` refs，保留窗口模式 watcher 使用的状态。

- [ ] **Step 3: 为文本字段绑定失焦保存，为离散字段绑定即时保存**

为以下文本输入增加 `@blur="saveConfigNow"`：`autoforgeHubUrl`、`browserPath`、`pythonPath`、`pipIndexUrl`、`runTimeoutSeconds`、`externalEditorPath`。为日志 `<select>` 增加 `@change="saveConfigNow"`。浏览按钮和 Python 检测继续先更新 ref，再由失焦或显式检测流程保存。

在 `initializeSettings()` 中使用 `hydrating = true` 包围字段赋值和状态读取，最后在 `initialized = true` 后设置 `hydrating = false`，保证初始化 watcher 不发送 IPC。

- [ ] **Step 4: 清理退出资源并统一状态文案**

添加：

```ts
function flushPendingSaves(): void {
  if (envSaveTimer !== undefined) {
    window.clearTimeout(envSaveTimer)
    envSaveTimer = undefined
    void saveEnvironmentNow()
  }
}

onUnmounted(() => {
  flushPendingSaves()
  offModeChange?.()
})
```

实现 `saveStatusLabel` computed：`saving` 显示“正在保存…”，`error` 显示“保存失败”，`saved` 显示“已自动保存”，`idle` 不显示；模板通过 `aria-live="polite"` 使用该文案。

### Task 2: 重构双栏模板与响应式样式

**Files:**
- Modify: `src/renderer/src/components/SettingsPanel.vue:372-744`

**Interfaces:**
- Consumes `SETTINGS_SECTIONS`、`activeSection`、`saveStatusLabel` 和环境自动保存函数。
- Produces可点击分类导航、五个条件渲染内容视图和窄窗口横向导航。

- [ ] **Step 1: 扩宽弹窗并替换主体骨架**

将 `AppFeatureModal` 的 `max-width="2xl"` 改为 `max-width="5xl"`，并给 slot 根节点增加 `settings-modal-shell`，固定 `height/min-height: min(92vh, 880px)`，使弹窗不会随分类内容变高或变矮。保留现有标题栏图标/标题/描述/关闭按钮，在关闭按钮前加入：

```vue
<span v-if="saveStatusLabel" class="settings-save-status" aria-live="polite">
  <span class="settings-save-status__dot" :class="`is-${configSaveState}`" aria-hidden="true" />
  {{ saveStatusLabel }}
</span>
```

将原来的单列滚动容器替换为：

```vue
<div class="settings-layout flex-1 min-h-0">
  <nav class="settings-nav sb-bg-surface" aria-label="设置分类">
    <button
      v-for="section in SETTINGS_SECTIONS"
      :key="section.id"
      type="button"
      class="settings-nav-item"
      :class="{ 'is-active': activeSection === section.id }"
      :aria-current="activeSection === section.id ? 'page' : undefined"
      @click="activeSection = section.id"
    >
      <component :is="section.icon" class="settings-nav-item__icon" :stroke-width="1.7" />
      <span class="min-w-0">
        <span class="settings-nav-item__label">{{ section.label }}</span>
        <span class="settings-nav-item__description">{{ section.description }}</span>
      </span>
    </button>
  </nav>
  <div class="settings-content overflow-y-auto min-h-0">
    <!-- 五个分类的现有 section 按 activeSection 条件渲染 -->
  </div>
</div>
```

- [ ] **Step 2: 按分类移动现有 section**

把现有 section 原样迁移到五个条件模板中：

```vue
<template v-if="activeSection === 'overview'">
  <!-- 产品版本、AutoforgeHub -->
</template>
<template v-else-if="activeSection === 'window'">
  <!-- 窗口行为、外观皮肤 -->
</template>
<template v-else-if="activeSection === 'runtime'">
  <!-- 环境 Profile、浏览器、Python -->
</template>
<template v-else-if="activeSection === 'tools'">
  <!-- 外部编辑器 -->
</template>
<template v-else>
  <!-- 日志与数据 -->
</template>
```

删除底部“保存设置”按钮和 `saved` 文案。环境编辑卡片删除“保存环境”按钮及其状态文案，但保留删除环境按钮；全局 Python 依赖的刷新、安装和移除按钮保持不变。

- [ ] **Step 3: 调整环境编辑事件绑定**

保留 `editingEnv` 的输入 v-model，但移除 `@click="saveEnv"`。环境变量增删继续修改 `editingEnv.variables`，由 Task 3 的 watcher 自动保存；创建/删除环境继续绑定 `createEnv`/`deleteEnv`。

- [ ] **Step 4: 增加双栏与窄窗口样式**

在 scoped style 中加入：

```css
.settings-layout {
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  min-height: 0;
}

.settings-nav {
  border-right: 1px solid var(--sb-border-subtle);
  padding: 0.75rem;
  overflow-y: auto;
}

.settings-content {
  padding: 1.5rem;
}

.settings-nav-item {
  position: relative;
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 0.625rem;
  border-radius: 0.625rem;
  padding: 0.625rem 0.75rem;
  color: var(--sb-text-muted);
  text-align: left;
  transition: background 0.16s ease, color 0.16s ease;
}

.settings-nav-item:hover,
.settings-nav-item:focus-visible,
.settings-nav-item.is-active {
  color: var(--sb-text-primary);
  background: color-mix(in srgb, var(--sb-accent-solid) 10%, var(--sb-bg-inset));
}

.settings-nav-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.55rem;
  bottom: 0.55rem;
  width: 2px;
  border-radius: 999px;
  background: var(--sb-accent-solid);
}

@media (max-width: 760px) {
  .settings-layout { display: flex; flex-direction: column; }
  .settings-nav { display: flex; gap: 0.375rem; border-right: 0; border-bottom: 1px solid var(--sb-border-subtle); overflow-x: auto; }
  .settings-nav-item { width: auto; min-width: max-content; }
  .settings-nav-item__description { display: none; }
  .settings-content { padding: 1rem; }
}
```

### Task 3: 实现环境 Profile 自动保存与关闭刷新

**Files:**
- Modify: `src/renderer/src/components/SettingsPanel.vue:45-245`

**Interfaces:**
- Consumes `editingEnv`, `environments`, `window.autoforge.env.update`。
- Produces `scheduleEnvironmentSave()`, `saveEnvironmentNow()`、`flushPendingSaves()`，供模板和生命周期使用。

- [ ] **Step 1: 添加环境快照与保存函数**

使用现有字段实现：

```ts
function environmentPayload(env: EnvironmentProfile): Partial<EnvironmentProfile> {
  return {
    name: env.name,
    description: env.description,
    variables: Object.fromEntries(Object.entries(env.variables).map(([key, value]) => [key, value ?? ''])),
    isDefault: env.isDefault
  }
}

async function saveEnvironmentNow(): Promise<void> {
  const env = editingEnv.value ? toRaw(editingEnv.value) : null
  if (!env || !initialized.value || hydrating.value) return
  envSaveState.value = 'saving'
  try {
    const updated = await window.autoforge.env.update(env.id, environmentPayload(env))
    if (!updated) throw new Error('无法更新环境配置')
    environments.value = await window.autoforge.env.list()
    syncEditingEnv(env.id)
    emit('environments-changed')
    envSaveState.value = 'saved'
  } catch (err) {
    envSaveState.value = 'error'
    pushToast({ type: 'error', title: '保存失败', message: err instanceof Error ? err.message : '无法保存环境' })
  }
}
```

- [ ] **Step 2: 添加 400ms 防抖 watcher**

在初始化 watcher 之后加入深度监听：

```ts
watch(
  editingEnv,
  () => {
    if (!initialized.value || hydrating.value || !editingEnv.value) return
    if (envSaveTimer !== undefined) window.clearTimeout(envSaveTimer)
    envSaveTimer = window.setTimeout(() => {
      envSaveTimer = undefined
      void saveEnvironmentNow()
    }, 400)
  },
  { deep: true }
)
```

切换环境时只调用 `syncEditingEnv(id)`；环境列表刷新后使用 `syncEditingEnv(envId)`，避免 watcher 把服务端回写再次当成用户修改。

- [ ] **Step 3: 删除旧保存按钮逻辑并保留明确动作**

删除旧 `saveEnv()` 函数、`savingEnv`/`envSaved` refs 和模板按钮。`createEnv()`、`deleteEnv()`、`addEnvVar()`、`removeEnvVar()` 保留；增删变量依靠深度 watcher 保存。

- [ ] **Step 4: 让关闭事件刷新待保存修改**

把 `@close="emit('close')"` 改为 `@close="handleClose"`，并实现：

```ts
async function handleClose(): Promise<void> {
  flushPendingSaves()
  emit('close')
}
```

如果当前输入框仍保持焦点，浏览器的 blur 事件先行触发配置保存；环境 debounce 则由 `flushPendingSaves()` 立即执行。

### Task 4: 运行静态检查、构建与人工回归

**Files:**
- Test: `src/renderer/src/components/SettingsPanel.vue`（手动回归，无现有 Vue 单测基础设施）

- [ ] **Step 1: 运行 ESLint**

Run: `npm run lint`

Expected: 命令成功退出且无新增错误；若报告旧有无关问题，记录但不修改无关文件。

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`

Expected: electron-vite 完成 main/preload/renderer 构建并成功退出。

- [ ] **Step 3: 逐项验证交互**

在开发窗口中验证：

1. 打开设置默认显示“概览”，点击五个分类时右侧只显示对应内容。
2. 关闭并重新打开设置，当前会话的最近分类仍保持；关闭弹窗不会留下遮罩或键盘监听。
3. 修改 Hub/路径/超时等文本后保持焦点不离开，确认不发送保存；离开输入框后确认显示保存状态并能重新打开读取新值。
4. 切换日志级别、托盘/悬浮球/快捷键和皮肤，确认即时生效；窗口行为仍能被主窗口事件同步回来。
5. 修改环境名称、默认状态、变量值，确认 400ms 内只产生一次更新；切换环境不误保存；创建/删除环境仍正常。
6. 触发保存失败时确认输入值保留、Toast 显示错误、顶部状态显示失败；下一次修改可再次保存。
7. 将窗口缩窄，确认侧栏变为顶部横向分类条，表单输入不被截断。

- [ ] **Step 4: 检查变更范围**

Run: `git diff --stat; git diff -- src/renderer/src/components/SettingsPanel.vue docs/superpowers/specs/2026-08-02-settings-sidebar-autosave-design.md docs/superpowers/plans/2026-08-02-settings-sidebar-autosave.md`

Expected: 变更集中在设置组件与规格/计划文档，不出现数据库、IPC 协议或无关组件修改。
