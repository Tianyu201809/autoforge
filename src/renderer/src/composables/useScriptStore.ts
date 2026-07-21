import { computed, onMounted, ref, watch } from 'vue'
import { matchPinyinQuery } from '../utils/pinyin-match'
import { useToast } from './useToast'
import { collectDescendantKeys } from '../../../shared/category-tree'
import type {
  CategoryDefinition,
  CategoryItem,
  NavFilter,
  ScriptItem,
  ScriptListFilter,
  ScriptSortBy,
  ScriptSortOrder,
  ScriptStats
} from '../../../shared/types/script'

const SORT_BY_STORAGE_KEY = 'scriptSortBy'
const SORT_ORDER_STORAGE_KEY = 'scriptSortOrder'
const LIST_PAGE_SIZE = 12

function readStoredSortBy(): ScriptSortBy {
  const stored = localStorage.getItem(SORT_BY_STORAGE_KEY)
  if (stored === 'name' || stored === 'recentRun' || stored === 'importedAt') return stored
  return 'importedAt'
}

function readStoredSortOrder(): ScriptSortOrder {
  const stored = localStorage.getItem(SORT_ORDER_STORAGE_KEY)
  if (stored === 'asc' || stored === 'desc') return stored
  return 'desc'
}

const navItemsBase = [
  { id: 'all' as NavFilter, label: '全部', icon: 'layout-grid' as const },
  { id: 'running' as NavFilter, label: '运行中', icon: 'play-circle' as const },
  { id: 'scheduled' as NavFilter, label: '定时任务', icon: 'timer' as const },
  { id: 'starred' as NavFilter, label: '收藏', icon: 'star' as const },
  { id: 'recent' as NavFilter, label: '最近运行', icon: 'clock' as const },
  { id: 'archived' as NavFilter, label: '已归档', icon: 'archive' as const }
]

const scripts = ref<ScriptItem[]>([])
const stats = ref<ScriptStats>({ total: 0, running: 0, scheduled: 0, todayRuns: 0 })
const categories = ref<CategoryItem[]>([])
const categoryDefinitions = ref<CategoryDefinition[]>([])
const loading = ref(false)
const navFilter = ref<NavFilter>('all')
const searchQuery = ref('')
const categoryFilter = ref<string | null>(null)
const listFilter = ref<ScriptListFilter>({
  status: 'all',
  categoryKey: null,
  starredOnly: false,
  scheduledOnly: false
})
const sortBy = ref<ScriptSortBy>(readStoredSortBy())
const sortOrder = ref<ScriptSortOrder>(readStoredSortOrder())
const listPage = ref(1)
const showSettings = ref(false)
const showDevGuide = ref(false)
const showExecutionHistory = ref(false)
const showCategoryManager = ref(false)
const { pushToast } = useToast()
let refreshGeneration = 0

async function refresh(): Promise<void> {
  if (!window.autoforge) return
  const generation = ++refreshGeneration
  loading.value = true
  try {
    const [data, defs] = await Promise.all([
      window.autoforge.scripts.list(),
      window.autoforge.categories.list()
    ])
    if (generation !== refreshGeneration) return
    scripts.value = data.scripts
    stats.value = data.stats
    categories.value = data.categories
    categoryDefinitions.value = defs
  } finally {
    if (generation === refreshGeneration) {
      loading.value = false
    }
  }
}

const activeCategoryKey = computed(
  () => categoryFilter.value ?? listFilter.value.categoryKey
)

const filteredScripts = computed(() => {
  let list = scripts.value

  switch (navFilter.value) {
    case 'running':
      list = list.filter((s) => s.status === 'running')
      break
    case 'scheduled':
      list = list.filter((s) => !s.archived && s.schedule?.enabled)
      break
    case 'starred':
      list = list.filter((s) => s.starred)
      break
    case 'recent':
      list = list.filter((s) => s.recentRunAt).sort((a, b) =>
        (b.recentRunAt ?? '').localeCompare(a.recentRunAt ?? '')
      )
      break
    case 'archived':
      list = list.filter((s) => s.archived)
      break
    default:
      list = list.filter((s) => !s.archived)
  }

  const catKey = activeCategoryKey.value
  if (catKey) {
    const keys = new Set(collectDescendantKeys(categoryDefinitions.value, catKey))
    if (keys.size === 0) {
      list = list.filter((s) => s.category === catKey)
    } else {
      list = list.filter((s) => keys.has(s.category))
    }
  }

  const lf = listFilter.value
  if (lf.status !== 'all') {
    list = list.filter((s) => s.status === lf.status)
  }
  if (lf.starredOnly) {
    list = list.filter((s) => s.starred)
  }
  if (lf.scheduledOnly) {
    list = list.filter((s) => s.schedule?.enabled)
  }

  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (s) =>
        matchPinyinQuery(s.name, q) ||
        matchPinyinQuery(s.description, q) ||
        matchPinyinQuery(s.categoryLabel, q)
    )
  }

  if (navFilter.value !== 'recent') {
    const dir = sortOrder.value === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      if (sortBy.value === 'recentRun') {
        return dir * (a.recentRunAt ?? '').localeCompare(b.recentRunAt ?? '')
      }
      if (sortBy.value === 'importedAt') {
        return dir * (a.importedAt ?? '').localeCompare(b.importedAt ?? '')
      }
      return dir * a.name.localeCompare(b.name, 'zh-CN')
    })
  }

  return list
})

const listTotalPages = computed(() => Math.max(1, Math.ceil(filteredScripts.value.length / LIST_PAGE_SIZE)))

