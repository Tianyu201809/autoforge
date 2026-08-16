<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  Boxes,
  Download,
  FileText,
  LogOut,
  PackageOpen,
  RefreshCw,
  Store,
  Users,
  X
} from 'lucide-vue-next'
import type { HubPlugin, HubScope, HubTeam, HubSession } from '../../../shared/hub-types'
import { askConfirm } from '../composables/useConfirmDialog'
import { useToast } from '../composables/useToast'
import { renderScriptReadmeMarkdown } from '../lib/script-readme-markdown'
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
const installingId = ref<string | null>(null)
const error = ref('')
const selected = ref<HubPlugin | null>(null)

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

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    session.value = await window.autoforge.hub.session()
    if (!session.value.authenticated) {
      items.value = []
      selected.value = null
      return
    }
    teams.value = await window.autoforge.hub.listTeams()
    if (!teamId.value) teamId.value = teams.value[0]?.id ?? ''
    const result = await window.autoforge.hub.listPlugins({
      scope: scope.value,
      teamId: scope.value === 'team' ? teamId.value : undefined,
      page: 1,
      pageSize: 30,
      sort: scope.value === 'marketplace' ? 'newest' : 'name'
    })
    items.value = result.items
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
  if (scope.value === nextScope && items.value.length) return
  scope.value = nextScope
  selected.value = null
  await load()
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
}

async function install(plugin: HubPlugin): Promise<void> {
  installingId.value = plugin.id
  try {
    const result = await window.autoforge.hub.installPlugin(plugin.id)
    if (result.status !== 'duplicate_cancelled') {
      pushToast({
        type: 'success',
        title: result.status === 'updated' ? '脚本已更新' : '脚本已安装',
        message: result.name
      })
    }
  } catch (err) {
    pushToast({
      type: 'error',
      title: '安装失败',
      message: err instanceof Error ? err.message : '请稍后重试'
    })
  } finally {
    installingId.value = null
  }
}

const offAuthorized = window.autoforge.hub.onHubAuthorized((next) => {
  session.value = next
  authorizing.value = false
  void load()
})

watch(
  () => props.open,
  (open) => {
    if (open) void load()
  },
  { immediate: true }
)

onUnmounted(offAuthorized)
</script>

