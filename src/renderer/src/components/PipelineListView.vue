<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Archive, ArchiveRestore, ArrowLeft, Clock3, Pencil, Plus, Search, Star, Trash2, Workflow } from 'lucide-vue-next'
import { gsap } from 'gsap'
import type { PipelineMeta, PipelineSession } from '../../../shared/types/script'

const props = defineProps<{
  pipelines: PipelineMeta[]
  sessions: PipelineSession[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  create: []
  edit: [pipeline: PipelineMeta]
  toggleStar: [pipeline: PipelineMeta]
  toggleArchive: [pipeline: PipelineMeta]
  delete: [pipeline: PipelineMeta]
  retry: []
  close: []
}>()

type Filter = 'all' | 'starred' | 'archived'
const filter = ref<Filter>('all')
const query = ref('')
const listRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
let listTween: gsap.core.Tween | undefined

const filteredPipelines = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return props.pipelines.filter((pipeline) => {
    const matchesFilter = filter.value === 'all' || (filter.value === 'starred' ? pipeline.starred : pipeline.archived)
    const matchesQuery = !keyword || pipeline.name.toLowerCase().includes(keyword) || pipeline.description.toLowerCase().includes(keyword)
    return matchesFilter && matchesQuery
  })
})

function sessionFor(pipeline: PipelineMeta): PipelineSession | undefined {
  return props.sessions
    .filter((session) => session.pipelineId === pipeline.id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
}

function statusLabel(pipeline: PipelineMeta): string {
  const status = sessionFor(pipeline)?.status
  if (status === 'running') return '运行中'
  if (status === 'success') return '成功'
  if (status === 'error') return '失败'
  if (status === 'stopped') return '已停止'
  return '空闲'
}

function statusClass(pipeline: PipelineMeta): string {
  return `is-${sessionFor(pipeline)?.status ?? 'idle'}`
}

function formatRecentRun(value?: string): string {
  if (!value) return '尚未运行'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未运行'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function animateCards(): void {
  const container = listRef.value
  if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const cards = container.querySelectorAll<HTMLElement>('[data-pipeline-card]')
  listTween?.kill()
  listTween = gsap.fromTo(cards, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.34, stagger: 0.045, ease: 'power2.out', clearProps: 'transform' })
}

watch(filteredPipelines, () => void nextTick(animateCards))
onMounted(() => void nextTick(() => {
  animateCards()
  searchInputRef.value?.focus()
}))
onBeforeUnmount(() => listTween?.kill())
</script>