const pagedScripts = computed(() => {
  const start = (listPage.value - 1) * LIST_PAGE_SIZE
  return filteredScripts.value.slice(start, start + LIST_PAGE_SIZE)
})

watch([navFilter, searchQuery, listFilter, sortBy, sortOrder, categoryFilter], () => {
  listPage.value = 1
})

watch(listTotalPages, (max) => {
  if (listPage.value > max) listPage.value = max
})

const hasActiveListFilter = computed(() => {
  const lf = listFilter.value
  return lf.status !== 'all' || lf.starredOnly || lf.scheduledOnly || lf.categoryKey !== null
})

const navItems = computed(() =>
  navItemsBase.map((item) => ({
    ...item,
    active:
      navFilter.value === item.id &&
      !(activeCategoryKey.value && item.id === 'all'),
    count:
      item.id === 'all'
        ? stats.value.total
        : item.id === 'starred'
          ? scripts.value.filter((s) => s.starred).length
          : item.id === 'scheduled'
            ? stats.value.scheduled
            : undefined,
    badge: item.id === 'running' ? String(stats.value.running) : undefined
  }))
)

const breadcrumb = computed(() => {
  const current = navItemsBase.find((n) => n.id === navFilter.value)
  return current?.label ?? '全部'
})

async function importScript(): Promise<void> {
  if (!window.autoforge) return
  const sourcePath = await window.autoforge.scripts.openFileDialog()
  if (!sourcePath) return
  await window.autoforge.scripts.import(sourcePath)
  await refresh()
}

async function importFromPath(sourcePath: string): Promise<void> {
  await window.autoforge.scripts.import(sourcePath)
  await refresh()
}

async function toggleStar(id: string): Promise<void> {
  await window.autoforge.scripts.toggleStar(id)
  await refresh()
}

async function toggleArchive(id: string): Promise<void> {
  await window.autoforge.scripts.toggleArchive(id)
  await refresh()
}

async function deleteScript(id: string): Promise<boolean> {
  const scriptId = id?.trim()
  if (!scriptId) return false

  const ok = await window.autoforge.scripts.delete(scriptId)
  if (!ok) {
    pushToast({
      type: 'error',
      title: '删除失败',
      message: '未能删除该脚本，请确认脚本仍存在后重试'
    })
    return false
  }
  await refresh()
  return true
}

function setNavFilter(filter: NavFilter): void {
  showSettings.value = false
  showDevGuide.value = false
  showExecutionHistory.value = false
  navFilter.value = filter
  categoryFilter.value = null
  listFilter.value = { ...listFilter.value, categoryKey: null }
}

function setCategoryFilter(key: string | null): void {
  const next = categoryFilter.value === key ? null : key
  categoryFilter.value = next
  listFilter.value = { ...listFilter.value, categoryKey: next }
}

function setListFilter(patch: Partial<ScriptListFilter>): void {
  listFilter.value = { ...listFilter.value, ...patch }
  if (patch.categoryKey !== undefined) {
    categoryFilter.value = patch.categoryKey
  }
}

function resetListFilter(): void {
  listFilter.value = {
    status: 'all',
    categoryKey: null,
    starredOnly: false,
    scheduledOnly: false
  }
  categoryFilter.value = null
}

function setSortBy(sort: ScriptSortBy): void {
  sortBy.value = sort
  localStorage.setItem(SORT_BY_STORAGE_KEY, sort)
}

function setSortOrder(order: ScriptSortOrder): void {
  sortOrder.value = order
  localStorage.setItem(SORT_ORDER_STORAGE_KEY, order)
}

function setListPage(page: number): void {
  listPage.value = Math.min(Math.max(1, page), listTotalPages.value)
}

function openCategoryManager(): void {
  showCategoryManager.value = true
}

function closeCategoryManager(): void {
  showCategoryManager.value = false
}

function openSettings(): void {
  showDevGuide.value = false
  showExecutionHistory.value = false
  showSettings.value = true
}

function openDevGuide(): void {
  showSettings.value = false
  showExecutionHistory.value = false
  showDevGuide.value = true
}

function openExecutionHistory(): void {
  showSettings.value = false
  showDevGuide.value = false
  showExecutionHistory.value = true
}

function closeExecutionHistory(): void {
  showExecutionHistory.value = false
}

function closeDevGuide(): void {
  showDevGuide.value = false
}

function closeSettings(): void {
  showSettings.value = false
}

export function useScriptStore() {
  onMounted(() => {
    void refresh()
  })

  return {
    scripts,
    filteredScripts,
    pagedScripts,
    listPage,
    listTotalPages,
    listPageSize: LIST_PAGE_SIZE,
    stats,
    categories,
    categoryDefinitions,
    navItems,
    navFilter,
    searchQuery,
    categoryFilter,
    activeCategoryKey,
    listFilter,
    hasActiveListFilter,
    sortBy,
    sortOrder,
    breadcrumb,
    loading,
    showSettings,
    showDevGuide,
    showExecutionHistory,
    showCategoryManager,
    refresh,
    importScript,
    importFromPath,
    toggleStar,
    toggleArchive,
    deleteScript,
    setNavFilter,
    setCategoryFilter,
    setListFilter,
    resetListFilter,
    setSortBy,
    setSortOrder,
    setListPage,
    openCategoryManager,
    closeCategoryManager,
    openSettings,
    openDevGuide,
    openExecutionHistory,
    closeDevGuide,
    closeSettings,
    closeExecutionHistory
  }
}
