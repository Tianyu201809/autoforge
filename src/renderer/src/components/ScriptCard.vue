<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  AlertCircle,
  Archive,
  Check,
  ChevronRight,
  Download,
  FolderOpen,
  Loader2,
  Clock,
  MoreHorizontal,
  Layers,
  Pencil,
  PencilLine,
  Play,
  RotateCw,
  Settings,
  Square,
  Star,
  Tags,
  Terminal,
  Timer,
  Trash2
} from 'lucide-vue-next'
import type { CategoryDefinition, ScriptItem } from '../../../shared/types/script'
import { buildCategoryTree } from '../../../shared/category-tree'
import { describeCronExpression } from '../../../shared/cron-schedule'
import { scriptLanguageBadge } from '../../../shared/script-language'
import { resolveScriptIcon } from '../lib/script-icon-map'
import { renameScript } from '../composables/useScriptRename'
import {
  closeActiveScriptCardMenu,
  registerScriptCardMenuClose,
  unregisterScriptCardMenuClose
} from '../composables/useScriptCardMenu'
import { useToast } from '../composables/useToast'
import { askConfirm } from '../composables/useConfirmDialog'

const { pushToast } = useToast()

const props = defineProps<{
  script: ScriptItem
  selected?: boolean
  categoryDefinitions?: CategoryDefinition[]
}>()

const emit = defineEmits<{
  select: []
  start: []
  stop: []
  restart: []
  batchRun: []
  toggleStar: []
  edit: []
  archive: []
  delete: []
  openDir: []
  viewLog: []
  config: []
  categoryChanged: []
}>()

const menuOpen = ref(false)
const categoryPickerOpen = ref(false)
const savingCategory = ref(false)
const renaming = ref(false)
const exporting = ref(false)
const menuBtnRef = ref<HTMLElement | null>(null)
const menuDropdownRef = ref<HTMLElement | null>(null)
const categoryPickerRef = ref<HTMLElement | null>(null)
const menuPos = ref({ top: 0, left: 0 })
const categoryPickerPos = ref({ top: 0, left: 0 })
const menuContextPoint = ref<{ x: number; y: number } | null>(null)
const categoryTriggerRef = ref<HTMLElement | null>(null)

const VIEWPORT_PADDING = 8
const MENU_GAP = 4

const ScriptIcon = computed(() => resolveScriptIcon(props.script.icon))

const languageBadge = computed(() => scriptLanguageBadge(props.script.language))

const scheduleSummary = computed(() => {
  if (!props.script.schedule?.enabled) return null
  return describeCronExpression(props.script.schedule.expression)
})

const indentedCategoryOptions = computed(() => {
  const defs = props.categoryDefinitions ?? []
  const tree = buildCategoryTree(defs)
  const rows: Array<{ cat: CategoryDefinition; depth: number }> = []
  function walk(nodes: ReturnType<typeof buildCategoryTree<CategoryDefinition>>, depth: number): void {
    for (const node of nodes) {
      rows.push({ cat: node.category, depth })
      walk(node.children, depth + 1)
    }
  }
  walk(tree, 0)
  return rows
})

const footerMetaFull = computed(() => {
  if (props.script.status === 'error') return props.script.errorMeta ?? ''
  return props.script.meta || '尚未运行'
})

const footerMetaCompact = computed(() => {
  const meta = footerMetaFull.value
  if (meta.startsWith('最近运行 ')) return meta.slice(5)
  return meta
})

async function handleExport(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  closeMenu()
  try {
    const preview = await window.autoforge.scripts.previewExport(props.script.id)
    const confirmed = await askConfirm({
      title: '导出脚本 ZIP',
      message: preview.message,
      confirmLabel: '选择保存位置',
      cancelLabel: '取消'
    })
    if (!confirmed) return
    const result = await window.autoforge.scripts.exportZip(props.script.id)
    if (!result) return
    pushToast({
      type: 'success',
      title: '导出成功',
      message: `${result.fileName}（${result.fileCount} 个文件）`
    })
  } catch (error) {
    pushToast({
      type: 'error',
      title: '导出失败',
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    exporting.value = false
  }
}

const footerShowsRunTime = computed(() => footerMetaFull.value.startsWith('最近运行 '))

const cardClass = computed(() => {
  if (props.script.status === 'running') {
    return 'border-emerald-500/40 sb-bg-card hover:sb-bg-elevated hover:border-emerald-500/50'
  }
  if (props.script.status === 'error') {
    return 'border-red-500/15 sb-bg-card hover:sb-bg-elevated hover:border-red-500/25'
  }
  return 'border sb-border sb-bg-card hover:sb-bg-elevated hover:border-[var(--sb-border-input)]'
})

function clampToViewport(left: number, top: number, width: number, height: number): { top: number; left: number } {
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)
  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING)
  return {
    left: Math.min(Math.max(VIEWPORT_PADDING, left), maxLeft),
    top: Math.min(Math.max(VIEWPORT_PADDING, top), maxTop)
  }
}