<template>
  <div v-if="open" class="hub-shell">
    <header class="hub-topbar">
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

    <main v-else class="hub-workbench" :class="{ 'has-detail': selected }">
      <aside class="hub-sidebar">
        <div class="hub-profile">
          <div class="hub-avatar">{{ initials(session.user?.displayName) }}</div>
          <div class="hub-profile__text">
            <b>{{ session.user?.displayName }}</b>
            <span>{{ session.user?.email }}</span>
          </div>
          <button class="hub-profile__logout" title="退出 AutoforgeHub" aria-label="退出 AutoforgeHub" @click="logout">
            <LogOut :size="15" />
          </button>
        </div>

        <nav class="hub-navigation" aria-label="脚本来源">
          <button :class="{ active: scope === 'marketplace' }" @click="switchScope('marketplace')">
            <Store :size="16" />
            <span>脚本市场</span>
          </button>
          <button :class="{ active: scope === 'personal' }" @click="switchScope('personal')">
            <PackageOpen :size="16" />
            <span>我的脚本</span>
          </button>
          <button :class="{ active: scope === 'team' }" @click="switchScope('team')">
            <Users :size="16" />
            <span>团队脚本</span>
            <em v-if="session.user?.teamCount">{{ session.user.teamCount }}</em>
          </button>
        </nav>

        <label v-if="scope === 'team'" class="hub-team-picker">
          <span>当前团队</span>
          <select v-model="teamId" @change="load">
            <option v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</option>
          </select>
        </label>
      </aside>

      <section class="hub-content">
        <div class="hub-heading">
          <div>
            <p class="hub-kicker">AUTOFORGEHUB / {{ scope.toUpperCase() }}</p>
            <div class="hub-heading__title">
              <component :is="scopeMeta.icon" :size="20" />
              <h1>{{ scopeMeta.title }}</h1>
            </div>
            <p>{{ scopeMeta.subtitle }}</p>
          </div>
          <button class="hub-icon-button hub-refresh" title="刷新脚本列表" aria-label="刷新脚本列表" @click="load">
            <RefreshCw :size="16" :class="{ 'hub-spin': loading }" />
          </button>
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
            :class="{ selected: selected?.id === plugin.id }"
            tabindex="0"
            @click="selected = plugin"
            @keydown.enter="selected = plugin"
          >
            <div class="hub-card__header">
              <div class="hub-plugin-icon" :style="{ backgroundColor: plugin.iconColor || 'var(--sb-accent-solid)' }">
                {{ initials(plugin.icon || plugin.title) }}
              </div>
              <span class="hub-language">{{ plugin.language || 'AUTOMATION' }}</span>
            </div>
            <div class="hub-card__body">
              <h2>{{ plugin.title }}</h2>
              <p>{{ plugin.description || '暂无说明文档。' }}</p>
            </div>
            <footer class="hub-card__footer">
              <div class="hub-card__meta">
                <span>{{ plugin.category || '其他' }}</span>
                <span>{{ formatDate(plugin.updatedAt) }}</span>
              </div>
              <button
                class="hub-install-button"
                :disabled="installingId !== null"
                :aria-label="`安装 ${plugin.title}`"
                :title="`安装 ${plugin.title}`"
                @click.stop="install(plugin)"
              >
                <RefreshCw v-if="installingId === plugin.id" :size="15" class="hub-spin" />
                <Download v-else :size="15" />
              </button>
            </footer>
          </article>
        </div>
      </section>

      <aside v-if="selected" class="hub-detail" aria-label="脚本详情">
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
          <button class="hub-primary-button" :disabled="installingId !== null" @click="install(selected)">
            <RefreshCw v-if="installingId === selected.id" :size="16" class="hub-spin" />
            <Download v-else :size="16" />
            {{ installingId === selected.id ? '正在安装' : '安装到本地' }}
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
.hub-profile__logout { display: inline-grid; width: 27px; height: 27px; flex: 0 0 auto; place-items: center; border: 1px solid transparent; border-radius: 4px; color: var(--sb-text-faint); transition: background .15s ease, color .15s ease; }
.hub-profile__logout:hover { background: var(--sb-bg-hover); color: var(--sb-text-primary); }
.hub-navigation { display: grid; gap: 3px; margin-top: 15px; }
.hub-navigation button { min-height: 34px; gap: 9px; width: 100%; padding: 0 8px; border-radius: 4px; color: var(--sb-text-muted); font-size: 12px; text-align: left; transition: background .15s ease, color .15s ease; }
.hub-navigation button:hover { background: var(--sb-bg-hover); color: var(--sb-text-primary); }
.hub-navigation button.active { background: var(--hub-accent-soft); box-shadow: inset 2px 0 0 var(--sb-accent-solid); color: var(--sb-text-primary); font-weight: 700; }
.hub-navigation em { min-width: 17px; height: 17px; margin-left: auto; padding: 0 4px; border-radius: 9px; background: var(--sb-bg-inset); color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 9px; font-style: normal; line-height: 17px; text-align: center; }
.hub-team-picker { display: grid; gap: 6px; margin: 14px 7px 0; color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 9px; letter-spacing: .05em; }
.hub-team-picker select { width: 100%; height: 31px; padding: 0 8px; border: 1px solid var(--hub-rule); border-radius: 4px; background: var(--sb-bg-inset); color: var(--sb-text-secondary); font-size: 11px; }

