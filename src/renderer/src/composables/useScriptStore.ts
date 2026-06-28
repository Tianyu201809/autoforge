import { computed, onMounted, ref } from 'vue'
import { matchPinyinQuery } from '../utils/pinyin-match'
import type {
  CategoryDefinition,
  CategoryItem,
  NavFilter,
  ScriptItem,
  ScriptListFilter,
  ScriptSortBy,
  ScriptStats
} from '../../../shared/types/script'

const navItemsBase = [
  { id: 'all' as NavFilter, label: '全部', icon: 'layout-grid' as const },
  { id: 'running' as NavFilter, label: '运行中', icon: 'play-circle' as const },
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
const sortBy = ref<ScriptSortBy>('name')
const showSettings = ref(false)
const showDevGuide = ref(false)
const showExecutionHistory = ref(false)
const showCategoryManager = ref(false)

async function refresh(): Promise<void> {
  if (!window.autoforge) return
  loading.value = true
  try {
    const [data, defs] = await Promise.all([
      window.autoforge.scripts.list(),
      window.autoforge.categories.list()
    ])
    scripts.value = data.scripts
    stats.value = data.stats
    categories.value = data.categories
    categoryDefinitions.value = defs
  } finally {
    loading.value = false
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
    list = list.filter((s) => s.category === catKey)
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
    list = [...list].sort((a, b) => {
      if (sortBy.value === 'recentRun') {
        return (b.recentRunAt ?? '').localeCompare(a.recentRunAt ?? '')
      }
      return a.name.localeCompare(b.name, 'zh-CN')
    })
  }

  return list
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
      !showSettings.value &&
      !showDevGuide.value &&
      !showExecutionHistory.value,
    count: item.id === 'all' ? stats.value.total : item.id === 'starred' ? scripts.value.filter((s) => s.starred).length : undefined,
    badge: item.id === 'running' ? String(stats.value.running) : undefined
  }))
)

const breadcrumb = computed(() => {
  if (showExecutionHistory.value) return '执行历史'
  if (showDevGuide.value) return '开发指南'
  if (showSettings.value) return '设置'
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

async function deleteScript(id: string): Promise<void> {
  await window.autoforge.scripts.delete(id)
  await refresh()
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