<template>
  <div class="pipeline-list-view flex h-full min-h-0 w-full flex-1 flex-col">
    <header class="pipeline-list-header flex items-center gap-4 border-b sb-border-subtle px-6 py-5">
      <div class="pipeline-list-title flex items-center gap-3">
        <span class="pipeline-list-icon"><Workflow class="h-5 w-5" /></span>
        <div>
          <h2 class="text-[17px] font-semibold sb-text-primary">流水线</h2>
          <p class="mt-1 text-[11px] sb-text-faint">编排脚本，逐步传递执行结果</p>
        </div>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <label class="pipeline-search-field"><Search class="h-3.5 w-3.5" /><input ref="searchInputRef" v-model="query" placeholder="搜索流水线" /></label>
        <button class="h-9 rounded-lg sb-btn-accent px-3.5 text-[12px] font-medium" @click="emit('create')"><Plus class="mr-1.5 inline h-3.5 w-3.5" />新建流水线</button>
        <button class="pipeline-workspace-exit" title="返回主应用" @click="emit('close')"><ArrowLeft class="h-3.5 w-3.5" />返回主应用</button>
      </div>
    </header>

    <div class="flex items-center gap-2 px-6 pt-5">
      <button v-for="item in ([['all', '全部'], ['starred', '收藏'], ['archived', '归档']] as const)" :key="item[0]" class="pipeline-filter-button" :class="filter === item[0] && 'is-active'" @click="filter = item[0]">{{ item[1] }}</button>
      <span class="ml-auto text-[11px] sb-text-faint">{{ filteredPipelines.length }} 条流水线</span>
    </div>

    <div ref="listRef" class="pipeline-list-scroll min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div v-if="error" class="pipeline-list-state pipeline-list-state--error">
        <p>{{ error }}</p>
        <button class="pipeline-list-state-action" @click="emit('retry')">重新加载</button>
      </div>
      <div v-else-if="loading" class="pipeline-list-loading"><span class="pipeline-loading-orb"></span><span>正在加载流水线…</span></div>
      <div v-else-if="!props.pipelines.length" class="pipeline-list-state">
        <Workflow class="h-8 w-8 opacity-30" />
        <p class="mt-3">还没有流水线</p>
        <button class="pipeline-list-state-action" @click="emit('create')">创建第一条流水线</button>
      </div>
      <div v-else-if="!filteredPipelines.length" class="pipeline-list-state">
        <Search class="h-8 w-8 opacity-30" />
        <p class="mt-3">没有匹配的流水线</p>
        <button class="pipeline-list-state-action" @click="query = ''; filter = 'all'">清除筛选</button>
      </div>
      <div v-else class="pipeline-card-grid">
        <article v-for="pipeline in filteredPipelines" :key="pipeline.id" data-pipeline-card class="pipeline-card" @dblclick="emit('edit', pipeline)">
          <div class="pipeline-card-accent" :class="statusClass(pipeline)"></div>
          <div class="flex items-start gap-3">
            <span class="pipeline-card-mark"><Workflow class="h-4 w-4" /></span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="truncate text-[13px] font-semibold sb-text-primary">{{ pipeline.name }}</h3>
                <Star v-if="pipeline.starred" class="h-3.5 w-3.5 shrink-0 fill-current text-amber-400" />
              </div>
              <p class="pipeline-card-description">{{ pipeline.description || '暂无描述' }}</p>
            </div>
            <button class="pipeline-card-more" title="编辑流水线" @click="emit('edit', pipeline)"><Pencil class="h-3.5 w-3.5" /></button>
          </div>
          <div class="pipeline-card-meta">
            <span>{{ pipeline.nodes.length }} 个节点</span>
            <span class="pipeline-status" :class="statusClass(pipeline)"><i></i>{{ statusLabel(pipeline) }}</span>
            <span class="pipeline-card-time"><Clock3 class="h-3 w-3" />{{ formatRecentRun(pipeline.recentRunAt) }}</span>
          </div>
          <div class="pipeline-card-actions">
            <button @click="emit('toggleStar', pipeline)"><Star class="h-3 w-3" />{{ pipeline.starred ? '取消收藏' : '收藏' }}</button>
            <button @click="emit('toggleArchive', pipeline)"><ArchiveRestore v-if="pipeline.archived" class="h-3 w-3" /><Archive v-else class="h-3 w-3" />{{ pipeline.archived ? '取消归档' : '归档' }}</button>
            <button class="is-danger" @click="emit('delete', pipeline)"><Trash2 class="h-3 w-3" />删除</button>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pipeline-list-view { background: radial-gradient(circle at 80% -20%, color-mix(in srgb, var(--sb-accent-solid) 12%, transparent), transparent 38%), var(--sb-bg-panel); }
