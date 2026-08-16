<script setup lang="ts">
import { ref, watch } from 'vue'
import { Download, LogOut, X } from 'lucide-vue-next'
import type { HubPlugin, HubScope, HubTeam } from '../../../shared/hub-types'
import { useToast } from '../composables/useToast'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { pushToast } = useToast()
const email = ref('')
const password = ref('')
const session = ref({ authenticated: false, persistent: false, user: null as { displayName: string } | null })
const scope = ref<HubScope>('marketplace')
const teams = ref<HubTeam[]>([])
const teamId = ref('')
const items = ref<HubPlugin[]>([])
const loading = ref(false)
const installingId = ref<string | null>(null)
const error = ref('')

async function load(): Promise<void> {
  loading.value = true; error.value = ''
  try {
    session.value = await window.autoforge.hub.session()
    if (!session.value.authenticated) return
    teams.value = await window.autoforge.hub.listTeams()
    if (!teamId.value) teamId.value = teams.value[0]?.id ?? ''
    const result = await window.autoforge.hub.listPlugins({ scope: scope.value, teamId: scope.value === 'team' ? teamId.value : undefined, page: 1, pageSize: 30, sort: scope.value === 'marketplace' ? 'newest' : 'name' })
    items.value = result.items
  } catch (err) { error.value = err instanceof Error ? err.message : '无法连接 AutoforgeHub' }
  finally { loading.value = false }
}
async function login(): Promise<void> { try { session.value = await window.autoforge.hub.login(email.value, password.value); password.value = ''; await load() } catch (err) { error.value = err instanceof Error ? err.message : '登录失败' } }
async function logout(): Promise<void> { await window.autoforge.hub.logout(); session.value = { authenticated: false, persistent: false, user: null }; items.value = [] }
async function install(id: string): Promise<void> { installingId.value = id; try { const result = await window.autoforge.hub.installPlugin(id); if (result.status !== 'duplicate_cancelled') pushToast({ type: 'success', title: result.status === 'updated' ? '插件已更新' : '插件已安装', message: result.name }) } catch (err) { pushToast({ type: 'error', title: '安装失败', message: err instanceof Error ? err.message : '请稍后重试' }) } finally { installingId.value = null } }
watch(() => props.open, (open) => { if (open) void load() })
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex flex-col sb-bg-panel">
    <header class="h-12 px-4 flex items-center justify-between border-b sb-border-subtle"><div><b class="text-[13px] sb-text-primary">插件中心</b><span class="ml-2 text-[10px] sb-text-faint">AutoforgeHub</span></div><div class="flex gap-1"><button v-if="session.authenticated" class="hub-icon" title="退出" aria-label="退出 AutoforgeHub" @click="logout"><LogOut :size="16" /></button><button class="hub-icon" title="关闭" aria-label="关闭插件中心" @click="emit('close')"><X :size="18" /></button></div></header>
    <form v-if="!session.authenticated" class="m-auto w-80 space-y-3" @submit.prevent="login"><h1 class="text-[20px] sb-text-primary">登录 AutoforgeHub</h1><input v-model="email" class="hub-input" type="email" placeholder="邮箱" required><input v-model="password" class="hub-input" type="password" placeholder="密码" required><button class="hub-primary">登录</button><p v-if="error" class="text-[11px] text-rose-500">{{ error }}</p></form>
    <main v-else class="flex flex-1 min-h-0"><aside class="w-44 p-3 border-r sb-border-subtle"><p class="px-2 text-[11px] sb-text-muted">{{ session.user?.displayName }}</p><button v-for="item in ([['marketplace','插件市场'],['personal','我的插件'],['team','团队插件']] as const)" :key="item[0]" class="hub-scope" :class="{ active: scope === item[0] }" @click="scope=item[0]; void load()">{{ item[1] }}</button><select v-if="scope === 'team'" v-model="teamId" class="hub-input mt-2" @change="load"><option v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</option></select></aside><section class="flex-1 overflow-y-auto p-5"><p v-if="error" class="text-rose-500 text-[12px]">{{ error }}</p><p v-else-if="loading" class="sb-text-muted text-[12px]">正在加载插件…</p><div v-else class="hub-grid"><article v-for="plugin in items" :key="plugin.id" class="hub-card"><div><h2>{{ plugin.title }}</h2><p>{{ plugin.description || '暂无说明' }}</p><small>{{ plugin.language || '未标注' }} · {{ plugin.category || '其他' }}</small></div><button class="hub-icon" :disabled="installingId !== null" :aria-label="`安装 ${plugin.title}`" title="安装" @click="install(plugin.id)"><Download :size="16" /></button></article></div></section></main>
  </div>
</template>

<style scoped>
.hub-icon{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;color:var(--sb-text-muted)}.hub-icon:hover{background:var(--sb-bg-hover)}.hub-input{width:100%;height:36px;padding:0 12px;border:1px solid var(--sb-border);border-radius:6px;background:var(--sb-bg-inset);color:var(--sb-text-primary);font-size:12px}.hub-primary{width:100%;height:36px;border-radius:6px;background:var(--sb-accent-solid);color:#fff;font-size:12px}.hub-scope{width:100%;padding:8px;border-radius:6px;text-align:left;color:var(--sb-text-muted);font-size:12px}.hub-scope.active{background:var(--sb-bg-hover);color:var(--sb-text-primary)}.hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}.hub-card{min-height:110px;padding:12px;display:flex;justify-content:space-between;gap:8px;border:1px solid var(--sb-border);border-radius:7px;background:var(--sb-bg-surface)}.hub-card h2{color:var(--sb-text-primary);font-size:13px;font-weight:600}.hub-card p{margin-top:6px;color:var(--sb-text-muted);font-size:11px;line-height:1.5}.hub-card small{display:block;margin-top:10px;color:var(--sb-text-faint);font-size:10px}@media(max-width:700px){.hub-grid{grid-template-columns:1fr}.w-44{width:126px}}
</style>