.hub-content { min-width: 0; overflow: auto; padding: 28px clamp(20px, 3vw, 42px) 42px; }
.hub-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 22px; border-bottom: 1px solid var(--hub-rule); }
.hub-heading__title { gap: 9px; margin-top: 7px; color: var(--sb-text-primary); }
.hub-heading h1 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: 0; }
.hub-heading > div > p:last-child { margin: 8px 0 0; color: var(--sb-text-muted); font-size: 12px; }
.hub-refresh { margin-top: 2px; border-color: var(--hub-rule); }
.hub-grid, .hub-loading-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(226px, 1fr)); gap: 12px; margin-top: 22px; }
.hub-card { display: flex; flex-direction: column; min-width: 0; height: 196px; padding: 14px; border: 1px solid var(--hub-rule); border-radius: 6px; background: var(--hub-surface); cursor: pointer; outline: none; transition: border-color .15s ease, background .15s ease, transform .15s ease; }
.hub-card:hover, .hub-card:focus-visible { border-color: color-mix(in srgb, var(--sb-accent-solid) 58%, var(--hub-rule)); background: var(--hub-surface-raised); transform: translateY(-1px); }
.hub-card.selected { border-color: var(--sb-accent-solid); background: var(--hub-accent-soft); box-shadow: inset 3px 0 0 var(--sb-accent-solid); }
.hub-card__header { justify-content: space-between; gap: 10px; }
.hub-plugin-icon { display: grid; width: 31px; height: 31px; place-items: center; border-radius: 5px; color: #fff; font-family: var(--font-mono); font-size: 9px; font-weight: 700; }
.hub-language { max-width: 105px; overflow: hidden; color: var(--sb-text-faint); font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: .05em; text-overflow: ellipsis; white-space: nowrap; }
.hub-card__body { min-width: 0; margin-top: 13px; }
.hub-card h2 { overflow: hidden; margin: 0; color: var(--sb-text-primary); font-size: 13px; font-weight: 700; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.hub-card__body p { display: -webkit-box; overflow: hidden; margin: 7px 0 0; color: var(--sb-text-muted); font-size: 11px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.hub-card__footer { justify-content: space-between; gap: 8px; margin-top: auto; }
.hub-card__meta { min-width: 0; gap: 7px; overflow: hidden; color: var(--sb-text-faint); font-size: 10px; white-space: nowrap; }
.hub-card__meta span { overflow: hidden; text-overflow: ellipsis; }
.hub-card__meta span + span::before { content: '·'; margin-right: 7px; color: var(--sb-text-faint); }
.hub-install-button { display: inline-grid; width: 29px; height: 29px; flex: 0 0 auto; place-items: center; border: 1px solid color-mix(in srgb, var(--sb-accent-solid) 38%, var(--hub-rule)); border-radius: 4px; color: var(--sb-accent-solid); transition: background .15s ease, color .15s ease; }
.hub-install-button:hover:not(:disabled) { background: var(--sb-accent-solid); color: #fff; }
.hub-skeleton-card { height: 196px; border: 1px solid var(--hub-rule); border-radius: 6px; background: linear-gradient(100deg, var(--hub-surface) 35%, var(--sb-bg-hover) 50%, var(--hub-surface) 65%); background-size: 230% 100%; animation: hub-loading 1.3s ease-in-out infinite; }
.hub-empty-state { display: grid; justify-items: start; gap: 7px; max-width: 360px; margin: 74px auto; color: var(--sb-text-faint); font-size: 12px; text-align: left; }
.hub-empty-state svg { margin-bottom: 5px; color: var(--sb-text-muted); }
.hub-empty-state strong { color: var(--sb-text-secondary); font-size: 13px; }

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

@media (max-width: 1080px) {
  .hub-workbench.has-detail { grid-template-columns: 188px minmax(0, 1fr); }
  .hub-detail { position: absolute; inset: 50px 0 0 auto; width: min(390px, 92vw); box-shadow: -18px 0 35px rgb(0 0 0 / 20%); }
}

@media (max-width: 700px) {
  .hub-workbench, .hub-workbench.has-detail { grid-template-columns: 1fr; }
  .hub-sidebar { display: none; }
  .hub-content { padding: 20px; }
  .hub-grid, .hub-loading-grid { grid-template-columns: 1fr; }
  .hub-detail { width: 100%; }
  .hub-auth-card { padding: 26px 22px; }
}
</style>
