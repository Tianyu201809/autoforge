<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FolderTree, Pencil, Trash2, X } from 'lucide-vue-next'
import { CATEGORY_COLOR_PRESETS, getColorPreset } from '../../../shared/category-colors'
import type { CategoryDefinition } from '../../../shared/types/script'
import { askConfirm } from '../composables/useConfirmDialog'
import { useToast } from '../composables/useToast'

const props = defineProps<{
  open: boolean
  categories: CategoryDefinition[]
}>()

const emit = defineEmits<{
  close: []
  refresh: []
}>()

const editingId = ref<string | null>(null)
const formLabel = ref('')
const formColor = ref('teal')
const saving = ref(false)
const { pushToast } = useToast()

const editingCategory = computed(() =>
  props.categories.find((c) => c.id === editingId.value) ?? null
)

const customCount = computed(() => props.categories.filter((c) => !c.builtIn).length)

watch(
  () => props.open,
  (open) => {
    if (open) {
      editingId.value = null
      formLabel.value = ''
      formColor.value = 'teal'
    }
  }
)

function startCreate(): void {
  editingId.value = null
  formLabel.value = ''
  formColor.value = 'teal'
}

function startEdit(cat: CategoryDefinition): void {
  editingId.value = cat.id
  formLabel.value = cat.label
  formColor.value = cat.colorPreset
}

function cancelEdit(): void {
  editingId.value = null
  formLabel.value = ''
  formColor.value = 'teal'
}

async function saveForm(): Promise<void> {
  const label = formLabel.value.trim()
  if (!label) return
  saving.value = true
  try {
    if (editingId.value) {
      await window.autoforge.categories.update(editingId.value, {
        label,
        colorPreset: formColor.value
      })
      pushToast({ type: 'success', title: '已保存', message: `分类「${label}」已更新` })
    } else {
      await window.autoforge.categories.create(label, formColor.value)
      pushToast({ type: 'success', title: '已创建', message: `分类「${label}」已创建` })
    }
    cancelEdit()
    emit('refresh')
  } catch (err) {
    pushToast({
      type: 'error',
      title: '保存失败',
      message: err instanceof Error ? err.message : '无法保存分类'
    })
  } finally {
    saving.value = false
  }
}

