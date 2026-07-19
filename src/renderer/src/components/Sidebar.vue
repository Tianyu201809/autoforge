<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import {
  clampMainSidebarWidth,
  MAIN_SIDEBAR_DEFAULT_WIDTH,
  MAIN_SIDEBAR_WIDTH_KEY
} from '../constants/layout'
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
  Store,
  Timer,
  Upload
} from 'lucide-vue-next'
import type { CategoryItem, NavFilter, NavItem } from '../../../shared/types/script'
import { useToast } from '../composables/useToast'

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
  try {
    const config = await window.autoforge.config.get()
    const url = config.hub?.url?.trim()
    if (!url) {
      pushToast({ type: 'info', title: 'AutoforgeHub', message: 'AutoforgeHub地址未设置' })
      return
    }
    const opened = await window.autoforge.system.openExternal(url)
    if (!opened) {
      pushToast({ type: 'error', title: '打开失败', message: 'AutoforgeHub地址无效' })
    }
  } catch (err) {
    pushToast({
      type: 'error',
      title: '打开失败',
      message: err instanceof Error ? err.message : '无法打开AutoforgeHub'
    })
  }
}

const sidebarWidth = ref(MAIN_SIDEBAR_DEFAULT_WIDTH)
const resizing = ref(false)

function loadSidebarWidth(): void {
  const stored = Number(localStorage.getItem(MAIN_SIDEBAR_WIDTH_KEY))
  sidebarWidth.value = clampMainSidebarWidth(
    Number.isFinite(stored) && stored > 0 ? stored : MAIN_SIDEBAR_DEFAULT_WIDTH
  )
}

function onWindowResize(): void {
  sidebarWidth.value = clampMainSidebarWidth(sidebarWidth.value)
}

function onResizeStart(e: MouseEvent): void {
  e.preventDefault()
  resizing.value = true
  const startX = e.clientX
  const startWidth = sidebarWidth.value

  const onMove = (ev: MouseEvent): void => {
    sidebarWidth.value = clampMainSidebarWidth(startWidth + (ev.clientX - startX))
  }

  const onUp = (): void => {
    resizing.value = false
    localStorage.setItem(MAIN_SIDEBAR_WIDTH_KEY, String(sidebarWidth.value))
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onResizeReset(): void {
  sidebarWidth.value = MAIN_SIDEBAR_DEFAULT_WIDTH
  localStorage.setItem(MAIN_SIDEBAR_WIDTH_KEY, String(MAIN_SIDEBAR_DEFAULT_WIDTH))
}

onMounted(() => {
  loadSidebarWidth()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onWindowResize)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onWindowResize)
})
</script>

<template>
  <aside
    class="relative flex-shrink-0 border-r sb-border sb-bg-panel flex flex-col min-h-0 h-full overflow-hidden"
    :class="resizing && 'select-none'"
    :style="{ width: `${sidebarWidth}px` }"
  >
    <div
      class="resize-handle-col resize-handle-col--edge-right"
      :class="resizing && 'is-active'"
      title="拖拽调节宽度，双击恢复默认"
      @mousedown="onResizeStart"
      @dblclick="onResizeReset"
    />
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
          <Plus class="w-3.5 h-3.5" :stroke-width="1.5" />
        </button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-0.5 -mx-1 px-1">
        <button
          v-for="cat in categories"
          :key="cat.key"
          type="button"
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors text-left"
          :class="
            activeCategoryKey === cat.key
              ? 'sb-category-active sb-text-primary font-medium'
              : 'sb-text-muted hover:sb-text-secondary sb-bg-hover'
          "
          @click="emit('category', cat.key)"
        >
          <span
            class="w-2 h-2 rounded-full shrink-0"
            :class="[
              cat.color,
              activeCategoryKey === cat.key && 'ring-2 ring-[var(--sb-accent-solid)] ring-offset-1 ring-offset-[var(--sb-bg-panel)]'
            ]"
          ></span>
          {{ cat.name }}
          <span class="ml-auto text-[11px] sb-text-faint">{{ cat.count }}</span>
        </button>
      </div>
    </div>

    <div class="flex-shrink-0 p-3 border-t sb-border-subtle">
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
        @click="openAutoforgeHub"
      >
        <Store class="w-4 h-4" :stroke-width="1.5" />
        <span>进入AutoforgeHub</span>
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
