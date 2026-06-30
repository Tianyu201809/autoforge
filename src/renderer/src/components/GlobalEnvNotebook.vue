<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { Eraser, GripVertical, Notebook, Pencil, Plus, Search, Trash2, X } from 'lucide-vue-next'
import { useGlobalEnvNotebook } from '../composables/useGlobalEnvNotebook'
import { useToast } from '../composables/useToast'

const { pushToast } = useToast()

const {
  active,
  environments,
  selectedEnvId,
  searchQuery,
  position,
  filteredKeys,
  editorOpen,
  editorKey,
  editorValue,
  saving,
  close,
  setPosition,
  insertKey,
  hasValueForKey,
  valueForKey,
  upsertVariable,
  removeVariable,
  openEditor,
  closeEditor,
  toggleEditor
} = useGlobalEnvNotebook()

const panelRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

const panelStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`
}))

const editorIsEdit = computed(() => {
  const key = editorKey.value.trim()
  if (!key) return false
  const profile = environments.value.find((env) => env.id === selectedEnvId.value)
  return !!profile && Object.prototype.hasOwnProperty.call(profile.variables, key)
})

function clampPosition(x: number, y: number): { x: number; y: number } {
  const el = panelRef.value
  const width = el?.offsetWidth ?? 280
  const height = el?.offsetHeight ?? 320
  const padding = 8
  return {
    x: Math.min(Math.max(padding, x), Math.max(padding, window.innerWidth - width - padding)),
    y: Math.min(Math.max(padding, y), Math.max(padding, window.innerHeight - height - padding))
  }
}

function onDragStart(event: MouseEvent): void {
  if (event.button !== 0) return
  dragging.value = true
  dragOffset.value = {
    x: event.clientX - position.value.x,
    y: event.clientY - position.value.y
  }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(event: MouseEvent): void {
  if (!dragging.value) return
  setPosition(clampPosition(event.clientX - dragOffset.value.x, event.clientY - dragOffset.value.y))
}

function onDragEnd(): void {
  dragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

function handleKeyClick(key: string): void {
  if (!hasValueForKey(key)) {
    openEditor(key, valueForKey(key))
    pushToast({
      type: 'info',
      title: '变量值为空',
      message: `可在下方补充「${key}」的值`
    })
    return
  }
  const ok = insertKey(key)
  if (!ok) {
    pushToast({
      type: 'info',
      title: '请先聚焦输入框',
      message: '点击要填写的输入框后，再选择全局变量 KEY'
    })
    return
  }
  pushToast({
    type: 'success',
    title: '已填入',
    message: key,
    duration: 1800
  })
}

async function handleSaveEditor(): Promise<void> {
  const key = editorKey.value.trim()
  if (!key) {
    pushToast({ type: 'info', title: '请输入 KEY', message: '变量名不能为空' })
    return
  }
  const ok = await upsertVariable(key, editorValue.value)
  if (!ok) {
    pushToast({ type: 'error', title: '保存失败', message: '无法更新环境变量' })
    return
  }
  pushToast({
    type: 'success',
    title: editorIsEdit.value ? '已更新' : '已添加',
    message: key,
    duration: 1800
  })
  closeEditor()
}

async function handleRemoveKey(key: string): Promise<void> {
  const ok = await removeVariable(key)
  if (!ok) {
    pushToast({ type: 'error', title: '删除失败', message: key })
    return
  }
  if (editorKey.value.trim() === key) closeEditor()
  pushToast({ type: 'success', title: '已删除', message: key, duration: 1800 })
}

async function handleClearValue(key: string): Promise<void> {
  const ok = await upsertVariable(key, '')
  if (!ok) {
    pushToast({ type: 'error', title: '清除失败', message: key })
    return
  }
  pushToast({ type: 'success', title: '已清除值', message: key, duration: 1800 })
}

onUnmounted(() => {
  onDragEnd()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active"
      ref="panelRef"
      data-global-env-notebook
      class="global-env-notebook fixed z-[500] w-[280px] max-h-[min(500px,calc(100vh-24px))] flex flex-col overflow-hidden rounded-xl border shadow-2xl"
      :class="dragging && 'global-env-notebook--dragging'"
      :style="panelStyle"
      @click.stop
    >
      <!-- 装订区 -->
      <div class="global-env-notebook__spine" aria-hidden="true">
        <span v-for="i in 9" :key="i" class="global-env-notebook__hole" />
      </div>

      <div class="global-env-notebook__sheet flex flex-col min-h-0 flex-1">
        <div
          class="global-env-notebook__header flex items-center gap-2 px-3 py-2.5 border-b cursor-grab active:cursor-grabbing"
          @mousedown="onDragStart"
        >
          <div class="w-7 h-7 rounded-lg border sb-border-subtle sb-bg-inset flex items-center justify-center flex-shrink-0">
            <Notebook class="w-3.5 h-3.5 text-[var(--sb-accent-solid)]" :stroke-width="1.5" />
          </div>
          <div class="min-w-0 flex-1 select-none">
            <p class="text-[12px] font-semibold sb-text-primary leading-tight tracking-wide">全局变量</p>
            <p class="text-[10px] sb-text-faint leading-tight mt-0.5">聚焦输入框 · 点击 KEY 填入</p>
          </div>
          <div class="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              class="global-env-notebook__icon-btn"
              :class="editorOpen && 'global-env-notebook__icon-btn--active'"
              title="添加 / 管理变量"
              @mousedown.stop
              @click="toggleEditor"
            >
              <Plus class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
            <button
              type="button"
              class="global-env-notebook__icon-btn global-env-notebook__icon-btn--danger"
              title="关闭"
              @mousedown.stop
              @click="close"
            >
              <X class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
          </div>
        </div>

        <div class="px-3 py-2.5 space-y-2 border-b sb-border-subtle sb-bg-surface/40">
          <label class="block">
            <span class="text-[10px] font-medium sb-text-faint uppercase tracking-wider">环境</span>
            <select
              v-model="selectedEnvId"
              class="mt-1 w-full h-8 px-2.5 rounded-lg sb-bg-input border sb-border text-[11px] outline-none focus:sb-input"
              @mousedown.stop
            >
              <option v-for="env in environments" :key="env.id" :value="env.id">{{ env.name }}</option>
            </select>
          </label>
          <div class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 sb-text-faint pointer-events-none" :stroke-width="1.5" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="检索 KEY…"
              class="w-full h-8 pl-8 pr-2.5 rounded-lg sb-bg-input border sb-border text-[11px] font-mono outline-none focus:sb-input"
              @mousedown.stop
            />
          </div>
        </div>

        <Transition name="notebook-editor">
          <div
            v-if="editorOpen"
            class="global-env-notebook__editor px-3 py-2.5 border-b sb-border-subtle"
            @mousedown.stop
          >
            <div class="flex items-center justify-between mb-2">
              <span class="text-[10px] font-semibold sb-text-muted uppercase tracking-wider">
                {{ editorIsEdit ? '编辑变量' : '添加变量' }}
              </span>
              <button
                type="button"
                class="text-[10px] sb-text-faint hover:sb-text-muted transition-colors"
                @click="closeEditor"
              >
                收起
              </button>
            </div>
            <div class="space-y-2">
              <label class="block">
                <span class="text-[10px] sb-text-faint font-mono">KEY</span>
                <input
                  v-model="editorKey"
                  type="text"
                  placeholder="变量名"
                  class="mt-0.5 w-full h-8 px-2.5 rounded-lg sb-bg-input border sb-border text-[11px] font-mono outline-none focus:sb-input"
                  :readonly="editorIsEdit"
                />
              </label>
              <label class="block">
                <span class="text-[10px] sb-text-faint font-mono">VALUE</span>
                <input
                  v-model="editorValue"
                  type="text"
                  placeholder="变量值"
                  class="mt-0.5 w-full h-8 px-2.5 rounded-lg sb-bg-input border sb-border text-[11px] outline-none focus:sb-input"
                />
              </label>
            </div>
            <div class="flex gap-2 mt-2.5">
              <button
                type="button"
                class="flex-1 h-8 rounded-lg sb-btn-accent text-[11px] font-medium disabled:opacity-50"
                :disabled="saving"
                @click="handleSaveEditor"
              >
                {{ saving ? '保存中…' : editorIsEdit ? '更新' : '添加' }}
              </button>
              <button
                type="button"
                class="h-8 px-3 rounded-lg text-[11px] sb-text-muted border sb-border hover:sb-bg-hover transition-colors"
                @click="closeEditor"
              >
                取消
              </button>
            </div>
          </div>
        </Transition>

        <div class="global-env-notebook__body flex-1 overflow-y-auto min-h-[140px]">
          <div v-if="!filteredKeys.length" class="global-env-notebook__empty">
            <Notebook class="w-8 h-8 sb-text-faint opacity-40 mb-2" :stroke-width="1" />
            <p class="text-[11px] sb-text-faint text-center leading-relaxed px-4">
              {{ searchQuery.trim() ? '没有匹配的 KEY' : '暂无变量' }}
            </p>
            <button
              v-if="!searchQuery.trim()"
              type="button"
              class="mt-2 text-[11px] text-[var(--sb-accent-solid)] hover:opacity-80 transition-opacity"
              @click="openEditor()"
            >
              点击添加第一个变量
            </button>
          </div>

          <div v-else class="global-env-notebook__list pb-2">
            <div
              v-for="key in filteredKeys"
              :key="key"
              class="global-env-notebook__row group"
            >
              <button
                type="button"
                class="global-env-notebook__key"
                :class="hasValueForKey(key) ? 'global-env-notebook__key--ready' : 'global-env-notebook__key--empty'"
                :title="hasValueForKey(key) ? `填入 ${key}` : `${key}（值为空，点击补充）`"
                @mousedown.prevent
                @click="handleKeyClick(key)"
              >
                <span class="global-env-notebook__key-text truncate">{{ key }}</span>
                <span
                  class="global-env-notebook__status"
                  :class="hasValueForKey(key) ? 'global-env-notebook__status--ready' : 'global-env-notebook__status--empty'"
                />
              </button>

              <div class="global-env-notebook__actions" @mousedown.stop>
                <button
                  type="button"
                  class="global-env-notebook__action"
                  title="编辑"
                  @click="openEditor(key, valueForKey(key))"
                >
                  <Pencil class="w-3 h-3" :stroke-width="1.5" />
                </button>
                <button
                  v-if="hasValueForKey(key)"
                  type="button"
                  class="global-env-notebook__action global-env-notebook__action--warn"
                  title="清除值"
                  @click="handleClearValue(key)"
                >
                  <Eraser class="w-3 h-3" :stroke-width="1.5" />
                </button>
                <button
                  type="button"
                  class="global-env-notebook__action global-env-notebook__action--danger"
                  title="删除"
                  @click="handleRemoveKey(key)"
                >
                  <Trash2 class="w-3 h-3" :stroke-width="1.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="global-env-notebook__footer px-3 py-1.5 border-t sb-border-subtle select-none">
          <p class="text-[10px] sb-text-faint text-center">{{ filteredKeys.length }} 个 KEY · 悬停行可管理</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.global-env-notebook {
  --line-step: 30px;
  --spine-width: 14px;
  --margin-left: 22px;
  background: var(--sb-bg-elevated);
  border-color: color-mix(in srgb, var(--sb-accent-solid) 16%, var(--sb-border));
  box-shadow:
    0 20px 50px rgb(0 0 0 / 0.32),
    0 0 0 1px color-mix(in srgb, var(--sb-accent-solid) 8%, transparent);
}

.global-env-notebook--dragging {
  cursor: grabbing;
  box-shadow:
    0 24px 56px rgb(0 0 0 / 0.38),
    0 0 0 1px color-mix(in srgb, var(--sb-accent-solid) 14%, transparent);
}

.global-env-notebook__spine {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--spine-width);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-evenly;
  padding: 12px 0;
  background: color-mix(in srgb, var(--sb-accent-solid) 5%, var(--sb-bg-panel));
  border-right: 1px solid var(--sb-border-subtle);
  border-radius: 12px 0 0 12px;
  pointer-events: none;
}

.global-env-notebook__hole {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--sb-bg-base);
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.18);
}

.global-env-notebook__sheet {
  margin-left: var(--spine-width);
  position: relative;
}

.global-env-notebook__sheet::before {
  content: '';
  position: absolute;
  left: calc(var(--margin-left) - var(--spine-width) - 6px);
  top: 0;
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, #f87171 35%, transparent);
  pointer-events: none;
  z-index: 1;
}

.global-env-notebook__header {
  border-color: var(--sb-border-subtle);
  background: color-mix(in srgb, var(--sb-bg-panel) 90%, var(--sb-bg-elevated));
}

.global-env-notebook__icon-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: var(--sb-text-muted);
  transition: background-color 0.15s, color 0.15s;
}

.global-env-notebook__icon-btn:hover {
  color: var(--sb-text-secondary);
  background: var(--sb-bg-hover);
}

.global-env-notebook__icon-btn--active {
  color: var(--sb-accent-solid);
  background: var(--sb-bg-inset);
}

.global-env-notebook__icon-btn--danger:hover {
  color: #f87171;
  background: rgb(248 113 113 / 0.1);
}

.global-env-notebook__editor {
  background: color-mix(in srgb, var(--sb-accent-solid) 4%, var(--sb-bg-surface));
}

.notebook-editor-enter-active,
.notebook-editor-leave-active {
  transition: opacity 0.18s ease, max-height 0.22s ease;
  overflow: hidden;
}

.notebook-editor-enter-from,
.notebook-editor-leave-to {
  opacity: 0;
  max-height: 0;
}

.notebook-editor-enter-to,
.notebook-editor-leave-from {
  opacity: 1;
  max-height: 200px;
}

.global-env-notebook__body {
  background-color: color-mix(in srgb, var(--sb-bg-elevated) 96%, #fef3c7 4%);
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent calc(var(--line-step) - 1px),
    color-mix(in srgb, var(--sb-border-subtle) 45%, #d6d3d1 55%) calc(var(--line-step) - 1px),
    color-mix(in srgb, var(--sb-border-subtle) 45%, #d6d3d1 55%) var(--line-step)
  );
  background-size: 100% var(--line-step);
  background-position: 0 4px;
}

.global-env-notebook__list {
  padding-top: 4px;
}

.global-env-notebook__row {
  position: relative;
  height: var(--line-step);
  display: flex;
  align-items: flex-end;
  padding: 0 8px 0 var(--margin-left);
}

.global-env-notebook__row:hover .global-env-notebook__actions {
  opacity: 1;
  pointer-events: auto;
}

.global-env-notebook__row:hover .global-env-notebook__key-text {
  mask-image: linear-gradient(to right, #000 55%, transparent 92%);
  -webkit-mask-image: linear-gradient(to right, #000 55%, transparent 92%);
}

.global-env-notebook__key {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 0 4px 7px 0;
  text-align: left;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1;
  border-radius: 4px;
  transition: color 0.12s;
}

.global-env-notebook__key--ready {
  color: var(--sb-text-primary);
}

.global-env-notebook__key--ready:hover {
  color: var(--sb-accent-solid);
}

.global-env-notebook__key--empty {
  color: var(--sb-text-faint);
  opacity: 0.75;
}

.global-env-notebook__key--empty:hover {
  opacity: 1;
  color: var(--sb-text-muted);
}

.global-env-notebook__key:active {
  transform: translateY(0.5px);
}

.global-env-notebook__key-text {
  flex: 1;
  min-width: 0;
}

.global-env-notebook__status {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
  margin-bottom: 1px;
}

.global-env-notebook__status--ready {
  background: #34d399;
  box-shadow: 0 0 0 2px rgb(52 211 153 / 0.2);
}

.global-env-notebook__status--empty {
  background: var(--sb-text-faint);
  opacity: 0.35;
}

.global-env-notebook__actions {
  position: absolute;
  right: 6px;
  bottom: 5px;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  border-radius: 8px;
  border: 1px solid var(--sb-border-subtle);
  background: color-mix(in srgb, var(--sb-bg-elevated) 88%, transparent);
  backdrop-filter: blur(8px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.global-env-notebook__action {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--sb-text-faint);
  transition: background-color 0.12s, color 0.12s;
}

.global-env-notebook__action:hover {
  color: var(--sb-text-primary);
  background: var(--sb-bg-hover);
}

.global-env-notebook__action--warn:hover {
  color: #fbbf24;
  background: rgb(251 191 36 / 0.12);
}

.global-env-notebook__action--danger:hover {
  color: #f87171;
  background: rgb(248 113 113 / 0.12);
}

.global-env-notebook__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  padding: 16px;
}

.global-env-notebook__footer {
  background: color-mix(in srgb, var(--sb-bg-panel) 85%, var(--sb-bg-elevated));
}
</style>
