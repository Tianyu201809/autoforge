<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { Eraser, Notebook, Pencil, Plus, Search, Trash2, X } from 'lucide-vue-next'
import type { ScratchpadEntry } from '../../../shared/types/script'
import { useScratchpad } from '../composables/useScratchpad'
import { useToast } from '../composables/useToast'

const { pushToast } = useToast()

const {
  active,
  searchQuery,
  position,
  filteredEntries,
  editorOpen,
  editorId,
  editorLabel,
  editorValue,
  saving,
  close,
  setPosition,
  insertEntry,
  hasValue,
  upsertEntry,
  removeEntry,
  clearEntryValue,
  openEditor,
  closeEditor,
  toggleEditor
} = useScratchpad()

const panelRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

const panelStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`
}))

const editorIsEdit = computed(() => !!editorId.value)

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

function handleEntryClick(entry: ScratchpadEntry): void {
  if (!hasValue(entry)) {
    openEditor(entry)
    pushToast({
      type: 'info',
      title: '内容为空',
      message: `可在下方补充「${entry.label}」的内容`
    })
    return
  }
  const ok = insertEntry(entry)
  if (!ok) {
    pushToast({
      type: 'info',
      title: '请先聚焦输入框',
      message: '点击要填写的输入框后，再选择小记条目'
    })
    return
  }
  pushToast({
    type: 'success',
    title: '已填入',
    message: entry.label,
    duration: 1800
  })
}

async function handleSaveEditor(): Promise<void> {
  const label = editorLabel.value.trim()
  if (!label) {
    pushToast({ type: 'info', title: '请输入标签', message: '标签不能为空' })
    return
  }
  const ok = await upsertEntry(label, editorValue.value, editorId.value)
  if (!ok) {
    pushToast({ type: 'error', title: '保存失败', message: '无法保存小记' })
    return
  }
  pushToast({
    type: 'success',
    title: editorIsEdit.value ? '已更新' : '已添加',
    message: label,
    duration: 1800
  })
  closeEditor()
}

async function handleRemoveEntry(entry: ScratchpadEntry): Promise<void> {
  const ok = await removeEntry(entry.id)
  if (!ok) {
    pushToast({ type: 'error', title: '删除失败', message: entry.label })
    return
  }
  if (editorId.value === entry.id) closeEditor()
  pushToast({ type: 'success', title: '已删除', message: entry.label, duration: 1800 })
}

async function handleClearValue(entry: ScratchpadEntry): Promise<void> {
  const ok = await clearEntryValue(entry.id)
  if (!ok) {
    pushToast({ type: 'error', title: '清除失败', message: entry.label })
    return
  }
  pushToast({ type: 'success', title: '已清除内容', message: entry.label, duration: 1800 })
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
      data-scratchpad-panel
      class="scratchpad-panel fixed z-[500] w-[280px] max-h-[min(500px,calc(100vh-24px))] flex flex-col overflow-hidden rounded-xl border shadow-2xl"
      :class="dragging && 'scratchpad-panel--dragging'"
      :style="panelStyle"
      @click.stop
    >
      <div class="scratchpad-panel__spine" aria-hidden="true">
        <span v-for="i in 9" :key="i" class="scratchpad-panel__hole" />
      </div>

      <div class="scratchpad-panel__sheet flex flex-col min-h-0 flex-1">
        <div
          class="scratchpad-panel__header flex items-center gap-2 px-3 py-2.5 border-b cursor-grab active:cursor-grabbing"
          @mousedown="onDragStart"
        >
          <div class="w-7 h-7 rounded-lg border sb-border-subtle sb-bg-inset flex items-center justify-center flex-shrink-0">
            <Notebook class="w-3.5 h-3.5 text-[var(--sb-accent-solid)]" :stroke-width="1.5" />
          </div>
          <div class="min-w-0 flex-1 select-none">
            <p class="text-[12px] font-semibold sb-text-primary leading-tight tracking-wide">小记</p>
            <p class="text-[10px] sb-text-faint leading-tight mt-0.5">聚焦输入框 · 点击标签填入</p>
          </div>
          <div class="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              class="scratchpad-panel__icon-btn"
              :class="editorOpen && 'scratchpad-panel__icon-btn--active'"
              title="添加 / 管理小记"
              @mousedown.stop
              @click="toggleEditor"
            >
              <Plus class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
            <button
              type="button"
              class="scratchpad-panel__icon-btn scratchpad-panel__icon-btn--danger"
              title="关闭"
              @mousedown.stop
              @click="close"
            >
              <X class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
          </div>
        </div>

        <div class="px-3 py-2.5 border-b sb-border-subtle sb-bg-surface/40">
          <div class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 sb-text-faint pointer-events-none" :stroke-width="1.5" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="检索标签或内容…"
              class="w-full h-8 pl-8 pr-2.5 rounded-lg sb-bg-input border sb-border text-[11px] outline-none focus:sb-input"
              @mousedown.stop
            />
          </div>
        </div>

        <Transition name="scratchpad-editor">
          <div
            v-if="editorOpen"
            class="scratchpad-panel__editor px-3 py-2.5 border-b sb-border-subtle"
            @mousedown.stop
          >
            <div class="flex items-center justify-between mb-2">
              <span class="text-[10px] font-semibold sb-text-muted uppercase tracking-wider">
                {{ editorIsEdit ? '编辑小记' : '添加小记' }}
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
                <span class="text-[10px] sb-text-faint">标签</span>
                <input
                  v-model="editorLabel"
                  type="text"
                  placeholder="便于识别的名称"
                  class="mt-0.5 w-full h-8 px-2.5 rounded-lg sb-bg-input border sb-border text-[11px] outline-none focus:sb-input"
                />
              </label>
              <label class="block">
                <span class="text-[10px] sb-text-faint">内容</span>
                <input
                  v-model="editorValue"
                  type="text"
                  placeholder="点击条目时填入输入框的内容"
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

        <div class="scratchpad-panel__body flex-1 overflow-y-auto min-h-[140px]">
          <div v-if="!filteredEntries.length" class="scratchpad-panel__empty">
            <Notebook class="w-8 h-8 sb-text-faint opacity-40 mb-2" :stroke-width="1" />
            <p class="text-[11px] sb-text-faint text-center leading-relaxed px-4">
              {{ searchQuery.trim() ? '没有匹配的小记' : '暂无小记' }}
            </p>
            <button
              v-if="!searchQuery.trim()"
              type="button"
              class="mt-2 text-[11px] text-[var(--sb-accent-solid)] hover:opacity-80 transition-opacity"
              @click="openEditor()"
            >
              点击添加第一条小记
            </button>
          </div>

          <div v-else class="scratchpad-panel__list pb-2">
            <div
              v-for="entry in filteredEntries"
              :key="entry.id"
              class="scratchpad-panel__row group"
            >
              <button
                type="button"
                class="scratchpad-panel__label"
                :class="hasValue(entry) ? 'scratchpad-panel__label--ready' : 'scratchpad-panel__label--empty'"
                :title="hasValue(entry) ? `填入 ${entry.label}` : `${entry.label}（内容为空，点击补充）`"
                @mousedown.prevent
                @click="handleEntryClick(entry)"
              >
                <span class="scratchpad-panel__label-text truncate">{{ entry.label }}</span>
                <span
                  class="scratchpad-panel__status"
                  :class="hasValue(entry) ? 'scratchpad-panel__status--ready' : 'scratchpad-panel__status--empty'"
                />
              </button>

              <div class="scratchpad-panel__actions" @mousedown.stop>
                <button
                  type="button"
                  class="scratchpad-panel__action"
                  title="编辑"
                  @click="openEditor(entry)"
                >
                  <Pencil class="w-3 h-3" :stroke-width="1.5" />
                </button>
                <button
                  v-if="hasValue(entry)"
                  type="button"
                  class="scratchpad-panel__action scratchpad-panel__action--warn"
                  title="清除内容"
                  @click="handleClearValue(entry)"
                >
                  <Eraser class="w-3 h-3" :stroke-width="1.5" />
                </button>
                <button
                  type="button"
                  class="scratchpad-panel__action scratchpad-panel__action--danger"
                  title="删除"
                  @click="handleRemoveEntry(entry)"
                >
                  <Trash2 class="w-3 h-3" :stroke-width="1.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="scratchpad-panel__footer px-3 py-1.5 border-t sb-border-subtle select-none">
          <p class="text-[10px] sb-text-faint text-center">{{ filteredEntries.length }} 条小记 · 悬停行可管理</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scratchpad-panel {
  --line-step: 30px;
  --spine-width: 14px;
  --margin-left: 22px;
  background: var(--sb-bg-elevated);
  border-color: color-mix(in srgb, var(--sb-accent-solid) 16%, var(--sb-border));
  box-shadow:
    0 20px 50px rgb(0 0 0 / 0.32),
    0 0 0 1px color-mix(in srgb, var(--sb-accent-solid) 8%, transparent);
}

.scratchpad-panel--dragging {
  cursor: grabbing;
  box-shadow:
    0 24px 56px rgb(0 0 0 / 0.38),
    0 0 0 1px color-mix(in srgb, var(--sb-accent-solid) 14%, transparent);
}

.scratchpad-panel__spine {
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

.scratchpad-panel__hole {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--sb-bg-base);
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.18);
}

.scratchpad-panel__sheet {
  margin-left: var(--spine-width);
  position: relative;
}

.scratchpad-panel__sheet::before {
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

.scratchpad-panel__header {
  border-color: var(--sb-border-subtle);
  background: color-mix(in srgb, var(--sb-bg-panel) 90%, var(--sb-bg-elevated));
}

.scratchpad-panel__icon-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: var(--sb-text-muted);
  transition: background-color 0.15s, color 0.15s;
}

.scratchpad-panel__icon-btn:hover {
  color: var(--sb-text-secondary);
  background: var(--sb-bg-hover);
}

.scratchpad-panel__icon-btn--active {
  color: var(--sb-accent-solid);
  background: var(--sb-bg-inset);
}

.scratchpad-panel__icon-btn--danger:hover {
  color: #f87171;
  background: rgb(248 113 113 / 0.1);
}

.scratchpad-panel__editor {
  background: color-mix(in srgb, var(--sb-accent-solid) 4%, var(--sb-bg-surface));
}

.scratchpad-editor-enter-active,
.scratchpad-editor-leave-active {
  transition: opacity 0.18s ease, max-height 0.22s ease;
  overflow: hidden;
}

.scratchpad-editor-enter-from,
.scratchpad-editor-leave-to {
  opacity: 0;
  max-height: 0;
}

.scratchpad-editor-enter-to,
.scratchpad-editor-leave-from {
  opacity: 1;
  max-height: 200px;
}

.scratchpad-panel__body {
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

.scratchpad-panel__list {
  padding-top: 4px;
}

.scratchpad-panel__row {
  position: relative;
  height: var(--line-step);
  display: flex;
  align-items: flex-end;
  padding: 0 8px 0 var(--margin-left);
}

.scratchpad-panel__row:hover .scratchpad-panel__actions {
  opacity: 1;
  pointer-events: auto;
}

.scratchpad-panel__row:hover .scratchpad-panel__label-text {
  mask-image: linear-gradient(to right, #000 55%, transparent 92%);
  -webkit-mask-image: linear-gradient(to right, #000 55%, transparent 92%);
}

.scratchpad-panel__label {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 0 4px 7px 0;
  text-align: left;
  font-size: 12px;
  line-height: 1;
  border-radius: 4px;
  transition: color 0.12s;
}

.scratchpad-panel__label--ready {
  color: var(--sb-text-primary);
}

.scratchpad-panel__label--ready:hover {
  color: var(--sb-accent-solid);
}

.scratchpad-panel__label--empty {
  color: var(--sb-text-faint);
  opacity: 0.75;
}

.scratchpad-panel__label--empty:hover {
  opacity: 1;
  color: var(--sb-text-muted);
}

.scratchpad-panel__label:active {
  transform: translateY(0.5px);
}

.scratchpad-panel__label-text {
  flex: 1;
  min-width: 0;
}

.scratchpad-panel__status {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
  margin-bottom: 1px;
}

.scratchpad-panel__status--ready {
  background: #34d399;
  box-shadow: 0 0 0 2px rgb(52 211 153 / 0.2);
}

.scratchpad-panel__status--empty {
  background: var(--sb-text-faint);
  opacity: 0.35;
}

.scratchpad-panel__actions {
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

.scratchpad-panel__action {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--sb-text-faint);
  transition: background-color 0.12s, color 0.12s;
}

.scratchpad-panel__action:hover {
  color: var(--sb-text-primary);
  background: var(--sb-bg-hover);
}

.scratchpad-panel__action--warn:hover {
  color: #fbbf24;
  background: rgb(251 191 36 / 0.12);
}

.scratchpad-panel__action--danger:hover {
  color: #f87171;
  background: rgb(248 113 113 / 0.12);
}

.scratchpad-panel__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  padding: 16px;
}

.scratchpad-panel__footer {
  background: color-mix(in srgb, var(--sb-bg-panel) 85%, var(--sb-bg-elevated));
}
</style>
