<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import {
  Archive,
  BookOpen,
  Clock,
  History,
  LayoutGrid,
  PlayCircle,
  Plus,
  Search,
  Settings,
  Star,
  Upload
} from 'lucide-vue-next'
import type { CategoryItem, NavFilter, NavItem } from '../../../shared/types/script'

defineProps<{
  navItems: NavItem[]
  categories: CategoryItem[]
  activeCategoryKey?: string | null
}>()

const searchQuery = defineModel<string>('searchQuery', { required: true })

const emit = defineEmits<{
  navigate: [filter: NavFilter]
  category: [key: string | null]
  manageCategories: []
  import: []
  settings: []
  devGuide: []
  executionHistory: []
}>()

const navIcons = {
  'layout-grid': LayoutGrid,
  'play-circle': PlayCircle,
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

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <aside class="w-56 flex-shrink-0 border-r sb-border sb-bg-panel flex flex-col">
    <div class="p-3">
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

    <nav class="px-2 space-y-0.5">
      <button
        v-for="item in navItems"
        :key="item.id"
        type="button"
        class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors text-left"
        :class="
          item.active
            ? 'sb-bg-inset sb-text-primary font-medium border-l-2 border-[var(--sb-accent-solid)] pl-[calc(0.625rem-2px)] shadow-[inset_0_0_0_1px_rgba(234,88,12,0.12)]'
            : 'sb-text-muted hover:sb-text-secondary sb-bg-hover border-l-2 border-transparent pl-2.5'
        "
        @click="emit('navigate', item.id as NavFilter)"
      >
        <component :is="navIcons[item.icon]" class="w-4 h-4" :class="item.active ? 'sb-text-muted' : ''" :stroke-width="1.5" />
        {{ item.label }}
        <span v-if="item.count !== undefined" class="ml-auto text-[11px] sb-text-muted font-normal">{{ item.count }}</span>
        <span v-else-if="item.badge" class="ml-auto flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span class="text-[11px] text-emerald-500/80">{{ item.badge }}</span>
        </span>
      </button>
    </nav>

    <div class="mt-5 px-3">
      <div class="flex items-center justify-between mb-2 px-0.5">
        <span class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">分类</span>
        <button
          type="button"
          class="sb-text-faint hover:sb-text-muted transition-colors"
          title="管理分类"
          @click="emit('manageCategories')"
        >
          <Plus class="w-3.5 h-3.5" :stroke-width="1.5" />
        </button>
      </div>
      <div class="space-y-0.5">
        <button
          v-for="cat in categories"
          :key="cat.key"
          type="button"
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors text-left border-l-2"
          :class="
            activeCategoryKey === cat.key
              ? 'sb-category-active sb-text-primary font-semibold border-[var(--sb-accent-solid)] pl-[calc(0.5rem-2px)]'
              : 'sb-text-muted hover:sb-text-secondary sb-bg-hover border-transparent'
          "
          @click="emit('category', cat.key)"
        >
          <span class="w-2 h-2 rounded-full" :class="cat.color"></span>
          {{ cat.name }}
          <span class="ml-auto text-[11px] sb-text-faint">{{ cat.count }}</span>
        </button>
      </div>
    </div>

    <div class="mt-auto p-3 border-t sb-border-subtle">
      <button
        type="button"
        class="w-full flex items-center justify-center gap-2 h-8 rounded-lg sb-btn-accent text-[13px] font-medium transition-colors"
        @click="emit('import')"
      >
        <Upload class="w-3.5 h-3.5" :stroke-width="1.5" />
        上传脚本
      </button>
      <button
        type="button"
        class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md sb-text-muted hover:sb-text-secondary sb-bg-hover text-[13px] transition-colors"
        @click="emit('devGuide')"
      >
        <BookOpen class="w-4 h-4" :stroke-width="1.5" />
        脚本开发指南
      </button>
      <button
        type="button"
        class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md sb-text-muted hover:sb-text-secondary sb-bg-hover text-[13px] transition-colors"
        @click="emit('executionHistory')"
      >
        <History class="w-4 h-4" :stroke-width="1.5" />
        执行历史
      </button>
      <button
        type="button"
        class="mt-1 w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md sb-text-muted hover:sb-text-secondary sb-bg-hover text-[13px] transition-colors"
        @click="emit('settings')"
      >
        <Settings class="w-4 h-4" :stroke-width="1.5" />
        设置
      </button>
    </div>
  </aside>
</template>