function fitBelowOrAbove(anchor: DOMRect, width: number, height: number): { top: number; left: number } {
  const spaceBelow = window.innerHeight - anchor.bottom - VIEWPORT_PADDING
  const spaceAbove = anchor.top - VIEWPORT_PADDING
  let top: number

  if (spaceBelow >= height) {
    top = anchor.bottom + MENU_GAP
  } else if (spaceAbove >= height) {
    top = anchor.top - height - MENU_GAP
  } else if (spaceBelow >= spaceAbove) {
    top = anchor.bottom + MENU_GAP
  } else {
    top = anchor.top - height - MENU_GAP
  }

  const left = anchor.right - width
  return clampToViewport(left, top, width, height)
}

function fitAtPoint(x: number, y: number, width: number, height: number): { top: number; left: number } {
  const spaceBelow = window.innerHeight - y - VIEWPORT_PADDING
  const spaceAbove = y - VIEWPORT_PADDING
  let top = y

  if (y + height > window.innerHeight - VIEWPORT_PADDING) {
    top = spaceAbove >= height ? y - height : window.innerHeight - height - VIEWPORT_PADDING
  }

  return clampToViewport(x, top, width, height)
}

async function repositionMainMenu(): Promise<void> {
  await nextTick()
  const el = menuDropdownRef.value
  if (!el) return

  const { width, height } = el.getBoundingClientRect()
  const point = menuContextPoint.value

  if (point) {
    menuPos.value = fitAtPoint(point.x, point.y, width, height)
  } else if (menuBtnRef.value) {
    menuPos.value = fitBelowOrAbove(menuBtnRef.value.getBoundingClientRect(), width, height)
  } else {
    menuPos.value = clampToViewport(menuPos.value.left, menuPos.value.top, width, height)
  }
}

async function repositionCategoryPicker(): Promise<void> {
  await nextTick()
  const picker = categoryPickerRef.value
  const trigger = categoryTriggerRef.value
  if (!picker || !trigger) return

  const triggerRect = trigger.getBoundingClientRect()
  const { width: pickerWidth, height: pickerHeight } = picker.getBoundingClientRect()
  const menuRect = menuDropdownRef.value?.getBoundingClientRect()

  let left = triggerRect.right + MENU_GAP
  if (left + pickerWidth > window.innerWidth - VIEWPORT_PADDING) {
    left = triggerRect.left - pickerWidth - MENU_GAP
  }
  if (left < VIEWPORT_PADDING) {
    left = menuRect ? menuRect.right + MENU_GAP : triggerRect.right + MENU_GAP
    if (left + pickerWidth > window.innerWidth - VIEWPORT_PADDING) {
      left = Math.max(VIEWPORT_PADDING, triggerRect.left - pickerWidth - MENU_GAP)
    }
  }

  let top = triggerRect.top
  if (top + pickerHeight > window.innerHeight - VIEWPORT_PADDING) {
    top = Math.max(VIEWPORT_PADDING, window.innerHeight - pickerHeight - VIEWPORT_PADDING)
  }

  categoryPickerPos.value = clampToViewport(left, top, pickerWidth, pickerHeight)
}

function openMenuAt(x: number, y: number): void {
  menuContextPoint.value = { x, y }
  categoryPickerOpen.value = false
  categoryTriggerRef.value = null
  if (!menuOpen.value) {
    closeActiveScriptCardMenu()
    registerScriptCardMenuClose(closeMenu)
  }
  menuOpen.value = true
  void repositionMainMenu()
}

function toggleMenu(): void {
  if (menuOpen.value) {
    closeMenu()
    return
  }
  menuContextPoint.value = null
  categoryPickerOpen.value = false
  categoryTriggerRef.value = null
  closeActiveScriptCardMenu()
  registerScriptCardMenuClose(closeMenu)
  menuOpen.value = true
  void repositionMainMenu()
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  emit('select')
  openMenuAt(event.clientX, event.clientY)
}