.pipeline-workspace-exit { display: inline-flex; height: 32px; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid var(--sb-border); border-radius: 8px; color: var(--sb-text-muted); font-size: 11px; transition: 160ms ease; }
.pipeline-workspace-exit:hover { border-color: color-mix(in srgb, var(--sb-accent-solid) 55%, var(--sb-border)); color: var(--sb-text-primary); background: color-mix(in srgb, var(--sb-accent-solid) 8%, transparent); }
.pipeline-list-icon { display: grid; width: 38px; height: 38px; place-items: center; border: 1px solid color-mix(in srgb, var(--sb-accent-solid) 30%, var(--sb-border)); border-radius: 12px; color: var(--sb-accent-solid); background: color-mix(in srgb, var(--sb-accent-solid) 10%, transparent); }
.pipeline-search-field { display: flex; width: 200px; height: 34px; align-items: center; gap: 7px; padding: 0 10px; border: 1px solid var(--sb-border); border-radius: 9px; color: var(--sb-text-faint); background: color-mix(in srgb, var(--sb-bg-inset) 75%, transparent); }
.pipeline-search-field input { width: 100%; border: 0; outline: 0; color: var(--sb-text-primary); font-size: 11px; background: transparent; }
.pipeline-filter-button { height: 28px; padding: 0 11px; border-radius: 7px; color: var(--sb-text-muted); font-size: 11px; transition: 160ms ease; }
.pipeline-filter-button:hover, .pipeline-filter-button.is-active { color: var(--sb-text-primary); background: color-mix(in srgb, var(--sb-accent-solid) 11%, transparent); }
.pipeline-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 12px; }
.pipeline-card { position: relative; overflow: hidden; padding: 16px; border: 1px solid var(--sb-border-subtle); border-radius: 14px; background: color-mix(in srgb, var(--sb-bg-panel) 92%, var(--sb-bg-inset)); box-shadow: 0 12px 28px color-mix(in srgb, #000 6%, transparent); transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease; }
.pipeline-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--sb-accent-solid) 42%, var(--sb-border)); box-shadow: 0 16px 34px color-mix(in srgb, var(--sb-accent-solid) 10%, transparent); }
.pipeline-card-accent { position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--sb-border); }
.pipeline-card-accent.is-running { background: var(--sb-accent-solid); }
.pipeline-card-accent.is-success { background: #22c55e; }
.pipeline-card-accent.is-error { background: #f43f5e; }
.pipeline-card-accent.is-stopped { background: #f59e0b; }
.pipeline-card-mark { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 9px; color: var(--sb-accent-solid); background: color-mix(in srgb, var(--sb-accent-solid) 10%, transparent); }
.pipeline-card-description { margin-top: 5px; overflow: hidden; color: var(--sb-text-faint); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.pipeline-card-more { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 7px; color: var(--sb-text-faint); }
.pipeline-card-more:hover { color: var(--sb-text-primary); background: color-mix(in srgb, var(--sb-accent-solid) 10%, transparent); }
.pipeline-card-meta { display: flex; align-items: center; gap: 9px; margin-top: 17px; color: var(--sb-text-faint); font-size: 10px; }
.pipeline-status { display: inline-flex; align-items: center; gap: 4px; }
.pipeline-status i { width: 6px; height: 6px; border-radius: 99px; background: var(--sb-text-faint); }
.pipeline-status.is-running i { background: var(--sb-accent-solid); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sb-accent-solid) 15%, transparent); }
.pipeline-status.is-success i { background: #22c55e; }
.pipeline-status.is-error i { background: #f43f5e; }
.pipeline-status.is-stopped i { background: #f59e0b; }
.pipeline-card-time { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
.pipeline-card-actions { display: flex; gap: 7px; margin-top: 15px; padding-top: 11px; border-top: 1px solid var(--sb-border-subtle); }
.pipeline-card-actions button { display: inline-flex; align-items: center; gap: 4px; color: var(--sb-text-faint); font-size: 10px; }
.pipeline-card-actions button:hover { color: var(--sb-text-primary); }
.pipeline-card-actions button.is-danger:hover { color: #f43f5e; }
.pipeline-list-state { display: grid; min-height: 320px; place-items: center; align-content: center; color: var(--sb-text-faint); font-size: 12px; text-align: center; }
.pipeline-list-state--error { min-height: 180px; color: #f43f5e; }
.pipeline-list-state-action { margin-top: 12px; color: var(--sb-accent-solid); font-size: 11px; }
.pipeline-list-state-action:hover { text-decoration: underline; }
.pipeline-list-loading { display: flex; min-height: 320px; align-items: center; justify-content: center; gap: 10px; color: var(--sb-text-faint); font-size: 11px; }
.pipeline-loading-orb { width: 9px; height: 9px; border: 2px solid color-mix(in srgb, var(--sb-accent-solid) 30%, transparent); border-top-color: var(--sb-accent-solid); border-radius: 99px; animation: pipeline-list-spin .8s linear infinite; }
@keyframes pipeline-list-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pipeline-card, .pipeline-loading-orb { animation: none; transition: none; } }
</style>
