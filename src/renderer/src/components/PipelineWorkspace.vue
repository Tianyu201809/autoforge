<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import type { PipelineMeta, PipelineSession, ScriptMeta } from '../../../shared/types/script'
import PipelineEditorView from './PipelineEditorView.vue'
import PipelineListView from './PipelineListView.vue'
import { askConfirm } from '../composables/useConfirmDialog'

const props = defineProps<{ open: boolean; scripts: ScriptMeta[] }>()
const emit = defineEmits<{ close: []; refresh: [] }>()

type View = 'list' | 'editor'
const view = ref<View>('list')
const pipelines = ref<PipelineMeta[]>([])
const sessions = ref<PipelineSession[]>([])
const editingPipeline = ref<PipelineMeta | null>(null)
const editorRevision = ref(0)
const loading = ref(false)
const error = ref('')
const editingSession = computed(() => {
  if (!editingPipeline.value) return null
  return sessions.value
    .filter((session) => session.pipelineId === editingPipeline.value?.id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [nextPipelines, nextSessions] = await Promise.all([
      window.autoforge.pipelines.list(),
      window.autoforge.pipelines.listSessions()
    ])
    pipelines.value = nextPipelines
    sessions.value = nextSessions
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function openEditor(pipeline: PipelineMeta | null): void {
  editingPipeline.value = pipeline ? clone(pipeline) : null
  editorRevision.value += 1
  view.value = 'editor'
}

function backToList(): void {
  view.value = 'list'
  editingPipeline.value = null
  void load()
}

async function updatePipeline(pipeline: PipelineMeta, patch: Partial<PipelineMeta>): Promise<void> {
  try {
    const updated = await window.autoforge.pipelines.update(pipeline.id, patch)
    const index = pipelines.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) pipelines.value[index] = updated
    emit('refresh')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function toggleStar(pipeline: PipelineMeta): void {
  void updatePipeline(pipeline, { starred: !pipeline.starred })
}

function toggleArchive(pipeline: PipelineMeta): void {
  void updatePipeline(pipeline, { archived: !pipeline.archived })
}

async function deletePipeline(pipeline: PipelineMeta): Promise<void> {
  const confirmed = await askConfirm({
    title: '删除流水线？',
    message: `确定删除流水线“${pipeline.name}”吗？此操作不可撤销。`,
    confirmLabel: '删除',
    cancelLabel: '取消',
    variant: 'danger'
  })
  if (!confirmed) return
  try {
    await window.autoforge.pipelines.delete(pipeline.id)
    pipelines.value = pipelines.value.filter((item) => item.id !== pipeline.id)
    emit('refresh')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function onSaved(pipeline: PipelineMeta): void {
  editingPipeline.value = clone(pipeline)
  const index = pipelines.value.findIndex((item) => item.id === pipeline.id)
  if (index >= 0) pipelines.value[index] = pipeline
  else pipelines.value = [pipeline, ...pipelines.value]
  emit('refresh')
}

function animatePanel(element: Element, direction: 'enter' | 'leave', done: () => void): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    done()
    return
  }
  gsap.killTweensOf(element)
  if (direction === 'enter') {
    gsap.fromTo(element, { opacity: 0, x: view.value === 'editor' ? 22 : -22 }, { opacity: 1, x: 0, duration: 0.28, ease: 'power2.out', onComplete: done })
  } else {
    gsap.to(element, { opacity: 0, x: view.value === 'editor' ? -22 : 22, duration: 0.18, ease: 'power1.in', onComplete: done })
  }
}

let offSession: (() => void) | undefined
watch(() => props.open, (open) => {
  if (open) {
    view.value = 'list'
    editingPipeline.value = null
    void load()
  }
})
onMounted(() => {
  if (props.open) void load()
  offSession = window.autoforge.pipelines.onSession((session) => {
    const index = sessions.value.findIndex((item) => item.id === session.id)
    if (index >= 0) sessions.value[index] = session
    else sessions.value = [...sessions.value, session]
    void nextTick(() => {
      if (session.status !== 'running') void load()
    })
  })
})
onUnmounted(() => offSession?.())
</script>

<template>
  <div v-if="open" class="pipeline-workspace-shell flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden sb-bg-base">
    <Transition :css="false" mode="out-in" @enter="(element, done) => animatePanel(element, 'enter', done)" @leave="(element, done) => animatePanel(element, 'leave', done)">
      <PipelineListView
        v-if="view === 'list'"
        key="pipeline-list"
        :pipelines="pipelines"
        :sessions="sessions"
        :loading="loading"
        :error="error"
        @create="openEditor(null)"
        @edit="openEditor"
        @toggle-star="toggleStar"
        @toggle-archive="toggleArchive"
        @delete="deletePipeline"
        @retry="load"
        @close="emit('close')"
      />
      <PipelineEditorView
        v-else
        :key="`pipeline-editor-${editorRevision}`"
        :open="open"
        :scripts="scripts"
        :pipeline="editingPipeline"
        :initial-session="editingSession"
        @back="backToList"
        @close="emit('close')"
        @saved="onSaved"
        @deleted="load"
      />
    </Transition>
  </div>
</template>

<style scoped>
.pipeline-workspace-shell { background: var(--sb-bg-base); }
@media (prefers-reduced-motion: reduce) { .pipeline-workspace-shell { scroll-behavior: auto; } }
</style>