function closeMenu(): void {
  menuOpen.value = false
  categoryPickerOpen.value = false
  menuContextPoint.value = null
  categoryTriggerRef.value = null
  cancelCategoryPickerClose()
  unregisterScriptCardMenuClose(closeMenu)
}

let categoryPickerCloseTimer: ReturnType<typeof setTimeout> | null = null

function cancelCategoryPickerClose(): void {
  if (categoryPickerCloseTimer) {
    clearTimeout(categoryPickerCloseTimer)
    categoryPickerCloseTimer = null
  }
}

function scheduleCategoryPickerClose(): void {
  cancelCategoryPickerClose()
  categoryPickerCloseTimer = setTimeout(() => {
    categoryPickerOpen.value = false
    categoryTriggerRef.value = null
    categoryPickerCloseTimer = null
  }, 120)
}

function openCategoryPicker(event: MouseEvent): void {
  cancelCategoryPickerClose()
  categoryTriggerRef.value = event.currentTarget as HTMLElement
  categoryPickerOpen.value = true
}

function onWindowChange(): void {
  if (!menuOpen.value) return
  void repositionMainMenu()
  if (categoryPickerOpen.value) {
    void repositionCategoryPicker()
  }
}

async function applyCategory(categoryKey: string): Promise<void> {
  if (categoryKey === props.script.category || savingCategory.value) {
    closeMenu()
    return
  }
  const def = props.categoryDefinitions?.find((c) => c.key === categoryKey)
  savingCategory.value = true
  try {
    await window.autoforge.scripts.updateMeta(props.script.id, {
      category: categoryKey,
      categoryLabel: def?.label
    })
    emit('categoryChanged')
  } finally {
    savingCategory.value = false
    closeMenu()
  }
}

async function handleRename(): Promise<void> {
  if (renaming.value) return
  closeMenu()
  renaming.value = true
  try {
    const newName = await renameScript(props.script.id, props.script.name)
    if (newName) {
      pushToast({ type: 'success', title: '已保存', message: `脚本已重命名为「${newName}」` })
      emit('categoryChanged')
    }
  } finally {
    renaming.value = false
  }
}

function onDocClick(e: MouseEvent): void {
  const target = e.target as Node
  if (
    menuBtnRef.value?.contains(target) ||
    menuDropdownRef.value?.contains(target) ||
    categoryPickerRef.value?.contains(target)
  ) {
    return
  }
  closeMenu()
}

watch(menuOpen, (open) => {
  if (open) void repositionMainMenu()
})

watch(categoryPickerOpen, (open) => {
  if (open) void repositionCategoryPicker()
})

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('resize', onWindowChange)
  window.addEventListener('scroll', onWindowChange, true)
})
onUnmounted(() => {
  closeMenu()
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('resize', onWindowChange)
  window.removeEventListener('scroll', onWindowChange, true)
})
</script>