async function deleteCategory(cat: CategoryDefinition): Promise<void> {
  if (cat.builtIn) return
  const confirmed = await askConfirm({
    title: '删除分类',
    message: `删除「${cat.label}」后，使用该分类的脚本将移至「本地程序」。此操作不可撤销。`,
    confirmLabel: '删除',
    variant: 'danger'
  })
  if (!confirmed) return
  const result = await window.autoforge.categories.delete(cat.id)
  if (!result.ok) {
    pushToast({ type: 'error', title: '删除失败', message: result.error })
    return
  }
  if (editingId.value === cat.id) cancelEdit()
  emit('refresh')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="category-modal">
      <div
        v-if="open"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
        @click.self="emit('close')"
      >
        <div class="absolute inset-0 bg-stone-950/40 backdrop-blur-[3px]" aria-hidden="true" />

        <div
          class="category-modal-panel relative w-full max-w-lg rounded-xl border sb-border sb-bg-panel shadow-[0_24px_64px_rgba(28,25,23,0.18)] flex flex-col max-h-[min(88vh,640px)] overflow-hidden"
          role="dialog"
          aria-labelledby="category-modal-title"
          @click.stop
        >
          <!-- 头部 -->
          <div class="relative flex items-start justify-between gap-3 px-5 py-4 border-b sb-border-subtle category-modal-header overflow-hidden">
            <div
              class="absolute inset-x-0 top-0 h-px pointer-events-none"
              style="background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sb-accent-solid) 50%, transparent), transparent)"
              aria-hidden="true"
            />
            <div class="flex items-start gap-3 min-w-0">
              <div class="w-9 h-9 rounded-lg sb-bg-inset border sb-border-subtle flex items-center justify-center flex-shrink-0">
                <FolderTree class="w-4 h-4 text-[var(--sb-accent-solid)]" :stroke-width="1.5" />
              </div>
              <div class="min-w-0">
                <h2 id="category-modal-title" class="text-[15px] font-semibold sb-text-primary tracking-tight">
                  分类管理
                </h2>
                <p class="text-[11px] sb-text-muted mt-0.5 leading-relaxed">
                  自定义脚本分组，侧栏筛选与卡片标签同步更新
                </p>
              </div>
            </div>
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-secondary hover:sb-bg-inset transition-colors flex-shrink-0"
              title="关闭"
              @click="emit('close')"
            >
              <X class="w-4 h-4" :stroke-width="1.5" />
            </button>
          </div>

          <!-- 分类列表 -->
          <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3">
            <div class="flex items-center justify-between mb-2 px-0.5">
              <p class="text-[10px] font-medium sb-text-faint uppercase tracking-wider">
                全部分类
              </p>
              <span class="text-[10px] sb-text-faint tabular-nums">
                {{ categories.length }} 个 · 自定义 {{ customCount }}
              </span>
            </div>

            <ul class="space-y-1.5">
              <li
                v-for="cat in categories"
                :key="cat.id"
                class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors group"
                :class="
                  editingId === cat.id
                    ? 'sb-nav-active'
                    : 'sb-bg-surface sb-border-subtle hover:border-[var(--sb-border)]'
                "
              >
                <span
                  class="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white/10"
                  :style="{ backgroundColor: getColorPreset(cat.colorPreset).swatchColor }"
                />
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded border font-medium truncate max-w-[40%]"
                  :class="cat.badgeColor"
                >
                  {{ cat.label }}
                </span>
                <span class="flex-1 min-w-0 text-[11px] sb-text-faint font-mono truncate">{{ cat.key }}</span>
                <span
                  v-if="cat.builtIn"
                  class="text-[10px] px-1.5 py-0.5 rounded border sb-border-subtle sb-bg-inset sb-text-faint flex-shrink-0"
                >
                  内置
                </span>
                <div
                  class="flex items-center gap-0.5 flex-shrink-0 transition-opacity"
                  :class="editingId === cat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                >
                  <button
                    type="button"
                    class="w-7 h-7 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary hover:sb-bg-hover"
                    title="编辑"
                    @click="startEdit(cat)"
                  >
                    <Pencil class="w-3.5 h-3.5" :stroke-width="1.5" />
                  </button>
                  <button
                    v-if="!cat.builtIn"
                    type="button"
                    class="w-7 h-7 flex items-center justify-center rounded-md text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
                    title="删除"
                    @click="deleteCategory(cat)"
                  >
                    <Trash2 class="w-3.5 h-3.5" :stroke-width="1.5" />
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <!-- 新建 / 编辑 -->
          <div class="flex-shrink-0 border-t sb-border-subtle sb-bg-inset/60 px-4 py-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <p class="text-[11px] font-medium sb-text-secondary">
                {{ editingCategory ? `编辑分类 · ${editingCategory.label}` : '新建分类' }}
              </p>
              <button
                v-if="editingCategory"
                type="button"
                class="text-[11px] sb-text-faint hover:sb-text-muted transition-colors"
                @click="cancelEdit"
              >
                取消编辑
              </button>
            </div>

            <div>
              <label class="text-[10px] font-medium sb-text-faint uppercase tracking-wider">名称</label>
              <input
                v-model="formLabel"
                type="text"
                placeholder="例如：数据采集"
                class="mt-1.5 w-full h-9 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input"
                @keydown.enter="saveForm"
              />
            </div>

            <div>
              <label class="text-[10px] font-medium sb-text-faint uppercase tracking-wider">标识颜色</label>
              <div class="mt-2 grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                <button
                  v-for="preset in CATEGORY_COLOR_PRESETS"
                  :key="preset.id"
                  type="button"
                  class="flex flex-col items-center gap-1 py-2 px-1 rounded-lg border transition-all"
                  :class="
                    formColor === preset.id
                      ? 'sb-nav-active scale-[1.02]'
                      : 'sb-border-subtle sb-bg-surface hover:sb-bg-hover'
                  "
                  :title="preset.label"
                  @click="formColor = preset.id"
                >
                  <span
                    class="w-4 h-4 rounded-full ring-1 ring-black/5"
                    :style="{ backgroundColor: preset.swatchColor }"
                  />
                  <span class="text-[9px] sb-text-faint leading-none">{{ preset.label }}</span>
                </button>
              </div>
            </div>

            <div class="flex gap-2 pt-1">
              <button
                type="button"
                class="flex-1 h-9 rounded-lg sb-btn-accent text-[13px] font-medium disabled:opacity-40 transition-opacity"
                :disabled="!formLabel.trim() || saving"
                @click="saveForm"
              >
                {{ saving ? '保存中…' : editingCategory ? '保存修改' : '创建分类' }}
              </button>
              <button
                v-if="!editingCategory"
                type="button"
                class="h-9 px-3 rounded-lg border sb-border sb-bg-surface sb-text-muted text-[13px] hover:sb-text-secondary hover:sb-bg-hover transition-colors"
                title="清空表单"
                @click="startCreate"
              >
                清空
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.category-modal-header {
  background: color-mix(in srgb, var(--sb-accent-solid) 8%, var(--sb-bg-panel));
  box-shadow: inset 3px 0 0 var(--sb-accent-solid);
}

.category-modal-enter-active,
.category-modal-leave-active {
  transition: opacity 0.22s ease;
}

.category-modal-enter-from,
.category-modal-leave-to {
  opacity: 0;
}

.category-modal-enter-active .category-modal-panel,
.category-modal-leave-active .category-modal-panel {
  transition:
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.22s ease;
}

.category-modal-enter-from .category-modal-panel,
.category-modal-leave-to .category-modal-panel {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}
</style>
