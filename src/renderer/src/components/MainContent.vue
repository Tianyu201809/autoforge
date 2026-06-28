<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import {
  Activity,
  ArrowUpDown,
  Check,
  FileCode2,
  LayoutGrid,
  List,
  Plus,
  SlidersHorizontal,
  Timer,
  X,
  Zap
} from 'lucide-vue-next'
import type { CategoryDefinition, ScriptItem, ScriptListFilter, ScriptSortBy, ScriptStats } from '../../../shared/types/script'
import ScriptCard from './ScriptCard.vue'
import { useToast } from '../composables/useToast'

const props = defineProps<{
  scripts: ScriptItem[]
  stats: ScriptStats
  selectedId?: string
  title?: string
  listFilter: ScriptListFilter
  hasActiveListFilter: boolean
  categoryDefinitions: CategoryDefinition[]
  sortBy: ScriptSortBy
}>()

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
  openHistory: []
}>()

const viewMode = ref<'grid' | 'list'>(localStorage.getItem('viewMode') === 'list' ? 'list' : 'grid')
const filterOpen = ref(false)
const sortOpen = ref(false)
const filterWrapRef = ref<HTMLElement | null>(null)
const sortWrapRef = ref<HTMLElement | null>(null)
const mainRef = ref<HTMLElement | null>(null)
const { pushToast } = useToast()

let unbindDropZone: (() => void) | undefined

function setViewMode(mode: 'grid' | 'list'): void {
  viewMode.value = mode
  localStorage.setItem('viewMode', mode)
}

const statCards = [
  { label: '脚本总数', key: 'total' as const, icon: FileCode2, iconClass: 'sb-text-muted', bgClass: 'sb-bg-inset', valueClass: 'sb-text-primary' },
  { label: '运行中', key: 'running' as const, icon: Activity, iconClass: 'text-emerald-400', bgClass: 'bg-emerald-500/10', valueClass: 'text-emerald-400' },
  { label: '定时任务', key: 'scheduled' as const, icon: Timer, iconClass: 'text-blue-400', bgClass: 'bg-blue-500/10', valueClass: 'sb-text-primary' },
  { label: '今日执行', key: 'todayRuns' as const, icon: Zap, iconClass: 'text-amber-400', bgClass: 'bg-amber-500/10', valueClass: 'sb-text-primary' }
]

const sortLabels: Record<ScriptSortBy, string> = {
  name: '名称',
  recentRun: '最近运行'
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
  <main ref="mainRef" class="@container flex-1 flex flex-col min-w-0 min-h-0 sb-bg-base">
    <div class="flex flex-col gap-3 px-5 py-3 border-b sb-border-subtle @lg:flex-row @lg:items-center @lg:justify-between">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold sb-text-primary tracking-tight truncate">{{ title ?? '全部脚本' }}</h1>
        <p class="text-[13px] sb-text-muted mt-0.5">管理本机自动化脚本，常驻运行与调度</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap shrink-0">
        <div class="flex items-center sb-bg-surface border sb-border rounded-lg p-0.5">
          <button
            type="button"
            class="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            :class="viewMode === 'grid' ? 'sb-bg-inset sb-text-primary' : 'sb-text-muted hover:sb-text-secondary'"
            @click="setViewMode('grid')"
          >
            <LayoutGrid class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
          <button
            type="button"
            class="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            :class="viewMode === 'list' ? 'sb-bg-inset sb-text-primary' : 'sb-text-muted hover:sb-text-secondary'"
            @click="setViewMode('list')"
          >
            <List class="w-3.5 h-3.5" :stroke-width="1.5" />
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
                <option v-for="cat in categoryDefinitions" :key="cat.key" :value="cat.key">{{ cat.label }}</option>
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
          </button>
          <div
            v-if="sortOpen"
            class="absolute right-0 top-full mt-1.5 w-36 rounded-lg border sb-border sb-bg-panel shadow-xl z-30 py-1"
          >
            <button
              v-for="(label, key) in sortLabels"
              :key="key"
              type="button"
              class="w-full flex items-center justify-between px-3 py-2 text-[12px] sb-text-secondary hover:sb-bg-inset transition-colors"
              @click="emit('update:sortBy', key as ScriptSortBy); sortOpen = false"
            >
              {{ label }}
              <Check v-if="sortBy === key" class="w-3.5 h-3.5 sb-text-primary" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 @sm:grid-cols-2 @2xl:grid-cols-4 gap-3 px-5 py-4 border-b sb-border">
      <template v-for="stat in statCards" :key="stat.label">
        <button
          v-if="stat.key === 'todayRuns'"
          type="button"
          class="flex items-center gap-3 px-3.5 py-2.5 rounded-lg border sb-border sb-bg-surface text-left transition-colors hover:border-[var(--sb-accent-solid)] cursor-pointer"
          @click="emit('openHistory')"
        >
          <div class="w-8 h-8 rounded-lg flex items-center justify-center" :class="stat.bgClass">
            <component :is="stat.icon" class="w-4 h-4" :class="stat.iconClass" :stroke-width="1.5" />
          </div>
          <div>
            <p class="text-[11px] sb-text-muted">{{ stat.label }}</p>
            <p class="text-lg font-medium tracking-tight" :class="stat.valueClass">{{ stats[stat.key] }}</p>
          </div>
        </button>
        <div
          v-else
          class="flex items-center gap-3 px-3.5 py-2.5 rounded-lg border sb-border sb-bg-surface"
        >
          <div class="w-8 h-8 rounded-lg flex items-center justify-center" :class="stat.bgClass">
            <component :is="stat.icon" class="w-4 h-4" :class="stat.iconClass" :stroke-width="1.5" />
          </div>
          <div>
            <p class="text-[11px] sb-text-muted">{{ stat.label }}</p>
            <p class="text-lg font-medium tracking-tight" :class="stat.valueClass">{{ stats[stat.key] }}</p>
          </div>
        </div>
      </template>
    </div>

    <div class="flex-1 overflow-y-auto px-5 py-4 pb-8">
      <div v-if="!scripts.length" class="text-center sb-text-muted text-sm py-20">暂无脚本</div>
      <div v-else class="gap-3" :class="viewMode === 'grid' ? 'grid grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3' : 'flex flex-col'">
        <ScriptCard
          v-for="script in scripts"
          :key="script.id"
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
          class="rounded-xl border border-dashed sb-border bg-transparent hover:border-[var(--sb-text-faint)] hover:sb-bg-surface transition-all cursor-pointer flex flex-col items-center justify-center min-h-[160px] gap-2"
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
  </main>
</template>
