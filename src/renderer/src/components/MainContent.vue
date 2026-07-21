<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Columns3,
  Plus,
  SlidersHorizontal,
  X
} from 'lucide-vue-next'
import type { CategoryDefinition, ScriptItem, ScriptListFilter, ScriptSortBy, ScriptSortOrder } from '../../../shared/types/script'
import { buildCategoryTree } from '../../../shared/category-tree'
import ScriptCard from './ScriptCard.vue'
import { useToast } from '../composables/useToast'

const props = defineProps<{
  scripts: ScriptItem[]
  totalScripts: number
  listPage: number
  listTotalPages: number
  selectedId?: string
  title?: string
  listFilter: ScriptListFilter
  hasActiveListFilter: boolean
  categoryDefinitions: CategoryDefinition[]
  sortBy: ScriptSortBy
  sortOrder: ScriptSortOrder
}>()

const indentedFilterCategories = computed(() => {
  const tree = buildCategoryTree(props.categoryDefinitions)
  const rows: Array<{ key: string; label: string; depth: number }> = []
  function walk(nodes: ReturnType<typeof buildCategoryTree<CategoryDefinition>>, depth: number): void {
    for (const node of nodes) {
      rows.push({
        key: node.category.key,
        label: `${'\u00A0\u00A0'.repeat(depth)}${node.category.label}`,
        depth
      })
      walk(node.children, depth + 1)
    }
  }
  walk(tree, 0)
  return rows
})

const emit = defineEmits<{
  select: [script: ScriptItem]
  import: []
  imported: []
  start: [scriptId: string]
  stop: [sessionId: string]
  restart: [scriptId: string]
  toggleStar: [scriptId: string]
  edit: [script: ScriptItem]
  archive: [scriptId: string]
  delete: [scriptId: string]
  openDir: [script: ScriptItem]
  viewLog: [script: ScriptItem]
  config: [script: ScriptItem]
  categoryChanged: []
  'update:listFilter': [filter: ScriptListFilter]
  resetListFilter: []
  'update:sortBy': [sort: ScriptSortBy]
  'update:sortOrder': [order: ScriptSortOrder]
  'update:listPage': [page: number]
}>()

const GRID_COLUMNS_KEY = 'scriptGridColumns'

type GridColumns = '2' | '3'

function readStoredGridColumns(): GridColumns {
  const stored = localStorage.getItem(GRID_COLUMNS_KEY)
  if (stored === '2' || stored === '3') return stored
  // 兼容旧版 list 视图偏好，统一映射为双列
  return localStorage.getItem('viewMode') === 'list' ? '2' : '3'
}

const gridColumns = ref<GridColumns>(readStoredGridColumns())
const filterOpen = ref(false)
const sortOpen = ref(false)
const filterWrapRef = ref<HTMLElement | null>(null)
const sortWrapRef = ref<HTMLElement | null>(null)
const mainRef = ref<HTMLElement | null>(null)
const { pushToast } = useToast()

let unbindDropZone: (() => void) | undefined

function setGridColumns(columns: GridColumns): void {
  gridColumns.value = columns
  localStorage.setItem(GRID_COLUMNS_KEY, columns)
}

const scriptGridClass = computed(() =>
  gridColumns.value === '3'
    ? 'script-card-grid script-card-grid--cols-3'
    : 'script-card-grid script-card-grid--cols-2'
)

const sortLabels: Record<ScriptSortBy, string> = {
  name: '名称',
  recentRun: '最近运行',
  importedAt: '上传时间'
}

const sortOrderLabels: Record<ScriptSortOrder, string> = {
  asc: '升序',
  desc: '降序'
}

function selectSort(key: ScriptSortBy): void {
  emit('update:sortBy', key)
}

function selectSortOrder(order: ScriptSortOrder): void {
  emit('update:sortOrder', order)
}

function patchFilter(patch: Partial<ScriptListFilter>): void {
  emit('update:listFilter', { ...props.listFilter, ...patch })
}

function onDocumentClick(e: MouseEvent): void {
  const target = e.target as Node
  if (filterOpen.value && filterWrapRef.value && !filterWrapRef.value.contains(target)) {
    filterOpen.value = false
  }
  if (sortOpen.value && sortWrapRef.value && !sortWrapRef.value.contains(target)) {
    sortOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  if (mainRef.value) {
    unbindDropZone = window.autoforge.scripts.setupDropImportZone(mainRef.value, {
      onDone: (script) => {
        emit('imported')
        pushToast({
          type: 'success',
          title: '导入成功',
          message: script.name ? `已添加「${script.name}」` : '脚本已添加到列表'
        })
      },
      onError: (message) => {
        pushToast({ type: 'error', title: '导入失败', message })
      }
    })
  }
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  unbindDropZone?.()
})
</script>

