<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  Boxes,
  Download,
  FileText,
  LogOut,
  PackageOpen,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Store,
  Users,
  X
} from 'lucide-vue-next'
import type { HubInstallProgress, HubPlugin, HubScope, HubTeam, HubSession } from '../../../shared/hub-types'
import { askConfirm } from '../composables/useConfirmDialog'
import { useToast } from '../composables/useToast'
import { renderScriptReadmeMarkdown } from '../lib/script-readme-markdown'
import { hubPluginCatalogCache as catalogCache, type CatalogFilterState, type CatalogSnapshot } from '../lib/hub-plugin-catalog-cache'
import appIcon from '@build/icon.png?url'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { pushToast } = useToast()

const session = ref<HubSession>({ authenticated: false, persistent: false, user: null })
const scope = ref<HubScope>('marketplace')
const teams = ref<HubTeam[]>([])
const teamId = ref('')
const items = ref<HubPlugin[]>([])
const loading = ref(false)
const authorizing = ref(false)
const MAX_CONCURRENT_INSTALLS = 5
const installProgress = ref(new Map<string, HubInstallProgress>())
const error = ref('')
const selected = ref<HubPlugin | null>(null)
const view = ref<'catalog' | 'settings'>('catalog')
const searchQuery = ref('')
const selectedCategory = ref('')
const categoryCounts = ref<Record<string, number>>({})
let searchTimer: ReturnType<typeof setTimeout> | undefined

const availableCategories = computed(() =>
  Object.entries(categoryCounts.value)
    .filter(([category]) => category.trim())
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
)

const scopeMeta = computed(() => {
  if (scope.value === 'personal') {
    return { title: '我的脚本', subtitle: '仅供你使用的自动化能力', icon: PackageOpen }
  }
  if (scope.value === 'team') {
    return { title: '团队脚本', subtitle: '从协作工作区获取共享工具', icon: Users }
  }
  return { title: '脚本市场', subtitle: '探索可直接安装的自动化工具', icon: Store }
})

const selectedReadmeHtml = computed(() => {
  const source = selected.value?.readme?.trim() || selected.value?.description?.trim() || '暂无说明文档。'
  return renderScriptReadmeMarkdown(source)
})

function initials(name?: string): string {
  return (name || 'AF').trim().slice(0, 2).toUpperCase()
}