<template>
  <div
    class="group relative rounded-xl border transition-all cursor-pointer flex flex-col h-full min-w-0"
    :class="[cardClass, selected && 'script-card-selected', script.status === 'running' && 'script-card-running']"
    @click="emit('select')"
    @contextmenu="onContextMenu"
  >
    <button
      type="button"
      class="absolute top-3 left-3 w-7 h-7 flex items-center justify-center rounded-md transition-colors"
      :class="script.starred ? 'text-amber-400 hover:text-amber-300' : 'sb-text-faint hover:sb-text-muted opacity-0 group-hover:opacity-100'"
      :style="script.starred ? { opacity: 1 } : undefined"
      @click.stop="emit('toggleStar')"
    >
      <Star class="w-3.5 h-3.5" :fill="script.starred ? 'currentColor' : 'none'" :stroke-width="1.5" />
    </button>

    <div
      v-if="script.status === 'running'"
      class="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30"
    >
      <Loader2 class="w-3 h-3 text-emerald-400 animate-spin" :stroke-width="2" />
      <span class="text-[10px] font-semibold text-emerald-400">运行中</span>
    </div>
    <div
      v-else-if="script.status === 'error'"
      class="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20"
    >
      <AlertCircle class="w-3 h-3 text-red-400" :stroke-width="1.5" />
      <span class="text-[10px] font-medium text-red-400">异常</span>
    </div>

    <div class="p-4 flex flex-col flex-1 min-w-0 min-h-0">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0" :class="[script.iconBg, script.iconBorder]">
          <component :is="ScriptIcon" class="w-5 h-5" :class="script.iconColor" :stroke-width="1.5" />
        </div>
        <div class="min-w-0 flex-1" :class="script.status !== 'idle' ? 'pr-16' : ''">
          <h3 class="text-[14px] font-medium sb-text-primary truncate" :class="selected && 'font-semibold'">{{ script.name }}</h3>
          <p class="text-[12px] sb-text-muted mt-0.5 line-clamp-2">{{ script.description }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2 mt-3 min-w-0 flex-nowrap overflow-hidden">
        <span
          class="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap truncate min-w-0 shrink"
          :class="script.categoryColor"
          :title="script.categoryLabel"
        >{{ script.categoryLabel }}</span>
        <span
          class="text-[10px] px-1.5 py-0.5 rounded border font-mono font-semibold tracking-wide shrink-0 whitespace-nowrap"
          :class="languageBadge.className"
          :title="script.language === 'python' ? 'Python 脚本' : 'JavaScript 脚本'"
        >{{ languageBadge.label }}</span>
        <span class="text-[10px] sb-text-faint font-mono shrink-0 whitespace-nowrap">{{ script.version }}</span>
      </div>
      <div
        v-if="scheduleSummary"
        class="mt-2.5 flex items-center gap-1.5 min-w-0"
        :title="scheduleSummary"
      >
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium leading-tight bg-sky-500/10 border border-sky-500/20 text-sky-500/95 dark:text-sky-400/95 max-w-full">
          <Timer class="w-3 h-3 shrink-0" :stroke-width="1.75" />
          <span class="truncate">{{ scheduleSummary }}</span>
        </span>
      </div>
      <div class="script-card-footer">
        <span
          class="script-card-footer__meta"
          :class="script.status === 'error' ? 'text-red-400/70' : 'sb-text-faint'"
          :title="footerMetaFull"
        >
          <Clock
            v-if="footerShowsRunTime && script.status !== 'error'"
            class="script-card-footer__meta-icon"
            :stroke-width="1.5"
          />
          <span class="truncate">{{ footerMetaCompact }}</span>
        </span>
        <div class="script-card-footer__actions">
          <template v-if="script.status === 'running'">
            <button type="button" class="w-7 h-7 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors" @click.stop="emit('stop')">
              <Square class="w-3 h-3" :stroke-width="1.5" />
            </button>
            <button type="button" class="w-7 h-7 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors" @click.stop="emit('viewLog')">
              <Terminal class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
          </template>
          <template v-else-if="script.status === 'error'">
            <button type="button" class="w-7 h-7 flex items-center justify-center rounded-md text-emerald-500/80 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors" @click.stop="emit('restart')">
              <RotateCw class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
          </template>
          <template v-else>
            <button type="button" class="w-7 h-7 flex items-center justify-center rounded-md text-emerald-500/80 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors" @click.stop="emit('start')">
              <Play class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
            <button type="button" class="w-7 h-7 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors" @click.stop="emit('edit')">
              <Pencil class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
          </template>
          <div class="relative">
            <button
              ref="menuBtnRef"
              type="button"
              class="w-7 h-7 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors"
              :class="menuOpen && 'sb-bg-inset sb-text-primary'"
              @click.stop="toggleMenu"
            >
              <MoreHorizontal class="w-3.5 h-3.5" :stroke-width="1.5" />
            </button>
            <Teleport to="body">
              <div
                v-if="menuOpen"
                ref="menuDropdownRef"
                class="fixed z-[200] min-w-[168px] max-h-[calc(100vh-16px)] overflow-y-auto py-1 rounded-lg border sb-border sb-bg-panel shadow-xl"
                :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }"
                @click.stop
              >
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  :class="(script.activeSessionCount ?? 0) >= 5 ? 'sb-text-muted' : 'text-emerald-400/90 hover:text-emerald-400 hover:bg-emerald-500/10'"
                  :disabled="(script.activeSessionCount ?? 0) >= 5"
                  @click="emit('start'); closeMenu()"
                >
                  <Play class="w-3.5 h-3.5" :stroke-width="1.5" />
                  运行
                </button>
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  :class="(script.activeSessionCount ?? 0) > 0 ? 'text-red-400/90 hover:text-red-400 hover:bg-red-500/10' : 'sb-text-muted'"
                  :disabled="(script.activeSessionCount ?? 0) === 0"
                  @click="emit('stop'); closeMenu()"
                >
                  <Square class="w-3.5 h-3.5" :stroke-width="1.5" />
                  停止
                </button>
                <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left" @click="emit('restart'); closeMenu()">
                  <RotateCw class="w-3.5 h-3.5" :stroke-width="1.5" />
                  重启
                </button>
                <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left" @click="emit('batchRun'); closeMenu()">
                  <Layers class="w-3.5 h-3.5" :stroke-width="1.5" />
                  批量运行…
                </button>
                <div class="my-1 border-t sb-border-subtle" />
                <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left" @click="emit('edit'); closeMenu()">
                  <Pencil class="w-3.5 h-3.5" :stroke-width="1.5" />
                  编辑
                </button>
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left disabled:opacity-40"
                  :disabled="renaming"
                  @click="handleRename"
                >
                  <PencilLine class="w-3.5 h-3.5" :stroke-width="1.5" />
                  重命名
                </button>
                <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left" @click="emit('viewLog'); closeMenu()">
                  <Terminal class="w-3.5 h-3.5" :stroke-width="1.5" />
                  查看日志
                </button>
                <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left" @click="emit('config'); closeMenu()">
                  <Settings class="w-3.5 h-3.5" :stroke-width="1.5" />
                  配置
                </button>
                <div class="my-1 border-t sb-border-subtle" />
                <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left" @click="emit('toggleStar'); closeMenu()">
                  <Star class="w-3.5 h-3.5" :stroke-width="1.5" />
                  {{ script.starred ? '取消收藏' : '收藏' }}
                </button>
                <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left" @click="emit('openDir'); closeMenu()">
                  <FolderOpen class="w-3.5 h-3.5" :stroke-width="1.5" />
                  打开目录
                </button>
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left disabled:opacity-40"
                  :disabled="exporting"
                  @click="handleExport"
                >
                  <Download class="w-3.5 h-3.5" :stroke-width="1.5" />
                  导出 ZIP
                </button>
                <button
                  v-if="categoryDefinitions?.length"
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors text-left"
                  :class="categoryPickerOpen ? 'sb-text-primary sb-bg-inset' : 'sb-text-muted hover:sb-text-primary hover:sb-bg-hover'"
                  @mouseenter="openCategoryPicker"
                  @mouseleave="scheduleCategoryPickerClose"
                >
                  <Tags class="w-3.5 h-3.5 flex-shrink-0" :stroke-width="1.5" />
                  <span class="flex-1">调整分类</span>
                  <ChevronRight class="w-3 h-3 sb-text-faint flex-shrink-0" :stroke-width="1.5" />
                </button>
                <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] sb-text-muted hover:sb-text-primary hover:sb-bg-hover text-left" @click="emit('archive'); closeMenu()">
                  <Archive class="w-3.5 h-3.5" :stroke-width="1.5" />
                  {{ script.archived ? '取消归档' : '归档' }}
                </button>
                <div class="my-1 border-t sb-border-subtle" />
                <button type="button" class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-400/80 hover:text-red-400 hover:bg-red-500/10 text-left" @click="emit('delete'); closeMenu()">
                  <Trash2 class="w-3.5 h-3.5" :stroke-width="1.5" />
                  删除
                </button>
              </div>
              <div
                v-if="menuOpen && categoryPickerOpen && categoryDefinitions?.length"
                ref="categoryPickerRef"
                class="fixed z-[201] w-[168px] max-h-[calc(100vh-16px)] overflow-y-auto py-1 rounded-lg border sb-border sb-bg-panel shadow-xl"
                :style="{ top: `${categoryPickerPos.top}px`, left: `${categoryPickerPos.left}px` }"
                @mouseenter="cancelCategoryPickerClose"
                @mouseleave="scheduleCategoryPickerClose"
                @click.stop
              >
                <p class="px-3 py-1.5 text-[10px] font-medium sb-text-faint uppercase tracking-wider">选择分类</p>
                <button
                  v-for="{ cat, depth } in indentedCategoryOptions"
                  :key="cat.key"
                  type="button"
                  class="w-full flex items-center gap-2 py-1.5 text-[12px] text-left transition-colors disabled:opacity-50"
                  :class="script.category === cat.key ? 'sb-text-primary sb-bg-inset' : 'sb-text-muted hover:sb-text-primary hover:sb-bg-hover'"
                  :style="{ paddingLeft: `${12 + depth * 12}px`, paddingRight: '12px' }"
                  :disabled="savingCategory"
                  @click="applyCategory(cat.key)"
                >
                  <span class="w-2 h-2 rounded-full flex-shrink-0" :class="cat.dotColor" />
                  <span class="flex-1 truncate">{{ cat.label }}</span>
                  <Check v-if="script.category === cat.key" class="w-3 h-3 flex-shrink-0 text-[var(--sb-accent-solid)]" :stroke-width="2" />
                </button>
              </div>
            </Teleport>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