<template>
  <main ref="mainRef" class="@container flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden sb-bg-base">
    <div class="flex-shrink-0 flex flex-col gap-3 px-5 py-3 border-b sb-border-subtle @lg:flex-row @lg:items-center @lg:justify-between">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold sb-text-primary tracking-tight truncate">{{ title ?? '全部脚本' }}</h1>
        <p class="text-[13px] sb-text-muted mt-0.5">管理本机自动化脚本，常驻运行与调度</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap shrink-0">
        <div class="layout-density-toggle" role="group" aria-label="卡片布局">
          <button
            type="button"
            title="双列布局"
            class="layout-density-toggle__btn"
            :class="{ 'is-active': gridColumns === '2' }"
            :aria-pressed="gridColumns === '2'"
            @click="setGridColumns('2')"
          >
            <Columns2 class="w-3.5 h-3.5" :stroke-width="gridColumns === '2' ? 2 : 1.5" />
          </button>
          <button
            type="button"
            title="三列布局"
            class="layout-density-toggle__btn"
            :class="{ 'is-active': gridColumns === '3' }"
            :aria-pressed="gridColumns === '3'"
            @click="setGridColumns('3')"
          >
            <Columns3 class="w-3.5 h-3.5" :stroke-width="gridColumns === '3' ? 2 : 1.5" />
          </button>
        </div>

        <div ref="filterWrapRef" class="relative">
          <button
            type="button"
            class="flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] transition-all"
            :class="
              hasActiveListFilter || filterOpen
                ? 'border-[var(--sb-accent-solid)] sb-text-primary sb-bg-surface'
                : 'sb-border sb-bg-surface sb-text-muted hover:sb-text-secondary hover:border-[var(--sb-border)]'
            "
            @click.stop="filterOpen = !filterOpen; sortOpen = false"
          >
            <SlidersHorizontal class="w-3.5 h-3.5" :stroke-width="1.5" />
            筛选
            <span v-if="hasActiveListFilter" class="w-1.5 h-1.5 rounded-full bg-[var(--sb-accent-solid)]" />
          </button>
          <div
            v-if="filterOpen"
            class="absolute right-0 top-full mt-1.5 w-64 rounded-lg border sb-border sb-bg-panel shadow-xl z-30 p-3 space-y-3"
          >
            <div class="flex items-center justify-between">
              <span class="text-[12px] font-medium sb-text-primary">筛选条件</span>
              <button
                v-if="hasActiveListFilter"
                type="button"
                class="text-[11px] sb-text-muted hover:sb-text-secondary flex items-center gap-0.5"
                @click="emit('resetListFilter')"
              >
                <X class="w-3 h-3" :stroke-width="1.5" />
                清除
              </button>
            </div>

            <div>
              <label class="text-[11px] sb-text-faint uppercase tracking-wider">运行状态</label>
              <div class="mt-1.5 flex flex-wrap gap-1">
                <button
                  v-for="opt in ([['all', '全部'], ['running', '运行中'], ['idle', '空闲'], ['error', '异常']] as const)"
                  :key="opt[0]"
                  type="button"
                  class="px-2 py-1 rounded-md text-[11px] border transition-colors"
                  :class="
                    listFilter.status === opt[0]
                      ? 'sb-bg-inset sb-text-primary border-[var(--sb-accent-solid)]'
                      : 'sb-border-subtle sb-text-muted hover:sb-text-secondary'
                  "
                  @click="patchFilter({ status: opt[0] })"
                >
                  {{ opt[1] }}
                </button>
              </div>
            </div>

            <div>
              <label class="text-[11px] sb-text-faint uppercase tracking-wider">分类</label>
              <select
                class="mt-1.5 w-full h-8 px-2 rounded-lg sb-bg-input border sb-border text-[12px] outline-none focus:sb-input"
                :value="listFilter.categoryKey ?? ''"
                @change="patchFilter({ categoryKey: ($event.target as HTMLSelectElement).value || null })"
              >
                <option value="">全部分类</option>
                <option
                  v-for="cat in indentedFilterCategories"
                  :key="cat.key"
                  :value="cat.key"
                >
                  {{ cat.label }}
                </option>
              </select>
            </div>

            <div class="space-y-2">
              <label class="flex items-center gap-2 text-[12px] sb-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  class="rounded border sb-border"
                  :checked="listFilter.starredOnly"
                  @change="patchFilter({ starredOnly: ($event.target as HTMLInputElement).checked })"
                />
                仅收藏
              </label>
              <label class="flex items-center gap-2 text-[12px] sb-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  class="rounded border sb-border"
                  :checked="listFilter.scheduledOnly"
                  @change="patchFilter({ scheduledOnly: ($event.target as HTMLInputElement).checked })"
                />
                仅定时任务
              </label>
            </div>
          </div>
        </div>

        <div ref="sortWrapRef" class="relative">
          <button
            type="button"
            class="flex items-center gap-1.5 h-8 px-3 rounded-lg border sb-border sb-bg-surface text-[13px] sb-text-muted hover:sb-text-secondary hover:border-[var(--sb-border)] transition-all"
            @click.stop="sortOpen = !sortOpen; filterOpen = false"
          >
            <ArrowUpDown class="w-3.5 h-3.5" :stroke-width="1.5" />
            {{ sortLabels[sortBy] }}
            <component :is="sortOrder === 'asc' ? ArrowUp : ArrowDown" class="w-3 h-3 sb-text-faint" :stroke-width="1.5" />
          </button>
          <div
            v-if="sortOpen"
            class="absolute right-0 top-full mt-1.5 w-40 rounded-lg border sb-border sb-bg-panel shadow-xl z-30 py-1"
          >
            <button
              v-for="(label, key) in sortLabels"
              :key="key"
              type="button"
              class="w-full flex items-center justify-between px-3 py-2 text-[12px] sb-text-secondary hover:sb-bg-inset transition-colors"
              @click="selectSort(key as ScriptSortBy)"
            >
              {{ label }}
              <Check v-if="sortBy === key" class="w-3.5 h-3.5 sb-text-primary" :stroke-width="2" />
            </button>
            <div class="my-1 border-t sb-border-subtle" />
            <button
              v-for="(label, key) in sortOrderLabels"
              :key="`order-${key}`"
              type="button"
              class="w-full flex items-center justify-between px-3 py-2 text-[12px] sb-text-secondary hover:sb-bg-inset transition-colors"
              @click="selectSortOrder(key as ScriptSortOrder)"
            >
              <span class="inline-flex items-center gap-1.5">
                <ArrowUp v-if="key === 'asc'" class="w-3 h-3" :stroke-width="1.5" />
                <ArrowDown v-else class="w-3 h-3" :stroke-width="1.5" />
                {{ label }}
              </span>
              <Check v-if="sortOrder === key" class="w-3.5 h-3.5 sb-text-primary" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-5 py-4 pb-4">
      <div v-if="!totalScripts" class="text-center sb-text-muted text-sm py-20">暂无脚本</div>
      <div v-else :class="scriptGridClass">
        <ScriptCard
          v-for="script in scripts"
          :key="script.id"
          class="min-w-0"
          :script="script"
          :selected="script.id === selectedId"
          :category-definitions="categoryDefinitions"
          @select="emit('select', script)"
          @start="emit('start', script.id)"
          @stop="script.activeSessionId && emit('stop', script.activeSessionId)"
          @restart="emit('restart', script.id)"
          @toggle-star="emit('toggleStar', script.id)"
          @edit="emit('edit', script)"
          @archive="emit('archive', script.id)"
          @delete="emit('delete', script.id)"
          @open-dir="emit('openDir', script)"
          @view-log="emit('viewLog', script)"
          @config="emit('config', script)"
          @category-changed="emit('categoryChanged')"
        />
        <div
          role="button"
          tabindex="0"
          class="script-card-add min-w-0 rounded-xl border border-dashed sb-border bg-transparent hover:border-[var(--sb-text-faint)] hover:sb-bg-surface transition-all cursor-pointer flex flex-col items-center justify-center min-h-[160px] gap-2"
          @click="emit('import')"
          @keydown.enter="emit('import')"
          @keydown.space.prevent="emit('import')"
        >
          <div class="w-10 h-10 rounded-lg sb-bg-inset flex items-center justify-center">
            <Plus class="w-5 h-5 sb-text-muted" :stroke-width="1.5" />
          </div>
          <p class="text-[13px] sb-text-muted">拖拽脚本文件夹即可上传</p>
        </div>
      </div>
    </div>

    <div
      v-if="totalScripts > 0 && listTotalPages > 1"
      class="flex-shrink-0 flex items-center justify-between px-5 py-2 border-t sb-border-subtle"
    >
      <span class="text-[12px] sb-text-muted tabular-nums">
        共 {{ totalScripts }} 个，第 {{ listPage }} / {{ listTotalPages }} 页
      </span>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="flex items-center gap-0.5 h-7 px-2.5 rounded-md text-[12px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-40"
          :disabled="listPage <= 1"
          @click="emit('update:listPage', listPage - 1)"
        >
          <ChevronLeft class="w-3.5 h-3.5" :stroke-width="1.5" />
          上一页
        </button>
        <button
          type="button"
          class="flex items-center gap-0.5 h-7 px-2.5 rounded-md text-[12px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-40"
          :disabled="listPage >= listTotalPages"
          @click="emit('update:listPage', listPage + 1)"
        >
          下一页
          <ChevronRight class="w-3.5 h-3.5" :stroke-width="1.5" />
        </button>
      </div>
    </div>
  </main>
</template>