function formatDate(value?: string): string {
  if (!value) return '近期更新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '近期更新'
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

function formatBytes(value?: number): string {
  if (value == null || value < 0) return ''
  if (value < 1024 * 1024) return `${Math.max(1, Math.ceil(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

function progressFor(plugin: HubPlugin): HubInstallProgress | null {
  return installProgress.value.get(plugin.id) ?? null
}

function setInstallProgress(progress: HubInstallProgress): void {
  installProgress.value = new Map(installProgress.value).set(progress.hubScriptId, progress)
}

function clearInstallProgress(id: string): void {
  const next = new Map(installProgress.value)
  next.delete(id)
  installProgress.value = next
}

function isInstalling(id: string): boolean {
  const progress = installProgress.value.get(id)
  return Boolean(progress && progress.phase !== 'error' && progress.phase !== 'complete')
}

const activeInstallCount = computed(() => {
  let count = 0
  for (const progress of installProgress.value.values()) {
    if (progress.phase !== 'error' && progress.phase !== 'complete') count += 1
  }
  return count
})

function progressLabel(progress: HubInstallProgress): string {
  if (progress.phase === 'error') return progress.error || '安装失败，请重试'
  if (progress.phase !== 'downloading') return progress.message
  const received = formatBytes(progress.downloadedBytes)
  const total = formatBytes(progress.totalBytes)
  if (received && total) return `${progress.message} ${progress.percent ?? 0}% · ${received} / ${total}`
  return received ? `${progress.message} · 已下载 ${received}` : progress.message
}

function catalogFilterKey(): string {
  return JSON.stringify({ q: searchQuery.value.trim(), category: selectedCategory.value })
}

function catalogCacheBucket(scopeKey = scope.value): Map<string, CatalogSnapshot> {
  if (scopeKey !== 'team') return catalogCache[scopeKey]
  const currentTeamId = teamId.value || '__default__'
  let bucket = catalogCache.team.get(currentTeamId)
  if (!bucket) {
    bucket = new Map<string, CatalogSnapshot>()
    catalogCache.team.set(currentTeamId, bucket)
  }
  return bucket
}

function catalogFilterState(scopeKey = scope.value): CatalogFilterState {
  if (scopeKey !== 'team') return catalogCache.filters[scopeKey]
  const currentTeamId = teamId.value || '__default__'
  let state = catalogCache.filters.team.get(currentTeamId)
  if (!state) {
    state = { q: '', category: '' }
    catalogCache.filters.team.set(currentTeamId, state)
  }
  return state
}

function saveCatalogFilterState(): void {
  const state = catalogFilterState()
  state.q = searchQuery.value.trim()
  state.category = selectedCategory.value
}

function restoreCatalogFilterState(scopeKey: HubScope): void {
  const state = catalogFilterState(scopeKey)
  searchQuery.value = state.q
  selectedCategory.value = state.category
}

function restoreCatalogCache(): boolean {
  const cached = catalogCacheBucket().get(catalogFilterKey())
  if (!cached) return false
  items.value = cached.items
  categoryCounts.value = cached.categoryCounts
  return true
}

async function load(force = false): Promise<void> {
  if (!force && session.value.authenticated && view.value === 'catalog' && restoreCatalogCache()) {
    error.value = ''
    return
  }
  loading.value = true
  error.value = ''
  try {
    session.value = await window.autoforge.hub.session()
    if (!session.value.authenticated) {
      items.value = []
      selected.value = null
      categoryCounts.value = {}
      catalogCache.marketplace.clear()
      catalogCache.personal.clear()
      catalogCache.team.clear()
      catalogCache.teams = null
      catalogCache.filters.marketplace = { q: '', category: '' }
      catalogCache.filters.personal = { q: '', category: '' }
      catalogCache.filters.team.clear()
      return
    }
    if (view.value === 'settings') return
    if (scope.value === 'team') {
      if (!teams.value.length || force) {
        if (!force && catalogCache.teams) {
          teams.value = catalogCache.teams
        } else {
          teams.value = await window.autoforge.hub.listTeams()
          catalogCache.teams = teams.value
        }
      }
      if (!teamId.value) {
        teamId.value = teams.value[0]?.id ?? ''
        restoreCatalogFilterState('team')
      }
    }
    // The component can be mounted again with a fresh local session ref. Once
    // the session is restored, check the module-level catalog cache before any
    // network request so reopening the hub remains instant.
    if (!force && restoreCatalogCache()) {
      error.value = ''
      return
    }
    const result = await window.autoforge.hub.listPlugins({
      scope: scope.value,
      teamId: scope.value === 'team' ? teamId.value : undefined,
      page: 1,
      pageSize: 30,
      q: searchQuery.value.trim() || undefined,
      category: selectedCategory.value || undefined,
      sort: 'newest'
    })
    items.value = [...result.items].sort((left, right) => {
      const leftDate = left.publishedAt ?? left.createdAt ?? ''
      const rightDate = right.publishedAt ?? right.createdAt ?? ''
      const dateDelta = (Date.parse(rightDate) || 0) - (Date.parse(leftDate) || 0)
      return dateDelta || left.title.localeCompare(right.title, 'zh-CN')
    })
    categoryCounts.value = result.distributions.category
    catalogCacheBucket().set(catalogFilterKey(), { items: items.value, categoryCounts: categoryCounts.value })
    if (selected.value && !items.value.some((item) => item.id === selected.value?.id)) {
      selected.value = null
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '无法连接 AutoforgeHub'
  } finally {
    loading.value = false
  }
}

async function switchScope(nextScope: HubScope): Promise<void> {
  view.value = 'catalog'
  if (scope.value === nextScope && items.value.length) return
  saveCatalogFilterState()
  scope.value = nextScope
  restoreCatalogFilterState(nextScope)
  selected.value = null
  await load()
}

function switchTeam(nextTeamId: string): void {
  if (nextTeamId === teamId.value) return
  saveCatalogFilterState()
  teamId.value = nextTeamId
  restoreCatalogFilterState('team')
  selected.value = null
  void load()
}

function openSettings(): void {
  view.value = 'settings'
  selected.value = null
  error.value = ''
}

function setCategory(category: string): void {
  selectedCategory.value = category
  saveCatalogFilterState()
  selected.value = null
  void load(true)
}

function scheduleSearch(): void {
  if (searchTimer) window.clearTimeout(searchTimer)
  saveCatalogFilterState()
  searchTimer = window.setTimeout(() => {
    selected.value = null
    void load()
  }, 260)
}

function clearSearch(): void {
  if (!searchQuery.value) return
  searchQuery.value = ''
  scheduleSearch()
}

async function beginAuthorization(): Promise<void> {
  authorizing.value = true
  error.value = ''
  try {
    await window.autoforge.hub.beginAuthorization()
  } catch (err) {
    authorizing.value = false
    error.value = err instanceof Error ? err.message : '无法打开浏览器授权'
  }
}

async function cancelAuthorization(): Promise<void> {
  await window.autoforge.hub.cancelAuthorization()
  authorizing.value = false
}

async function logout(): Promise<void> {
  const confirmed = await askConfirm({
    title: '退出 AutoforgeHub',
    message: '退出后将无法访问脚本市场、个人空间和团队脚本，已安装到本地的脚本不会受影响。',
    confirmLabel: '退出登录'
  })
  if (!confirmed) return

  await window.autoforge.hub.logout()
  session.value = { authenticated: false, persistent: false, user: null }
  items.value = []
  selected.value = null
  catalogCache.marketplace.clear()
  catalogCache.personal.clear()
  catalogCache.team.clear()
  catalogCache.teams = null
  catalogCache.filters.marketplace = { q: '', category: '' }
  catalogCache.filters.personal = { q: '', category: '' }
  catalogCache.filters.team.clear()
}

async function install(plugin: HubPlugin): Promise<void> {
  if (isInstalling(plugin.id) || activeInstallCount.value >= MAX_CONCURRENT_INSTALLS) return
  setInstallProgress({
    hubScriptId: plugin.id,
    phase: 'preparing',
    message: '正在准备安装'
  })
  try {
    const result = await window.autoforge.hub.installPlugin(plugin.id)
    clearInstallProgress(plugin.id)
    if (result.status !== 'duplicate_cancelled') {
      pushToast({
        type: 'success',
        title: result.status === 'updated' ? '脚本已更新' : '脚本已安装',
        message: result.name
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '请稍后重试'
    const progress = installProgress.value.get(plugin.id)
    if (progress && progress.phase !== 'error') {
      setInstallProgress({
        hubScriptId: plugin.id,
        phase: 'error',
        message: '安装失败',
        error: message
      })
    }
    pushToast({
      type: 'error',
      title: '安装失败',
      message
    })
  }
}

const offInstallProgress = window.autoforge.hub.onInstallProgress((progress) => {
  if (installProgress.value.has(progress.hubScriptId)) setInstallProgress(progress)
})

const offAuthorized = window.autoforge.hub.onHubAuthorized((next) => {
  session.value = next
  authorizing.value = false
  void load(true)
})

restoreCatalogFilterState(scope.value)

watch(
  () => props.open,
  (open) => {
    if (open) void load()
  },
  { immediate: true }
)

onUnmounted(() => {
  offAuthorized()
  offInstallProgress()
  if (searchTimer) window.clearTimeout(searchTimer)
})
</script>

<template>
  <div v-if="open" class="hub-shell">
    <header class="hub-topbar">
      <button class="hub-back-button" aria-label="返回 Autoforge" title="返回" @click="emit('close')">
        <ArrowLeft :size="17" />
      </button>
      <div class="hub-brand">
        <img :src="appIcon" alt="Autoforge" class="hub-mark" draggable="false" />
        <span class="hub-brand__title">脚本中心</span>
        <span class="hub-brand__source">AutoforgeHub</span>
      </div>
      <button class="hub-icon-button" aria-label="关闭脚本中心" title="关闭" @click="emit('close')">
        <X :size="18" />
      </button>
    </header>

    <section v-if="!session.authenticated" class="hub-auth-view">
      <div class="hub-auth-card">
        <div class="hub-auth-card__icon"><Boxes :size="25" /></div>
        <p class="hub-kicker">AUTOFORGEHUB CONNECTION</p>
        <h1>连接你的脚本工作区</h1>
        <p class="hub-auth-card__copy">
          在浏览器中确认授权后，可直接访问脚本市场、个人空间和团队共享工具。
        </p>
        <button v-if="!authorizing" class="hub-primary-button" @click="beginAuthorization">
          连接 AutoforgeHub
        </button>
        <div v-else class="hub-authorizing" role="status">
          <RefreshCw :size="16" class="hub-spin" />
          <span>正在等待浏览器授权</span>
          <button type="button" @click="cancelAuthorization">取消</button>
        </div>
        <p v-if="error" class="hub-error">{{ error }}</p>
      </div>
    </section>

    <main v-else class="hub-workbench" :class="{ 'has-detail': view === 'catalog' && selected }">
      <aside class="hub-sidebar">
        <div class="hub-profile">
          <div class="hub-avatar">{{ initials(session.user?.displayName) }}</div>
          <div class="hub-profile__text">
            <b>{{ session.user?.displayName }}</b>
            <span>{{ session.user?.email }}</span>
          </div>
        </div>

        <nav class="hub-navigation" aria-label="脚本来源">
          <button :class="{ active: view === 'catalog' && scope === 'marketplace' }" @click="switchScope('marketplace')">
            <Store :size="16" />
            <span>脚本市场</span>
          </button>
          <button :class="{ active: view === 'catalog' && scope === 'personal' }" @click="switchScope('personal')">
            <PackageOpen :size="16" />
            <span>我的脚本</span>
          </button>
          <button :class="{ active: view === 'catalog' && scope === 'team' }" @click="switchScope('team')">
            <Users :size="16" />
            <span>团队脚本</span>
            <em v-if="session.user?.teamCount">{{ session.user.teamCount }}</em>
          </button>
        </nav>

        <label v-if="view === 'catalog' && scope === 'team'" class="hub-team-picker">
          <span>当前团队</span>
            <select :value="teamId" @change="switchTeam(($event.target as HTMLSelectElement).value)">
            <option v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</option>
          </select>
        </label>

        <div class="hub-sidebar__footer">
          <button :class="{ active: view === 'settings' }" @click="openSettings">
            <Settings :size="16" />
            <span>设置</span>
          </button>
        </div>
      </aside>

      <section v-if="view === 'catalog'" class="hub-content">
        <div class="hub-heading">
          <div>
            <p class="hub-kicker">AUTOFORGEHUB / {{ scope.toUpperCase() }}</p>
            <div class="hub-heading__title">
              <component :is="scopeMeta.icon" :size="20" />
              <h1>{{ scopeMeta.title }}</h1>
            </div>
            <p>{{ scopeMeta.subtitle }}</p>
          </div>
          <div class="hub-heading__tools">
            <label class="hub-search" aria-label="搜索 Hub 脚本">
              <Search :size="15" />
              <input v-model="searchQuery" type="search" placeholder="搜索脚本" @input="scheduleSearch" />
              <button v-if="searchQuery" type="button" aria-label="清除搜索" title="清除搜索" @click="clearSearch">
                <X :size="13" />
              </button>
            </label>
            <label class="hub-category-filter">
              <SlidersHorizontal :size="14" />
              <select :value="selectedCategory" aria-label="按分类筛选" @change="setCategory(($event.target as HTMLSelectElement).value)">
                <option value="">全部分类</option>
                <option v-for="[category, count] in availableCategories" :key="category" :value="category">
                  {{ category }} ({{ count }})
                </option>
              </select>
            </label>
            <button class="hub-icon-button hub-refresh" title="刷新脚本列表" aria-label="刷新脚本列表" @click="load(true)">
              <RefreshCw :size="16" :class="{ 'hub-spin': loading }" />
            </button>
          </div>
        </div>

        <p v-if="error" class="hub-error">{{ error }}</p>
        <div v-else-if="loading" class="hub-loading-grid" aria-label="正在加载脚本">
          <div v-for="index in 6" :key="index" class="hub-skeleton-card" />
        </div>
        <div v-else-if="!items.length" class="hub-empty-state">
          <FileText :size="26" />
          <strong>这里还没有脚本</strong>
          <span>切换来源或前往 AutoforgeHub 发布第一个脚本。</span>
        </div>
        <div v-else class="hub-grid">
          <article
            v-for="plugin in items"
            :key="plugin.id"
            class="hub-card"
            :class="{ selected: selected?.id === plugin.id, installing: isInstalling(plugin.id), 'install-failed': progressFor(plugin)?.phase === 'error' }"
            tabindex="0"
            @click="selected = plugin"
            @keydown.enter="selected = plugin"
          >
            <div class="hub-card__header">
              <div class="hub-card__identity">
                <div class="hub-plugin-icon" :style="{ '--hub-icon-source': plugin.iconColor || 'var(--sb-accent-solid)' }">
                  {{ initials(plugin.icon || plugin.title) }}
                </div>
                <span class="hub-language">{{ plugin.language || 'AUTOMATION' }}</span>
              </div>
              <button
                class="hub-install-button"
                :disabled="isInstalling(plugin.id) || activeInstallCount >= MAX_CONCURRENT_INSTALLS"
                :aria-label="progressFor(plugin)?.phase === 'error' ? `重试安装 ${plugin.title}` : `安装 ${plugin.title}`"
                :title="progressFor(plugin)?.phase === 'error' ? `重试安装 ${plugin.title}` : `安装 ${plugin.title}`"
                @click.stop="install(plugin)"
              >
                <RefreshCw v-if="isInstalling(plugin.id)" :size="15" class="hub-spin" />
                <Download v-else :size="15" />
              </button>
            </div>
            <div class="hub-card__body">
              <h2>{{ plugin.title }}</h2>
              <p>{{ plugin.description || '暂无说明文档。' }}</p>
            </div>
            <div v-if="progressFor(plugin)" class="hub-install-progress" :class="{ error: progressFor(plugin)?.phase === 'error' }" role="status">
              <div v-if="progressFor(plugin)?.phase !== 'error'" class="hub-install-progress__track" aria-hidden="true">
                <span :class="{ indeterminate: progressFor(plugin)?.percent == null }" :style="progressFor(plugin)?.percent != null ? { width: `${progressFor(plugin)?.percent}%` } : undefined" />
              </div>
              <span>{{ progressLabel(progressFor(plugin)!) }}</span>
            </div>
            <footer class="hub-card__footer">
              <div class="hub-card__meta">
                <span class="hub-card__category">{{ plugin.category || '其他' }}</span>
                <span class="hub-card__owner">{{ plugin.ownerDisplayName || 'AutoforgeHub' }}</span>
                <span class="hub-card__installs">{{ plugin.installCount || 0 }} 次安装</span>
              </div>
              <time :datetime="plugin.publishedAt || plugin.createdAt || plugin.updatedAt">{{ formatDate(plugin.publishedAt || plugin.createdAt || plugin.updatedAt) }}</time>
            </footer>
          </article>
        </div>
      </section>

      <section v-else class="hub-content hub-settings-view">
        <div class="hub-heading hub-settings-heading">
          <div>
            <p class="hub-kicker">AUTOFORGEHUB / SETTINGS</p>
            <div class="hub-heading__title">
              <Settings :size="20" />
              <h1>设置</h1>
            </div>
            <p>管理你的 AutoforgeHub 连接与账户会话。</p>
          </div>
        </div>

        <section class="hub-account-settings" aria-labelledby="hub-account-settings-title">
          <div class="hub-account-settings__heading">
            <div class="hub-account-settings__icon"><Boxes :size="19" /></div>
            <div>
              <p class="hub-kicker">ACCOUNT</p>
              <h2 id="hub-account-settings-title">账户管理</h2>
            </div>
          </div>
          <div class="hub-account-settings__body">
            <div class="hub-account-settings__identity">
              <div class="hub-account-avatar">{{ initials(session.user?.displayName) }}</div>
              <div>
                <strong>{{ session.user?.displayName }}</strong>
                <span>{{ session.user?.email }}</span>
              </div>
            </div>
            <div class="hub-account-settings__status">
              <span>AutoforgeHub 已连接</span>
              <small>团队空间 {{ session.user?.teamCount || 0 }} 个</small>
            </div>
          </div>
          <footer class="hub-account-settings__footer">
            <p>退出不会移除已安装到本机的脚本。</p>
            <button class="hub-logout-button" @click="logout"><LogOut :size="15" />退出登录</button>
          </footer>
        </section>
      </section>

      <aside v-if="view === 'catalog' && selected" class="hub-detail" aria-label="脚本详情">
        <header class="hub-detail__header">
          <div>
            <p class="hub-kicker">脚本详情</p>
            <h2>{{ selected.title }}</h2>
          </div>
          <button class="hub-icon-button" aria-label="关闭详情" title="关闭详情" @click="selected = null">
            <X :size="17" />
          </button>
        </header>
        <div class="hub-detail__meta">
          <span>{{ selected.language || 'AUTOMATION' }}</span>
          <span>{{ selected.category || '其他' }}</span>
          <span>由 {{ selected.ownerDisplayName || 'AutoforgeHub' }} 发布</span>
        </div>
        <div class="hub-markdown" v-html="selectedReadmeHtml" />
        <footer class="hub-detail__footer">
          <button class="hub-primary-button" :disabled="isInstalling(selected.id) || activeInstallCount >= MAX_CONCURRENT_INSTALLS" @click="install(selected)">
            <RefreshCw v-if="isInstalling(selected.id)" :size="16" class="hub-spin" />
            <Download v-else :size="16" />
            {{ isInstalling(selected.id) ? progressFor(selected)?.message || '正在安装' : progressFor(selected)?.phase === 'error' ? '重试安装' : '安装到本地' }}
          </button>
        </footer>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.hub-shell {
  --hub-surface: color-mix(in srgb, var(--sb-bg-surface) 88%, var(--sb-bg-panel));
  --hub-surface-raised: color-mix(in srgb, var(--sb-bg-elevated) 68%, var(--sb-bg-surface));
  --hub-rule: color-mix(in srgb, var(--sb-border-subtle) 82%, transparent);
  --hub-accent-soft: color-mix(in srgb, var(--sb-accent-solid) 11%, var(--sb-bg-panel));
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--sb-bg-panel);
  color: var(--sb-text-primary);
}

.hub-topbar {
  height: 50px;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--hub-rule);
  background: color-mix(in srgb, var(--sb-bg-panel) 92%, var(--sb-bg-base));
}

.hub-brand,
.hub-heading__title,
.hub-profile,
.hub-navigation button,
.hub-primary-button,
.hub-authorizing,
.hub-detail__header,
.hub-detail__meta,
.hub-card__header,
.hub-card__footer,
.hub-card__meta {
  display: flex;
  align-items: center;
}

.hub-brand { gap: 8px; font-size: 12px; }
.hub-back-button { display: inline-grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; border: 1px solid transparent; border-radius: 5px; color: var(--sb-text-muted); transition: background .15s ease, border-color .15s ease, color .15s ease; }
.hub-back-button:hover { border-color: var(--hub-rule); background: var(--sb-bg-hover); color: var(--sb-text-primary); }
.hub-mark {
  display: block;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  object-fit: cover;
}
.hub-brand__title { font-weight: 700; }
.hub-brand__source { color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 10px; }

.hub-icon-button {
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--sb-text-muted);
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}
.hub-icon-button:hover { border-color: var(--hub-rule); background: var(--sb-bg-hover); color: var(--sb-text-primary); }

.hub-auth-view { display: grid; flex: 1; place-items: center; padding: 24px; }
.hub-auth-card {
  width: min(456px, 100%);
  padding: 32px;
  border: 1px solid var(--hub-rule);
  border-top: 2px solid color-mix(in srgb, var(--sb-accent-solid) 75%, var(--hub-rule));
  border-radius: 7px;
  background: var(--hub-surface);
  box-shadow: 0 24px 60px rgb(0 0 0 / 14%);
}
.hub-auth-card__icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 6px; background: var(--hub-accent-soft); color: var(--sb-accent-solid); }
.hub-kicker { margin: 0; color: var(--sb-accent-solid); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .08em; }
.hub-auth-card .hub-kicker { margin-top: 20px; }
.hub-auth-card h1 { margin: 7px 0 0; font-size: 23px; font-weight: 700; letter-spacing: 0; }
.hub-auth-card__copy { max-width: 365px; margin: 12px 0 0; color: var(--sb-text-muted); font-size: 13px; line-height: 1.75; }
.hub-primary-button {
  justify-content: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 5px;
  background: var(--sb-accent-solid);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  transition: filter .15s ease, transform .15s ease;
}
.hub-auth-card > .hub-primary-button { width: 100%; margin-top: 22px; }
.hub-primary-button:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
.hub-primary-button:disabled, .hub-install-button:disabled { cursor: not-allowed; opacity: .48; }
.hub-authorizing { min-height: 36px; gap: 9px; margin-top: 22px; padding: 0 10px; border: 1px solid var(--hub-rule); border-radius: 5px; color: var(--sb-text-secondary); font-size: 12px; }
.hub-authorizing button { margin-left: auto; color: var(--sb-text-muted); font-size: 11px; }
.hub-error { margin: 14px 0 0; color: var(--sb-status-error, #ef4444); font-size: 12px; line-height: 1.5; }
.hub-spin { animation: hub-spin .8s linear infinite; }

.hub-workbench { display: grid; grid-template-columns: 208px minmax(0, 1fr); flex: 1; min-height: 0; }
.hub-workbench.has-detail { grid-template-columns: 208px minmax(360px, 1fr) 360px; }
.hub-sidebar { display: flex; flex-direction: column; min-width: 0; padding: 14px 10px 12px; border-right: 1px solid var(--hub-rule); background: var(--hub-surface); }
.hub-profile { gap: 10px; min-width: 0; padding: 6px 7px 18px; border-bottom: 1px solid var(--hub-rule); }
.hub-avatar { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 5px; background: var(--hub-accent-soft); color: var(--sb-accent-solid); font-family: var(--font-mono); font-size: 10px; font-weight: 700; }
.hub-profile__text { min-width: 0; flex: 1; }
.hub-profile__text b, .hub-profile__text span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub-profile__text b { color: var(--sb-text-primary); font-size: 12px; }
.hub-profile__text span { margin-top: 3px; color: var(--sb-text-faint); font-size: 10px; }
.hub-navigation { display: grid; gap: 3px; margin-top: 15px; }
.hub-navigation button { min-height: 34px; gap: 9px; width: 100%; padding: 0 8px; border-radius: 4px; color: var(--sb-text-muted); font-size: 12px; text-align: left; transition: background .15s ease, color .15s ease; }
.hub-navigation button:hover { background: var(--sb-bg-hover); color: var(--sb-text-primary); }
.hub-navigation button.active { background: var(--hub-accent-soft); box-shadow: inset 2px 0 0 var(--sb-accent-solid); color: var(--sb-text-primary); font-weight: 700; }
.hub-navigation em { min-width: 17px; height: 17px; margin-left: auto; padding: 0 4px; border-radius: 9px; background: var(--sb-bg-inset); color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 9px; font-style: normal; line-height: 17px; text-align: center; }
.hub-team-picker { display: grid; gap: 6px; margin: 14px 7px 0; color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 9px; letter-spacing: .05em; }
.hub-team-picker select { width: 100%; height: 31px; padding: 0 8px; border: 1px solid var(--hub-rule); border-radius: 4px; background: var(--sb-bg-inset); color: var(--sb-text-secondary); font-size: 11px; }
.hub-sidebar__footer { margin-top: auto; padding: 12px 0 0; border-top: 1px solid var(--hub-rule); }
.hub-sidebar__footer button { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; padding: 0 8px; border-radius: 4px; color: var(--sb-text-muted); font-size: 12px; text-align: left; transition: background .15s ease, color .15s ease; }
.hub-sidebar__footer button:hover { background: var(--sb-bg-hover); color: var(--sb-text-primary); }
.hub-sidebar__footer button.active { background: var(--hub-accent-soft); box-shadow: inset 2px 0 0 var(--sb-accent-solid); color: var(--sb-text-primary); font-weight: 700; }

.hub-content { min-width: 0; overflow: auto; padding: 28px clamp(20px, 3vw, 42px) 42px; }
.hub-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 22px; border-bottom: 1px solid var(--hub-rule); }
.hub-heading__title { gap: 9px; margin-top: 7px; color: var(--sb-text-primary); }
.hub-heading h1 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: 0; }
.hub-heading > div > p:last-child { margin: 8px 0 0; color: var(--sb-text-muted); font-size: 12px; }
.hub-heading__tools { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.hub-search, .hub-category-filter { display: flex; align-items: center; height: 32px; border: 1px solid var(--hub-rule); border-radius: 5px; background: var(--hub-surface); color: var(--sb-text-faint); }
.hub-search { width: clamp(180px, 20vw, 256px); gap: 7px; padding-left: 9px; }
.hub-search:focus-within { border-color: color-mix(in srgb, var(--sb-accent-solid) 58%, var(--hub-rule)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sb-accent-solid) 11%, transparent); color: var(--sb-accent-solid); }
.hub-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--sb-text-primary); font-size: 11px; }
.hub-search input::placeholder { color: var(--sb-text-faint); }
.hub-search button { display: grid; width: 25px; height: 25px; place-items: center; color: var(--sb-text-faint); }
.hub-search button:hover { color: var(--sb-text-primary); }
.hub-category-filter { min-width: 130px; gap: 6px; padding-left: 9px; }
.hub-category-filter select { min-width: 0; width: 100%; height: 100%; padding: 0 22px 0 0; border: 0; outline: 0; background: transparent; color: var(--sb-text-secondary); font-size: 11px; }
.hub-refresh { margin-top: 2px; border-color: var(--hub-rule); }
.hub-grid, .hub-loading-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-top: 22px; }
.hub-card { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 236px; padding: 17px; border: 1px solid var(--hub-rule); border-radius: 7px; background: var(--hub-surface); cursor: pointer; outline: none; overflow: hidden; transition: border-color .18s ease, background .18s ease, box-shadow .18s ease, transform .18s ease; }
.hub-card::before { position: absolute; top: 0; right: 0; left: 0; height: 2px; background: color-mix(in srgb, var(--sb-accent-solid) 24%, transparent); content: ''; }
.hub-card:hover, .hub-card:focus-visible { border-color: color-mix(in srgb, var(--sb-accent-solid) 58%, var(--hub-rule)); background: var(--hub-surface-raised); box-shadow: 0 14px 30px rgb(0 0 0 / 12%); transform: translateY(-3px); }
.hub-card.selected { border-color: var(--sb-accent-solid); background: var(--hub-accent-soft); box-shadow: inset 3px 0 0 var(--sb-accent-solid), 0 8px 22px rgb(0 0 0 / 8%); }
.hub-card.selected::before { background: var(--sb-accent-solid); }
.hub-card__header { justify-content: space-between; gap: 10px; }
.hub-card__identity { display: flex; align-items: center; min-width: 0; gap: 9px; }
.hub-plugin-icon { position: relative; display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border: 1px solid var(--hub-rule); border-radius: 6px; background: var(--sb-bg-inset); color: var(--sb-text-primary); box-shadow: inset 0 1px 0 rgb(255 255 255 / 9%), 0 2px 8px rgb(0 0 0 / 8%); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .02em; }
.hub-plugin-icon::after { position: absolute; right: 6px; bottom: 5px; left: 6px; height: 2px; border-radius: 2px; background: color-mix(in srgb, var(--hub-icon-source) 54%, var(--sb-accent-solid)); content: ''; opacity: .75; }
.hub-language { max-width: 132px; overflow: hidden; color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: .05em; text-overflow: ellipsis; white-space: nowrap; }
.hub-card__body { min-width: 0; margin-top: 18px; }
.hub-card h2 { display: -webkit-box; overflow: hidden; margin: 0; color: var(--sb-text-primary); font-size: 13px; font-weight: 700; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.hub-card__body p { display: -webkit-box; overflow: hidden; margin: 8px 0 0; color: var(--sb-text-muted); font-size: 11px; line-height: 1.6; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.hub-card__footer { justify-content: space-between; gap: 10px; margin-top: auto; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--hub-rule) 82%, transparent); }
.hub-card__meta { display: flex; align-items: center; min-width: 0; gap: 7px; overflow: hidden; color: var(--sb-text-faint); font-size: 10px; white-space: nowrap; }
.hub-card__meta span { overflow: hidden; text-overflow: ellipsis; }
.hub-card__installs { flex: 0 0 auto; color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 9px; }
.hub-card__category { flex: 0 0 auto; padding: 3px 5px; border: 1px solid var(--hub-rule); border-radius: 3px; color: var(--sb-text-muted); font-family: var(--font-mono); font-size: 9px; }
.hub-card__owner::before { margin-right: 7px; color: var(--sb-text-faint); content: '·'; }
.hub-card__footer time { flex: 0 0 auto; color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 9px; }
.hub-install-button { display: inline-grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; border: 1px solid color-mix(in srgb, var(--sb-accent-solid) 36%, var(--hub-rule)); border-radius: 4px; background: color-mix(in srgb, var(--sb-accent-solid) 5%, var(--sb-bg-inset)); color: var(--sb-accent-solid); transition: background .15s ease, color .15s ease, border-color .15s ease; }
.hub-install-button:hover:not(:disabled) { border-color: var(--sb-accent-solid); background: var(--sb-accent-solid); color: #fff; }
.hub-card.installing { border-color: color-mix(in srgb, var(--sb-accent-solid) 60%, var(--hub-rule)); }
.hub-card.install-failed { border-color: color-mix(in srgb, var(--sb-status-error, #ef4444) 62%, var(--hub-rule)); }
.hub-install-progress { display: grid; gap: 6px; margin-top: 12px; color: var(--sb-accent-solid); font-family: var(--font-mono); font-size: 9px; line-height: 1.35; }
.hub-install-progress.error { color: var(--sb-status-error, #ef4444); }
.hub-install-progress__track { height: 4px; overflow: hidden; border-radius: 3px; background: color-mix(in srgb, var(--sb-bg-inset) 90%, #000); }
.hub-install-progress__track span { display: block; height: 100%; min-width: 2px; border-radius: inherit; background: var(--sb-accent-solid); transition: width .18s ease; }
.hub-install-progress__track span.indeterminate { width: 36%; animation: hub-progress-indeterminate 1.15s ease-in-out infinite; }
.hub-skeleton-card { min-height: 236px; border: 1px solid var(--hub-rule); border-radius: 7px; background: linear-gradient(100deg, var(--hub-surface) 35%, var(--sb-bg-hover) 50%, var(--hub-surface) 65%); background-size: 230% 100%; animation: hub-loading 1.3s ease-in-out infinite; }
.hub-empty-state { display: grid; justify-items: start; gap: 7px; max-width: 360px; margin: 74px auto; color: var(--sb-text-faint); font-size: 12px; text-align: left; }
.hub-empty-state svg { margin-bottom: 5px; color: var(--sb-text-muted); }
.hub-empty-state strong { color: var(--sb-text-secondary); font-size: 13px; }

.hub-settings-view { display: flex; flex-direction: column; }
.hub-settings-heading { flex: 0 0 auto; }
.hub-account-settings { width: min(620px, 100%); margin-top: 28px; border: 1px solid var(--hub-rule); border-top: 2px solid color-mix(in srgb, var(--sb-accent-solid) 62%, var(--hub-rule)); border-radius: 6px; background: var(--hub-surface); }
.hub-account-settings__heading { display: flex; align-items: center; gap: 11px; padding: 18px 20px; border-bottom: 1px solid var(--hub-rule); }
.hub-account-settings__heading .hub-kicker { margin-bottom: 5px; }
.hub-account-settings__heading h2 { margin: 0; color: var(--sb-text-primary); font-size: 14px; }
.hub-account-settings__icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 5px; background: var(--hub-accent-soft); color: var(--sb-accent-solid); }
.hub-account-settings__body { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 21px 20px; }
.hub-account-settings__identity { display: flex; align-items: center; min-width: 0; gap: 11px; }
.hub-account-avatar { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 5px; background: var(--sb-accent-solid); color: #fff; font-family: var(--font-mono); font-size: 10px; font-weight: 700; }
.hub-account-settings__identity strong, .hub-account-settings__identity span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub-account-settings__identity strong { color: var(--sb-text-primary); font-size: 13px; }
.hub-account-settings__identity span { max-width: 280px; margin-top: 4px; color: var(--sb-text-faint); font-size: 11px; }
.hub-account-settings__status { display: grid; justify-items: end; gap: 5px; color: var(--sb-text-secondary); font-size: 11px; text-align: right; }
.hub-account-settings__status span { padding: 4px 7px; border: 1px solid color-mix(in srgb, var(--sb-accent-solid) 28%, var(--hub-rule)); border-radius: 3px; background: var(--hub-accent-soft); color: var(--sb-accent-solid); font-family: var(--font-mono); font-size: 9px; }
.hub-account-settings__status small { color: var(--sb-text-faint); font-size: 10px; }
.hub-account-settings__footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 20px; border-top: 1px solid var(--hub-rule); background: color-mix(in srgb, var(--hub-surface) 90%, var(--sb-bg-inset)); }
.hub-account-settings__footer p { margin: 0; color: var(--sb-text-faint); font-size: 11px; line-height: 1.45; }
.hub-logout-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 32px; flex: 0 0 auto; padding: 0 11px; border: 1px solid color-mix(in srgb, var(--sb-status-error, #ef4444) 45%, var(--hub-rule)); border-radius: 4px; color: var(--sb-status-error, #ef4444); font-size: 11px; font-weight: 700; transition: background .15s ease, color .15s ease; }
.hub-logout-button:hover { background: color-mix(in srgb, var(--sb-status-error, #ef4444) 10%, var(--hub-surface)); }

.hub-detail { display: flex; min-width: 0; min-height: 0; flex-direction: column; border-left: 1px solid var(--hub-rule); background: var(--hub-surface); }
.hub-detail__header { flex: 0 0 auto; justify-content: space-between; gap: 14px; padding: 22px 22px 14px; border-bottom: 1px solid var(--hub-rule); }
.hub-detail h2 { overflow: hidden; margin: 6px 0 0; color: var(--sb-text-primary); font-size: 18px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.hub-detail__meta { flex: 0 0 auto; flex-wrap: wrap; gap: 5px; padding: 12px 22px; border-bottom: 1px solid var(--hub-rule); }
.hub-detail__meta span { padding: 3px 6px; border: 1px solid var(--hub-rule); border-radius: 3px; color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 9px; }
.hub-detail__meta span:last-child { border: 0; padding-left: 0; font-family: inherit; }
.hub-markdown { min-width: 0; min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; padding: 20px 22px 34px; color: var(--sb-text-secondary); font-size: 12px; line-height: 1.75; overflow-wrap: anywhere; }
.hub-detail__footer { flex: 0 0 auto; padding: 14px 22px 18px; border-top: 1px solid var(--hub-rule); background: color-mix(in srgb, var(--hub-surface) 92%, var(--sb-bg-inset)); }
.hub-detail__footer .hub-primary-button { width: 100%; }

.hub-markdown :deep(h1), .hub-markdown :deep(h2), .hub-markdown :deep(h3), .hub-markdown :deep(h4) { margin: 22px 0 9px; color: var(--sb-text-primary); line-height: 1.35; }
.hub-markdown :deep(h1) { margin-top: 0; font-size: 18px; }
.hub-markdown :deep(h2) { font-size: 15px; white-space: normal; }
.hub-markdown :deep(h3) { font-size: 13px; }
.hub-markdown :deep(p) { margin: 0 0 12px; }
.hub-markdown :deep(ul), .hub-markdown :deep(ol) { margin: 0 0 13px; padding-left: 20px; }
.hub-markdown :deep(li + li) { margin-top: 4px; }
.hub-markdown :deep(a) { color: var(--sb-accent-solid); text-decoration: underline; text-underline-offset: 2px; }
.hub-markdown :deep(code) { padding: 2px 4px; border-radius: 3px; background: var(--sb-bg-inset); color: var(--sb-text-primary); font-family: var(--font-mono); font-size: .92em; }
.hub-markdown :deep(pre) { overflow: auto; margin: 14px 0; padding: 11px; border: 1px solid var(--hub-rule); border-radius: 4px; background: var(--sb-bg-inset); }
.hub-markdown :deep(pre code) { padding: 0; background: transparent; color: var(--sb-text-secondary); white-space: pre; }
.hub-markdown :deep(blockquote) { margin: 14px 0; padding: 4px 0 4px 11px; border-left: 2px solid var(--sb-accent-solid); color: var(--sb-text-muted); }
.hub-markdown :deep(img) { display: block; max-width: 100%; height: auto; margin: 14px 0; border: 1px solid var(--hub-rule); border-radius: 4px; }
.hub-markdown :deep(table) { width: 100%; margin: 14px 0; border-collapse: collapse; font-size: 11px; }
.hub-markdown :deep(th), .hub-markdown :deep(td) { padding: 7px; border: 1px solid var(--hub-rule); text-align: left; vertical-align: top; }
.hub-markdown :deep(th) { color: var(--sb-text-primary); background: var(--sb-bg-inset); }

@keyframes hub-spin { to { transform: rotate(360deg); } }
@keyframes hub-loading { to { background-position: -130% 0; } }
@keyframes hub-progress-indeterminate { 0% { transform: translateX(-120%); } 50% { transform: translateX(120%); } 100% { transform: translateX(280%); } }

@media (max-width: 1080px) {
  .hub-workbench.has-detail { grid-template-columns: 188px minmax(0, 1fr); }
  .hub-detail { position: absolute; inset: 50px 0 0 auto; width: min(390px, 92vw); box-shadow: -18px 0 35px rgb(0 0 0 / 20%); }
}

@media (max-width: 700px) {
  .hub-workbench, .hub-workbench.has-detail { grid-template-columns: 1fr; }
  .hub-sidebar { display: none; }
  .hub-content { padding: 20px; }
  .hub-heading { flex-direction: column; gap: 16px; }
  .hub-heading__tools { width: 100%; }
  .hub-search { flex: 1; width: auto; }
  .hub-category-filter { min-width: 118px; }
  .hub-grid, .hub-loading-grid { grid-template-columns: 1fr; }
  .hub-detail { width: 100%; }
  .hub-account-settings__body, .hub-account-settings__footer { align-items: flex-start; flex-direction: column; }
  .hub-account-settings__status { justify-items: start; text-align: left; }
  .hub-auth-card { padding: 26px 22px; }
}
</style>
