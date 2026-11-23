<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import {
  Archive,
  BookOpen,
  Clock,
  History,
  LayoutGrid,
  Pencil,
  PlayCircle,
  Search,
  Settings,
  Star,
  Store,
  Timer,
  Upload
} from 'lucide-vue-next'
import type { CategoryItem, NavFilter, NavItem } from '../../../shared/types/script'
import { useToast } from '../composables/useToast'
import { askConfirm } from '../composables/useConfirmDialog'
import { askPrompt } from '../composables/usePromptDialog'
import CategoryTreeList from './CategoryTreeList.vue'

defineProps<{
  navItems: NavItem[]
  categories: CategoryItem[]
  activeCategoryKey?: string | null
}>()

const searchQuery = defineModel<string>('searchQuery', { required: true })

const { pushToast } = useToast()

const emit = defineEmits<{
  navigate: [filter: NavFilter]
  category: [key: string | null]
  manageCategories: []
  import: []
  settings: []
  devGuide: []
  executionHistory: []
  categoriesChanged: []
  pluginCenter: []
}>()

const navIcons = {
  'layout-grid': LayoutGrid,
  'play-circle': PlayCircle,
  timer: Timer,
  star: Star,
  clock: Clock,
  archive: Archive
} as const

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    const input = document.getElementById('sidebar-search') as HTMLInputElement | null
    input?.focus()
  }
}

async function openAutoforgeHub(): Promise<void> {
  emit('pluginCenter')
}

async function onCreateChild(item: CategoryItem): Promise<void> {
  const label = await askPrompt({
    title: '新建子分类',
    message: `将在「${item.name}」下创建子分类。`,
    label: '分类名称',
    placeholder: '请输入分类名称',
    confirmLabel: '创建'
  })
  if (label == null) return
  const trimmed = label.trim()
  if (!trimmed) return
  try {
    await window.autoforge.categories.create(trimmed, 'teal', item.id)
    pushToast({ type: 'success', title: '已创建', message: `子分类「${trimmed}」已创建` })
    emit('categoriesChanged')
  } catch (err) {
    pushToast({
      type: 'error',
      title: '创建失败',
      message: err instanceof Error ? err.message : '无法创建子分类'
    })
  }
}

async function onRename(item: CategoryItem): Promise<void> {
  const label = await askPrompt({
    title: '重命名分类',
    label: '分类名称',
    defaultValue: item.name,
    placeholder: '请输入分类名称',
    confirmLabel: '保存'
  })
  if (label == null) return
  const trimmed = label.trim()
  if (!trimmed || trimmed === item.name) return
  try {
    await window.autoforge.categories.update(item.id, { label: trimmed })
    pushToast({ type: 'success', title: '已保存', message: `分类已重命名为「${trimmed}」` })
    emit('categoriesChanged')
  } catch (err) {
    pushToast({
      type: 'error',
      title: '重命名失败',
      message: err instanceof Error ? err.message : '无法重命名分类'
    })
  }
}

async function onDelete(item: CategoryItem): Promise<void> {
  if (item.id.startsWith('builtin:')) return
  const confirmed = await askConfirm({
    title: '删除分类',
    message: `仅当「${item.name}」没有子分类且没有脚本直接挂在此分类下时可删除。`,
    confirmLabel: '删除',
    variant: 'danger'
  })
  if (!confirmed) return
  const result = await window.autoforge.categories.delete(item.id)
  if (!result.ok) {
    pushToast({ type: 'error', title: '删除失败', message: result.error })
    return
  }
  pushToast({ type: 'success', title: '已删除', message: `分类「${item.name}」已删除` })
  emit('categoriesChanged')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <aside
    class="relative w-full flex-shrink-0 border-r sb-border sb-bg-panel flex flex-col min-h-0 h-full overflow-hidden"
  >
    <div class="flex-shrink-0 px-3 pt-3">
      <button
        type="button"
        class="w-full flex items-center justify-center gap-2 h-8 rounded-lg sb-btn-accent text-[12px] font-medium transition-colors"
        @click="emit('import')"
      >
        <Upload class="w-3.5 h-3.5" :stroke-width="1.5" />
        上传脚本
      </button>
    </div>
    <div class="flex-shrink-0 p-3">
      <div class="relative group">
        <Search
          class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sb-text-faint group-focus-within:sb-text-muted transition-colors"
          :stroke-width="1.5"
        />
        <input
          id="sidebar-search"
          v-model="searchQuery"
          type="text"
          placeholder="搜索"
          class="w-full h-8 pl-8 pr-3 text-[13px] sb-input border rounded-lg placeholder:sb-text-faint outline-none focus:sb-input transition-all"
        />
        <kbd
          class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] sb-text-faint sb-bg-inset px-1.5 py-0.5 rounded border sb-border-subtle font-mono"
        >⌘K</kbd>
      </div>
    </div>

    <nav class="flex-shrink-0 px-2 space-y-0.5">
      <button
        v-for="item in navItems"
        :key="item.id"
        type="button"
        class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors text-left"
        :class="
          item.active
            ? 'sb-nav-active sb-text-primary font-medium'
            : 'sb-text-muted hover:sb-text-secondary sb-bg-hover'
        "
        @click="emit('navigate', item.id as NavFilter)"
      >
        <component :is="navIcons[item.icon]" class="w-4 h-4" :class="item.active ? 'text-[var(--sb-accent-solid)]' : ''" :stroke-width="1.5" />
        {{ item.label }}
        <span v-if="item.count !== undefined" class="ml-auto text-[11px] sb-text-muted font-normal">{{ item.count }}</span>
        <span v-else-if="item.badge" class="ml-auto flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span class="text-[11px] text-emerald-500/80">{{ item.badge }}</span>
        </span>
      </button>
    </nav>

    <div class="mt-5 px-3 flex-1 min-h-0 flex flex-col">
      <div class="flex-shrink-0 flex items-center justify-between mb-2 px-0.5">
        <span class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">分类</span>
        <button
          type="button"
          class="sb-text-faint hover:sb-text-muted transition-colors"
          title="管理分类"
          @click="emit('manageCategories')"
        >
          <Pencil class="w-3.5 h-3.5" :stroke-width="1.5" />
        </button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1">
        <CategoryTreeList
          :items="categories"
          :active-key="activeCategoryKey ?? null"
          enable-context-menu
          @select="(key) => emit('category', key)"
          @create-child="onCreateChild"
          @rename="onRename"
          @delete="onDelete"
        />
      </div>
    </div>

    <div class="flex-shrink-0 p-3 border-t sb-border-subtle">
      <div class="flex items-center justify-around gap-0.5 pt-0.5">
        <button
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded-md hover:bg-violet-500/10 transition-colors"
          title="脚本中心"
          @click="openAutoforgeHub"
        >
          <Store class="w-4 h-4 text-violet-500" :stroke-width="1.5" />
        </button>
        <button
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded-md hover:bg-emerald-500/10 transition-colors"
          title="脚本开发指南"
          @click="emit('devGuide')"
        >
          <BookOpen class="w-4 h-4 text-emerald-500" :stroke-width="1.5" />
        </button>
        <button
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded-md hover:bg-amber-500/10 transition-colors"
          title="执行历史"
          @click="emit('executionHistory')"
        >
          <History class="w-4 h-4 text-amber-500" :stroke-width="1.5" />
        </button>
        <button
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded-md hover:bg-sky-500/10 transition-colors"
          title="设置"
          @click="emit('settings')"
        >
          <Settings class="w-4 h-4 text-sky-500" :stroke-width="1.5" />
        </button>
      </div>
    </div>
  </aside>
</template>
