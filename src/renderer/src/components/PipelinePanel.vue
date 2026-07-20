<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Check, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, Plus, Save, Trash2, Workflow, X } from 'lucide-vue-next'
import type { EnvironmentProfile, PipelineMeta, PipelineNode, PipelineSession, ScriptMeta } from '../../../shared/types/script'

const props = defineProps<{ open: boolean; scripts: ScriptMeta[] }>()
const emit = defineEmits<{ close: []; refresh: [] }>()

const pipelines = ref<PipelineMeta[]>([])
const selectedId = ref<string | null>(null)
const selectedNodeId = ref<string | null>(null)
const draft = ref<PipelineMeta | null>(null)
const runtimeValues = ref<Record<string, string>>({})
const runtimeConfig = ref<Record<string, string>>({})
const currentEnvId = ref('default')
const environments = ref<EnvironmentProfile[]>([])
const session = ref<PipelineSession | null>(null)
const saving = ref(false)
const error = ref('')
const search = ref('')
const canvasRef = ref<HTMLElement | null>(null)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartScrollLeft = ref(0)
const canvasScale = ref(1)
const showGrid = ref(true)
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)
const dragSource = ref<{ source: 'previous-result' | 'pipeline-input'; sourcePath?: string } | null>(null)
const panStartY = ref(0)
const panStartScrollTop = ref(0)
const fieldRefs = new Map<string, HTMLElement>()
const connectionPaths = ref<{ id: string; d: string; status: string }[]>([])

function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const filteredScripts = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return props.scripts.filter((script) => !keyword || script.name.toLowerCase().includes(keyword))
})

const selectedNode = computed(() => draft.value?.nodes.find((node) => node.id === selectedNodeId.value) ?? null)

function blankDraft(): PipelineMeta {
  return {
    id: '',
    name: '新流水线',
    description: '',
    nodes: [],
    envSchema: [],
    paramSchema: [],
    configByEnv: {},
    paramsByEnv: {},
    starred: false,
    archived: false
  }
}

async function load(): Promise<void> {
  pipelines.value = await window.autoforge.pipelines.list()
  environments.value = await window.autoforge.env.list()
  currentEnvId.value = environments.value.find((item) => item.isDefault)?.id ?? environments.value[0]?.id ?? 'default'
  if (selectedId.value) {
    const found = pipelines.value.find((item) => item.id === selectedId.value)
    if (found) draft.value = structuredClone(found)
  }
}

function selectPipeline(item: PipelineMeta): void {
  selectedId.value = item.id
  draft.value = structuredClone(item)
  runtimeValues.value = {}
  runtimeConfig.value = {}
  session.value = null
  error.value = ''
  selectedNodeId.value = item.nodes[0]?.id ?? null
}

function createNew(): void {
  selectedId.value = null
  draft.value = blankDraft()
  runtimeValues.value = {}
  runtimeConfig.value = {}
  session.value = null
  error.value = ''
  selectedNodeId.value = null
}

function addNode(scriptId: string): void {
  if (!draft.value || draft.value.nodes.some((node) => node.scriptId === scriptId)) return
  const script = props.scripts.find((item) => item.id === scriptId)
  if (!script) return
  const node: PipelineNode = {
    id: crypto.randomUUID(),
    scriptId,
    name: script.name,
    order: draft.value.nodes.length,
    inputMappings: []
  }
  draft.value.nodes.push(node)
  selectedNodeId.value = node.id
  void nextTick(() => scrollCanvasToEnd())
}

function scrollCanvasToEnd(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.scrollTo({ left: canvas.scrollWidth, behavior: 'smooth' })
}

function onCanvasWheel(event: WheelEvent): void {
  const canvas = canvasRef.value
  if (!canvas) return
  if (event.ctrlKey) {
    event.preventDefault()
    const delta = event.deltaY < 0 ? 0.1 : -0.1
    canvasScale.value = Math.min(3.5, Math.max(0.2, Number((canvasScale.value + delta).toFixed(2))))
    return
  }
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.preventDefault()
  canvas.scrollLeft += event.deltaX + event.deltaY
}

function setCanvasScale(delta: number): void {
  canvasScale.value = Math.min(3.5, Math.max(0.2, Number((canvasScale.value + delta).toFixed(2))))
}

function resetCanvasView(): void {
  canvasScale.value = 1
  canvasRef.value?.scrollTo({ left: 0, behavior: 'smooth' })
}

function fitCanvasView(): void {
  if (!draft.value) return
  canvasScale.value = Math.min(1.08, Math.max(0.72, Number((1.08 - Math.max(0, draft.value.nodes.length - 3) * 0.04).toFixed(2))))
  void nextTick(() => {
    const canvas = canvasRef.value
    if (canvas) canvas.scrollTo({ left: Math.max(0, (canvas.scrollWidth - canvas.clientWidth) / 2), behavior: 'smooth' })
  })
}

function onCanvasKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  canvasRef.value?.scrollBy({ left: event.key === 'ArrowRight' ? 180 : -180, behavior: 'smooth' })
}

function onCanvasDrop(event: DragEvent): void {
  event.preventDefault()
  const scriptId = event.dataTransfer?.getData('application/x-autoforge-script')
  if (scriptId) addNode(scriptId)
}

function onScriptDragStart(event: DragEvent, scriptId: string): void {
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-autoforge-script', scriptId)
}

function onCanvasPointerDown(event: PointerEvent): void {
  if ((event.target as HTMLElement).closest('button, input, select, textarea')) return
  const canvas = canvasRef.value
  if (!canvas) return
  isPanning.value = true
  panStartX.value = event.clientX
  panStartScrollLeft.value = canvas.scrollLeft
  panStartY.value = event.clientY
  panStartScrollTop.value = canvas.scrollTop
  canvas.setPointerCapture(event.pointerId)
}

function onCanvasPointerMove(event: PointerEvent): void {
  if (!isPanning.value || !canvasRef.value) return
  canvasRef.value.scrollLeft = panStartScrollLeft.value - (event.clientX - panStartX.value)
  canvasRef.value.scrollTop = panStartScrollTop.value - (event.clientY - panStartY.value)
}

function onCanvasPointerUp(event: PointerEvent): void {
  if (!isPanning.value) return
  isPanning.value = false
  canvasRef.value?.releasePointerCapture(event.pointerId)
}

function removeNode(index: number): void {
  const removed = draft.value?.nodes.splice(index, 1)[0]
  if (removed?.id === selectedNodeId.value) selectedNodeId.value = draft.value?.nodes[index]?.id ?? null
  normalizeOrder()
}

function moveNode(index: number, offset: number): void {
  if (!draft.value) return
  const next = index + offset
  if (next < 0 || next >= draft.value.nodes.length) return
  const [node] = draft.value.nodes.splice(index, 1)
  draft.value.nodes.splice(next, 0, node)
  normalizeOrder()
}

function normalizeOrder(): void {
  if (!draft.value) return
  draft.value.nodes.forEach((node, index) => { node.order = index })
}

function addMapping(node: PipelineNode): void {
  const script = props.scripts.find((item) => item.id === node.scriptId)
  const target = script?.paramSchema[0]?.key
  if (!target) return
  node.inputMappings = [...(node.inputMappings ?? []), { source: 'previous-result', sourcePath: '', targetParam: target }]
}

function startFieldDrag(event: DragEvent, source: { source: 'previous-result' | 'pipeline-input'; sourcePath?: string }): void {
  dragSource.value = source
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'link'
    event.dataTransfer.setData('text/plain', source.sourcePath ?? '')
  }
}

function dropFieldMapping(event: DragEvent, node: PipelineNode, targetParam: string): void {
  event.preventDefault()
  const source = dragSource.value
  if (!source) return
  const mappings = [...(node.inputMappings ?? [])]
  const index = mappings.findIndex((mapping) => mapping.targetParam === targetParam)
  const mapping = { ...source, targetParam }
  if (index >= 0) mappings[index] = mapping
  else mappings.push(mapping)
  node.inputMappings = mappings
  dragSource.value = null
}

function nodeParamFields(node: PipelineNode) {
  return scriptFor(node)?.paramSchema ?? []
}

function fixedParamValue(node: PipelineNode, key: string): string {
  return node.paramValues?.[key] ?? ''
}

function setFixedParamValue(node: PipelineNode, key: string, value: string): void {
  node.paramValues = { ...(node.paramValues ?? {}), [key]: value }
}

function onFixedParamInput(event: Event, node: PipelineNode, key: string): void {
  setFixedParamValue(node, key, (event.target as HTMLInputElement).value)
}

function removeMapping(node: PipelineNode, index: number): void {
  node.inputMappings?.splice(index, 1)
}

function scriptFor(node: PipelineNode): ScriptMeta | undefined {
  return props.scripts.find((script) => script.id === node.scriptId)
}

function selectNode(node: PipelineNode): void {
  selectedNodeId.value = node.id
}

function setFieldRef(key: string, element: Element | null): void {
  if (element instanceof HTMLElement) fieldRefs.set(key, element)
  else fieldRefs.delete(key)
}

function fieldPoint(key: string, trackRect: DOMRect, side: 'source' | 'target'): { x: number; y: number } | null {
  const element = fieldRefs.get(key)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  const scale = canvasScale.value || 1
  return {
    x: (rect.left - trackRect.left + (side === 'source' ? rect.width : 0)) / scale,
    y: (rect.top - trackRect.top + rect.height / 2) / scale
  }
}

function measureConnections(): void {
  const track = document.querySelector('.pipeline-canvas-track')
  if (!(track instanceof HTMLElement) || !draft.value) return
  const trackRect = track.getBoundingClientRect()
  const nextPaths: { id: string; d: string; status: string }[] = []
  for (const node of draft.value.nodes) {
    for (const [mappingIndex, mapping] of (node.inputMappings ?? []).entries()) {
      const sourceKey = mapping.source === 'pipeline-input'
        ? `source:${draft.value.nodes[0]?.id}:${(mapping.sourcePath ?? '').replace(`${draft.value.nodes[0]?.id}.`, '')}`
        : `output:${draft.value.nodes[Math.max(0, node.order - 1)]?.id}`
      const source = fieldPoint(sourceKey, trackRect, 'source')
      const target = fieldPoint(`target:${node.id}:${mapping.targetParam}`, trackRect, 'target')
      if (!source || !target) continue
      const dx = Math.max(70, (target.x - source.x) * 0.45)
      const nodeState = nodeStatus(node.id)
      const status = nodeState === 'error' ? 'error' : nodeState === 'running' ? 'running' : nodeState === 'success' ? 'success' : 'idle'
      nextPaths.push({ id: `${node.id}-${mappingIndex}`, d: `M ${source.x} ${source.y} C ${source.x + dx} ${source.y}, ${target.x - dx} ${target.y}, ${target.x} ${target.y}`, status })
    }
  }
  connectionPaths.value = nextPaths
}

function nodeStatus(nodeId: string): PipelineSession['status'] | 'idle' {
  return session.value?.nodes.find((item) => item.nodeId === nodeId)?.status ?? 'idle'
}

function connectorStatus(index: number): 'idle' | 'running' | 'success' | 'error' {
  if (!draft.value) return 'idle'
  const current = draft.value.nodes[index]
  const next = draft.value.nodes[index + 1]
  const currentStatus = nodeStatus(current.id)
  const nextStatus = nodeStatus(next.id)
  if (currentStatus === 'error' || nextStatus === 'error') return 'error'
  if (nextStatus === 'running') return 'running'
  if (currentStatus === 'success' && nextStatus === 'success') return 'success'
  return 'idle'
}

const aggregateParams = computed(() => {
  if (!draft.value) return []
  const node = draft.value.nodes[0]
  return node ? (scriptFor(node)?.paramSchema ?? []).map((field) => ({ ...field, key: `${node.id}.${field.key}`, label: field.label })) : []
})

async function save(): Promise<void> {
  if (!draft.value || !draft.value.name.trim() || !draft.value.nodes.length) {
    error.value = '请填写流水线名称并至少添加一个脚本节点'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const payload = { name: draft.value.name, description: draft.value.description, nodes: cloneForIpc(draft.value.nodes) }
    const saved = draft.value.id
      ? await window.autoforge.pipelines.update(draft.value.id, payload)
      : await window.autoforge.pipelines.create(payload)
    draft.value = structuredClone(saved)
    selectedId.value = saved.id
    await load()
    emit('refresh')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function run(): Promise<void> {
  if (!draft.value?.id) {
    await save()
    if (!draft.value?.id) return
  }
  try {
    await window.autoforge.pipelines.setValues(draft.value.id, currentEnvId.value, {
      config: cloneForIpc(runtimeConfig.value),
      params: cloneForIpc(runtimeValues.value)
    })
    session.value = await window.autoforge.pipelines.start(
      draft.value.id,
      currentEnvId.value,
      cloneForIpc(runtimeValues.value)
    )
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function removePipeline(): Promise<void> {
  if (!draft.value?.id || !confirm(`确定删除流水线“${draft.value.name}”吗？`)) return
  await window.autoforge.pipelines.delete(draft.value.id)
  await load()
  createNew()
}

async function stop(): Promise<void> {
  if (!session.value || session.value.status !== 'running') return
  session.value = await window.autoforge.pipelines.stop(session.value.id)
}

let offSession: (() => void) | undefined
let offResize: (() => void) | undefined
watch(() => props.open, (open) => { if (open) void load() })
watch(() => JSON.stringify(draft.value?.nodes), () => void nextTick(measureConnections))
watch(canvasScale, () => void nextTick(measureConnections))
watch([leftCollapsed, rightCollapsed], () => void nextTick(measureConnections))
onMounted(() => {
  offSession = window.autoforge.pipelines.onSession((next) => {
    if (next.id === session.value?.id) {
      session.value = next
      void nextTick(measureConnections)
    }
  })
  const handleResize = (): void => measureConnections()
  window.addEventListener('resize', handleResize)
  offResize = () => window.removeEventListener('resize', handleResize)
})
onUnmounted(() => {
  offSession?.()
  offResize?.()
})
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6">
    <section class="w-full max-w-[calc(100vw-48px)] h-[calc(100vh-48px)] rounded-2xl border sb-border sb-bg-panel shadow-2xl overflow-hidden flex flex-col">
      <header class="h-14 px-5 border-b sb-border-subtle flex items-center gap-3 shrink-0">
        <Workflow class="w-5 h-5 text-[var(--sb-accent-solid)]" />
        <div class="flex-1">
          <h2 class="text-[15px] font-semibold sb-text-primary">流水线</h2>
          <p class="text-[11px] sb-text-faint">串联已有脚本，逐步传递结果</p>
        </div>
        <div class="workflow-top-actions"><button class="workflow-top-action" :disabled="saving" @click="save"><Save class="w-3.5 h-3.5" />保存</button><button v-if="session?.status === 'running'" class="workflow-top-action is-danger" @click="stop">停止</button><button v-else class="workflow-top-action is-primary" @click="run"><Play class="w-3.5 h-3.5" />运行</button></div>
        <button class="sb-icon-btn" title="关闭" @click="emit('close')"><X class="w-4 h-4" /></button>
      </header>
      <div class="flex flex-1 min-h-0">
        <aside class="workflow-sidebar border-r sb-border-subtle p-4 flex flex-col gap-3 min-h-0 bg-[color-mix(in_srgb,var(--sb-bg-panel)_92%,transparent)]" :class="leftCollapsed && 'is-collapsed'">
          <button class="workflow-collapse-button" :title="leftCollapsed ? '展开左侧栏' : '收起左侧栏'" @click="leftCollapsed = !leftCollapsed"><PanelLeftOpen v-if="leftCollapsed" class="w-4 h-4" /><PanelLeftClose v-else class="w-4 h-4" /></button>
          <button class="h-8 rounded-lg sb-btn-accent text-[12px] flex items-center justify-center gap-1.5" @click="createNew"><Plus class="w-3.5 h-3.5" />新建流水线</button>
          <div class="flex-1 min-h-0 overflow-y-auto space-y-1">
            <button v-for="item in pipelines" :key="item.id" class="w-full text-left px-3 py-2 rounded-lg text-[12px]" :class="item.id === selectedId ? 'sb-nav-active sb-text-primary' : 'sb-text-muted hover:sb-bg-hover'" @click="selectPipeline(item)">
              {{ item.name }}
              <span class="block text-[10px] sb-text-faint mt-0.5">{{ item.nodes.length }}个节点</span>
            </button>
            <p v-if="!pipelines.length" class="text-[11px] sb-text-faint px-2 py-4">还没有流水线</p>
          </div>
          <div class="workflow-library">
            <div class="workflow-pane-heading"><span>节点库</span><span class="workflow-pane-count">{{ filteredScripts.length }}</span></div>
            <input v-model="search" class="sb-input workflow-library-search" placeholder="搜索脚本" />
            <div class="workflow-library-list">
              <button v-for="script in filteredScripts" :key="script.id" draggable="true" class="workflow-library-item" @click="addNode(script.id)" @dragstart="onScriptDragStart($event, script.id)">
                <span class="workflow-library-icon"><Workflow class="w-3.5 h-3.5" /></span><span class="truncate">{{ script.name }}</span><Plus class="w-3.5 h-3.5 ml-auto" />
              </button>
              <span v-if="!filteredScripts.length" class="workflow-library-empty">没有匹配脚本</span>
            </div>
          </div>
        </aside>
        <main v-if="draft" class="flex-1 min-w-0 min-h-0 overflow-y-auto p-6 space-y-5">
          <div class="flex items-start gap-3">
            <div class="flex-1">
              <input v-model="draft.name" class="w-full bg-transparent text-xl font-semibold sb-text-primary outline-none border-b sb-border-subtle pb-1" placeholder="流水线名称" />
              <input v-model="draft.description" class="w-full mt-2 bg-transparent text-[12px] sb-text-muted outline-none" placeholder="描述（可选）" />
            </div>
            <button v-if="draft.id" class="sb-icon-btn text-rose-400" title="删除" @click="removePipeline"><Trash2 class="w-4 h-4" /></button>
          </div>
          <div class="pipeline-canvas-shell rounded-xl border sb-border-subtle sb-bg-inset p-4">
            <div class="flex items-center justify-between mb-3">
              <div>
                <h3 class="text-[12px] font-semibold sb-text-primary">执行节点</h3>
                <p class="text-[10px] sb-text-faint mt-1">拖动画布浏览 · 节点按顺序执行</p>
              </div>
              <div class="pipeline-canvas-tools">
                <span class="pipeline-canvas-hint">Workflow canvas</span>
                <button class="pipeline-tool-button" :class="showGrid && 'is-active'" title="切换网格" @click="showGrid = !showGrid">网格</button>
                <button class="pipeline-tool-button" title="适配画布" @click="fitCanvasView">适配</button>
                <button class="pipeline-tool-button" title="重置视图" @click="resetCanvasView">重置</button>
                <span class="pipeline-tool-divider"></span>
                <button class="pipeline-zoom-button" title="缩小画布" @click="setCanvasScale(-0.1)">−</button>
                <span class="pipeline-zoom-value">{{ Math.round(canvasScale * 100) }}%</span>
                <button class="pipeline-zoom-button" title="放大画布" @click="setCanvasScale(0.1)">＋</button>
              </div>
            </div>
            <div
              ref="canvasRef"
              class="pipeline-canvas"
              :class="[isPanning && 'is-panning', !showGrid && 'no-grid']"
              tabindex="0"
              @wheel="onCanvasWheel"
              @keydown="onCanvasKeydown"
              @dragover.prevent
              @drop="onCanvasDrop"
              @pointerdown="onCanvasPointerDown"
              @pointermove="onCanvasPointerMove"
              @pointerup="onCanvasPointerUp"
              @pointercancel="onCanvasPointerUp"
            >
              <div v-if="!draft.nodes.length" class="pipeline-canvas-empty">从右侧选择脚本，开始搭建流水线</div>
              <div v-else class="pipeline-canvas-track" :style="{ zoom: canvasScale }">
                <svg class="workflow-connections" :width="Math.max(900, draft.nodes.length * 440)" height="560" aria-hidden="true">
                  <defs>
                    <filter id="workflow-line-glow"><feGaussianBlur stdDeviation="2.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  </defs>
                  <g v-for="connection in connectionPaths" :key="connection.id" class="workflow-connection" :class="`is-${connection.status}`">
                    <path class="workflow-connection-halo" :d="connection.d" />
                    <path class="workflow-connection-line" :d="connection.d" />
                    <circle v-if="connection.status === 'running'" class="workflow-connection-particle"><animateMotion dur="1.2s" repeatCount="indefinite" :path="connection.d" /></circle>
                    <circle v-if="connection.status === 'running'" class="workflow-connection-particle is-delayed"><animateMotion dur="1.2s" begin="-.58s" repeatCount="indefinite" :path="connection.d" /></circle>
                  </g>
                </svg>
                <template v-for="(node, index) in draft.nodes" :key="node.id">
                  <article class="pipeline-node-card" :class="[`is-${nodeStatus(node.id)}`, selectedNodeId === node.id && 'is-selected', session?.currentNodeId === node.id && 'is-current']" @click="selectNode(node)">
                    <div class="pipeline-node-glow"></div>
                    <div class="relative flex items-start gap-2">
                      <span class="pipeline-node-index">{{ index + 1 }}</span>
                      <div class="min-w-0 flex-1">
                        <input v-model="node.name" class="pipeline-node-name" aria-label="节点名称" />
                        <p class="pipeline-node-script truncate">{{ scriptFor(node)?.name }}</p>
                      </div>
                      <span class="pipeline-node-status-dot" :title="nodeStatus(node.id)"></span>
                    </div>
                    <div class="pipeline-node-actions">
                      <button class="sb-icon-btn" title="左移" @click="moveNode(index, -1)"><ArrowUp class="w-3.5 h-3.5 -rotate-90" /></button>
                      <button class="sb-icon-btn" title="右移" @click="moveNode(index, 1)"><ArrowDown class="w-3.5 h-3.5 -rotate-90" /></button>
                      <button class="sb-icon-btn text-rose-400" title="删除" @click="removeNode(index)"><Trash2 class="w-3.5 h-3.5" /></button>
                    </div>
                    <div class="pipeline-field-links">
                      <div v-if="index === 0" class="pipeline-field-group">
                        <span class="pipeline-field-group-label">输入字段</span>
                        <button
                          v-for="field in nodeParamFields(node)"
                          :key="field.key"
                          class="pipeline-field-chip is-source"
                          :ref="(element) => setFieldRef(`source:${node.id}:${field.key}`, element)"
                          draggable="true"
                          @dragstart="startFieldDrag($event, { source: 'pipeline-input', sourcePath: `${node.id}.${field.key}` })"
                        >{{ field.label }}<span class="pipeline-port"></span></button>
                      </div>
                      <div v-else class="pipeline-field-group">
                        <span class="pipeline-field-group-label">可连接参数</span>
                        <div
                          v-for="field in nodeParamFields(node)"
                          :key="field.key"
                          class="pipeline-param-drop"
                          :ref="(element) => setFieldRef(`target:${node.id}:${field.key}`, element)"
                          @dragover.prevent
                          @drop="dropFieldMapping($event, node, field.key)"
                        >
                          <span class="pipeline-param-drop-label">{{ field.label }}</span>
                          <input :value="fixedParamValue(node, field.key)" class="pipeline-fixed-param" :placeholder="`固定值 · ${field.key}`" @input="onFixedParamInput($event, node, field.key)" />
                          <span class="pipeline-port is-target"></span>
                        </div>
                      </div>
                      <button
                        class="pipeline-result-source"
                        :ref="(element) => setFieldRef(`output:${node.id}`, element)"
                        draggable="true"
                        @dragstart="startFieldDrag($event, { source: 'previous-result' })"
                      >拖拽完整输出 <span class="pipeline-port"></span></button>
                    </div>
                    <div class="pipeline-mappings">
                      <div v-for="(mapping, mappingIndex) in node.inputMappings" :key="mappingIndex" class="pipeline-mapping-row">
                        <select v-model="mapping.source" class="sb-input pipeline-mapping-source"><option value="previous-result">上一步</option><option value="pipeline-input">流水线输入</option></select>
                        <select v-if="mapping.source === 'pipeline-input'" v-model="mapping.sourcePath" class="sb-input pipeline-mapping-path"><option v-for="field in aggregateParams" :key="field.key" :value="field.key">{{ field.label }}</option></select>
                        <input v-else v-model="mapping.sourcePath" class="sb-input pipeline-mapping-path" placeholder="结果字段路径" />
                        <select v-model="mapping.targetParam" class="sb-input pipeline-mapping-target"><option v-for="field in nodeParamFields(node)" :key="field.key" :value="field.key">{{ field.label }}</option></select>
                        <button class="sb-icon-btn" title="删除映射" @click="removeMapping(node, mappingIndex)"><X class="w-3 h-3" /></button>
                      </div>
                      <button class="pipeline-add-mapping" @click="addMapping(node)">+ 添加输入映射</button>
                    </div>
                  </article>
                  <div v-if="index < draft.nodes.length - 1" class="pipeline-connector" :class="`is-${connectorStatus(index)}`" aria-hidden="true">
                    <svg class="pipeline-connector-svg" viewBox="0 0 132 72" preserveAspectRatio="none">
                      <defs>
                        <linearGradient :id="`connector-gradient-${index}`" x1="0" x2="1">
                          <stop offset="0" stop-color="currentColor" stop-opacity="0.1" />
                          <stop offset="0.52" stop-color="currentColor" stop-opacity="0.95" />
                          <stop offset="1" stop-color="currentColor" stop-opacity="0.35" />
                        </linearGradient>
                      </defs>
                      <path class="pipeline-connector-shadow" d="M 4 36 C 35 36, 94 36, 124 36" />
                      <path class="pipeline-connector-path" :class="`is-${connectorStatus(index)}`" :d="`M 4 36 C 35 36, 94 36, 124 36`" :style="{ stroke: `url(#connector-gradient-${index})` }" />
                      <path class="pipeline-connector-head" d="M 116 28 L 126 36 L 116 44" />
                      <circle v-if="connectorStatus(index) === 'running'" class="pipeline-connector-particle" r="3"><animateMotion dur="1.15s" repeatCount="indefinite" path="M 4 36 C 35 36, 94 36, 124 36" /></circle>
                      <circle v-if="connectorStatus(index) === 'running'" class="pipeline-connector-particle is-delayed" r="2"><animateMotion dur="1.15s" begin="-.56s" repeatCount="indefinite" path="M 4 36 C 35 36, 94 36, 124 36" /></circle>
                    </svg>
                  </div>
                </template>
              </div>
            </div>
          </div>
          <div v-if="false" class="rounded-xl border sb-border-subtle sb-bg-inset p-4">
            <div class="flex items-center justify-between mb-3"><h3 class="text-[12px] font-semibold sb-text-primary">执行节点</h3><span class="text-[11px] sb-text-faint">按顺序执行</span></div>
            <div v-if="!draft.nodes.length" class="py-8 text-center text-[12px] sb-text-faint">从右侧选择脚本添加节点</div>
            <div v-for="(node, index) in draft.nodes" :key="node.id" class="rounded-xl border sb-border-subtle sb-bg-panel p-3 mb-2">
              <div class="flex items-center gap-2"><span class="w-6 h-6 rounded-full bg-[var(--sb-accent-solid)]/15 text-[var(--sb-accent-solid)] flex items-center justify-center text-[11px] font-semibold">{{ index + 1 }}</span><input v-model="node.name" class="flex-1 bg-transparent text-[13px] font-medium sb-text-primary outline-none" /><span class="text-[10px] sb-text-faint">{{ scriptFor(node)?.name }}</span><button class="sb-icon-btn" @click="moveNode(index, -1)"><ArrowUp class="w-3.5 h-3.5" /></button><button class="sb-icon-btn" @click="moveNode(index, 1)"><ArrowDown class="w-3.5 h-3.5" /></button><button class="sb-icon-btn text-rose-400" @click="removeNode(index)"><Trash2 class="w-3.5 h-3.5" /></button></div>
              <div class="mt-3 pl-8 space-y-2">
                <div v-for="(mapping, mappingIndex) in node.inputMappings" :key="mappingIndex" class="grid grid-cols-[120px_1fr_140px_28px] gap-2 items-center"><select v-model="mapping.source" class="sb-input rounded-md text-[11px] h-7 px-2"><option value="previous-result">上一步结果</option><option value="pipeline-input">流水线输入</option></select><input v-model="mapping.sourcePath" class="sb-input rounded-md text-[11px] h-7 px-2" placeholder="字段路径" /><input v-model="mapping.targetParam" class="sb-input rounded-md text-[11px] h-7 px-2" placeholder="目标参数 key" /><button class="sb-icon-btn" @click="removeMapping(node, mappingIndex)"><X class="w-3.5 h-3.5" /></button></div>
                <button class="text-[11px] text-[var(--sb-accent-solid)] hover:underline" @click="addMapping(node)">+添加输入映射</button>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="rounded-xl border sb-border-subtle p-4"><div class="flex items-center justify-between mb-3"><h3 class="text-[12px] font-semibold sb-text-primary">流水线输入参数</h3><select v-model="currentEnvId" class="sb-input h-7 rounded-md text-[11px] px-2"><option v-for="environment in environments" :key="environment.id" :value="environment.id">{{ environment.name }}</option></select></div><p class="text-[10px] sb-text-faint mb-3">仅首个脚本的参数作为流水线输入</p><div v-if="!aggregateParams.length" class="text-[11px] sb-text-faint">首个脚本没有声明参数</div><label v-for="field in aggregateParams" :key="field.key" class="block mb-3"><span class="block text-[11px] sb-text-muted mb-1">{{ field.label }}</span><input v-model="runtimeValues[field.key]" class="sb-input w-full h-8 rounded-md text-[12px] px-2" :placeholder="field.key" /></label><h3 v-if="draft.envSchema.length" class="text-[12px] font-semibold sb-text-primary mt-5 mb-3">全部节点环境配置</h3><p v-if="draft.envSchema.length" class="text-[10px] sb-text-faint mb-3">当前环境会统一应用到所有脚本节点</p><label v-for="field in draft.envSchema" :key="field.key" class="block mb-3"><span class="block text-[11px] sb-text-muted mb-1">{{ field.label }}</span><input v-model="runtimeConfig[field.key]" class="sb-input w-full h-8 rounded-md text-[12px] px-2" :placeholder="field.key" /></label></div>
            <div class="rounded-xl border sb-border-subtle p-4"><h3 class="text-[12px] font-semibold sb-text-primary mb-3">可用脚本</h3><p class="text-[10px] sb-text-faint mb-2">点击添加，或拖到画布末尾</p><input v-model="search" class="sb-input w-full h-8 rounded-md text-[12px] px-2 mb-2" placeholder="搜索脚本" /><div class="max-h-48 overflow-y-auto space-y-1"><button v-for="script in filteredScripts" :key="script.id" draggable="true" class="w-full text-left px-2.5 py-2 rounded-md sb-text-muted hover:sb-bg-hover text-[12px] flex items-center justify-between" @click="addNode(script.id)" @dragstart="onScriptDragStart($event, script.id)"><span>{{ script.name }}</span><Plus class="w-3.5 h-3.5" /></button></div></div>
          </div>
          <div v-if="error" class="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-[12px] text-rose-400">{{ error }}</div>
          <div v-if="session" class="rounded-xl border sb-border-subtle p-4"><div class="flex items-center justify-between mb-3"><h3 class="text-[12px] font-semibold sb-text-primary">运行状态</h3><span class="text-[11px]">{{ session.status }}</span></div><div class="space-y-1.5"><div v-for="node in session.nodes" :key="node.nodeId" class="flex items-center gap-2 text-[11px] sb-text-muted"><Check v-if="node.status === 'success'" class="w-3.5 h-3.5 text-emerald-400" /><span v-else class="w-3.5 h-3.5 rounded-full border sb-border-subtle"></span>{{ draft.nodes.find((item) => item.id === node.nodeId)?.name }}</div></div></div>
          <footer class="flex items-center justify-end gap-2"><button class="h-8 px-3 rounded-lg sb-btn-ghost text-[12px]" @click="emit('close')">关闭</button><button class="h-8 px-3 rounded-lg sb-btn-ghost text-[12px] flex items-center gap-1.5" :disabled="saving" @click="save"><Save class="w-3.5 h-3.5" />{{ saving ? '保存中' : '保存' }}</button><button v-if="session?.status === 'running'" class="h-8 px-3 rounded-lg bg-rose-500/10 text-rose-400 text-[12px]" @click="stop">停止</button><button v-else class="h-8 px-3 rounded-lg sb-btn-accent text-[12px] flex items-center gap-1.5" @click="run"><Play class="w-3.5 h-3.5" />运行流水线</button></footer>
        </main>
        <aside v-if="draft" class="workflow-inspector" :class="rightCollapsed && 'is-collapsed'">
          <button class="workflow-collapse-button workflow-collapse-button--right" :title="rightCollapsed ? '展开右侧栏' : '收起右侧栏'" @click="rightCollapsed = !rightCollapsed"><PanelRightOpen v-if="rightCollapsed" class="w-4 h-4" /><PanelRightClose v-else class="w-4 h-4" /></button>
          <div v-if="!rightCollapsed" class="workflow-inspector-head"><div><span class="workflow-eyebrow">Inspector</span><h3>节点属性</h3></div><button v-if="selectedNode" class="sb-icon-btn text-rose-400" title="删除节点" @click="removeNode(draft.nodes.findIndex((node) => node.id === selectedNode.id))"><Trash2 class="w-4 h-4" /></button></div>
          <div v-if="!rightCollapsed && selectedNode" class="workflow-inspector-body">
            <div class="workflow-inspector-node"><span class="pipeline-node-index">{{ selectedNode.order + 1 }}</span><div><strong>{{ selectedNode.name }}</strong><small>{{ scriptFor(selectedNode)?.name }}</small></div></div>
            <label class="workflow-field-label">节点名称<input v-model="selectedNode.name" class="sb-input workflow-inspector-input" /></label>
            <div class="workflow-inspector-section"><div class="workflow-section-title">固定参数</div><div v-if="!nodeParamFields(selectedNode).length" class="workflow-inspector-empty">该脚本没有参数</div><label v-for="field in nodeParamFields(selectedNode)" :key="field.key" class="workflow-field-label">{{ field.label }}<input :value="fixedParamValue(selectedNode, field.key)" class="sb-input workflow-inspector-input" :placeholder="`固定值 · ${field.key}`" @input="onFixedParamInput($event, selectedNode, field.key)" /></label></div>
            <div class="workflow-inspector-section"><div class="workflow-section-title">输入映射 <span>{{ selectedNode.inputMappings?.length ?? 0 }}</span></div><div v-for="(mapping, mappingIndex) in selectedNode.inputMappings" :key="mappingIndex" class="workflow-inspector-mapping"><select v-model="mapping.source" class="sb-input"><option value="previous-result">上一步结果</option><option value="pipeline-input">流水线输入</option></select><input v-model="mapping.sourcePath" class="sb-input" placeholder="字段路径" /><select v-model="mapping.targetParam" class="sb-input"><option v-for="field in nodeParamFields(selectedNode)" :key="field.key" :value="field.key">{{ field.label }}</option></select><button class="sb-icon-btn text-rose-400" @click="removeMapping(selectedNode, mappingIndex)"><X class="w-3.5 h-3.5" /></button></div><button class="workflow-add-mapping" @click="addMapping(selectedNode)">+ 添加映射</button></div>
          </div>
          <div v-else-if="!rightCollapsed" class="workflow-inspector-empty workflow-inspector-empty--large">点击画布中的节点查看属性</div>
        </aside>
        <div v-else class="flex-1 flex items-center justify-center text-[12px] sb-text-faint">请选择或新建流水线</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pipeline-canvas-shell {
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--sb-accent-solid) 10%, transparent), transparent 36%),
    var(--sb-bg-inset);
}

.workflow-top-actions { display: flex; align-items: center; gap: 7px; }
.workflow-sidebar { position: relative; width: 250px; flex: 0 0 250px; transition: width 200ms ease, flex-basis 200ms ease, padding 200ms ease; }
.workflow-sidebar.is-collapsed { width: 48px; flex-basis: 48px; padding: 10px 8px; }
.workflow-sidebar.is-collapsed > :not(.workflow-collapse-button) { display: none; }
.workflow-collapse-button { display: grid; width: 28px; height: 28px; place-items: center; margin-left: auto; border: 1px solid var(--sb-border); border-radius: 8px; color: var(--sb-text-muted); transition: 160ms ease; }
.workflow-collapse-button:hover { color: var(--sb-accent-solid); border-color: color-mix(in srgb, var(--sb-accent-solid) 55%, var(--sb-border)); background: color-mix(in srgb, var(--sb-accent-solid) 8%, transparent); }
.workflow-top-action { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--sb-border); border-radius: 8px; color: var(--sb-text-secondary); font-size: 11px; transition: 160ms ease; }
.workflow-top-action:hover { border-color: color-mix(in srgb, var(--sb-accent-solid) 60%, var(--sb-border)); color: var(--sb-text-primary); }
.workflow-top-action.is-primary { border-color: transparent; color: white; background: var(--sb-accent-solid); box-shadow: 0 8px 18px color-mix(in srgb, var(--sb-accent-solid) 24%, transparent); }
.workflow-top-action.is-danger { color: #f43f5e; border-color: color-mix(in srgb, #f43f5e 35%, var(--sb-border)); }
.workflow-pane-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: var(--sb-text-primary); font-size: 11px; font-weight: 650; }
.workflow-pane-count { min-width: 19px; padding: 2px 6px; border-radius: 99px; color: var(--sb-accent-solid); font-size: 9px; text-align: center; background: color-mix(in srgb, var(--sb-accent-solid) 12%, transparent); }
.workflow-library { flex: 0 0 38%; min-height: 220px; padding-top: 14px; border-top: 1px solid var(--sb-border-subtle); }
.workflow-library-search { width: 100%; height: 30px; margin-bottom: 8px; padding: 0 9px; font-size: 11px; }
.workflow-library-list { display: grid; max-height: 310px; gap: 4px; overflow-y: auto; }
.workflow-library-item { display: flex; align-items: center; gap: 7px; min-height: 34px; padding: 5px 7px; border: 1px solid transparent; border-radius: 8px; color: var(--sb-text-secondary); font-size: 10px; text-align: left; transition: 150ms ease; }
.workflow-library-item:hover { border-color: color-mix(in srgb, var(--sb-accent-solid) 40%, var(--sb-border)); color: var(--sb-text-primary); background: color-mix(in srgb, var(--sb-accent-solid) 8%, transparent); }
.workflow-library-icon { display: grid; width: 23px; height: 23px; flex: 0 0 23px; place-items: center; border-radius: 7px; color: var(--sb-accent-solid); background: color-mix(in srgb, var(--sb-accent-solid) 12%, transparent); }
.workflow-library-empty { padding: 16px 4px; color: var(--sb-text-faint); font-size: 10px; }
.workflow-inspector { display: flex; width: 330px; flex: 0 0 330px; flex-direction: column; min-height: 0; border-left: 1px solid var(--sb-border-subtle); background: color-mix(in srgb, var(--sb-bg-panel) 94%, transparent); }
.workflow-inspector.is-collapsed { width: 48px; flex-basis: 48px; align-items: center; padding-top: 10px; }
.workflow-collapse-button--right { margin-left: 0; }
.workflow-inspector-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 18px 15px; border-bottom: 1px solid var(--sb-border-subtle); }
.workflow-eyebrow { color: var(--sb-accent-solid); font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }
.workflow-inspector-head h3 { margin-top: 5px; color: var(--sb-text-primary); font-size: 15px; font-weight: 680; }
.workflow-inspector-body { display: flex; min-height: 0; flex-direction: column; gap: 16px; padding: 18px; overflow-y: auto; }
.workflow-inspector-node { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid color-mix(in srgb, var(--sb-accent-solid) 28%, var(--sb-border)); border-radius: 12px; background: color-mix(in srgb, var(--sb-accent-solid) 6%, transparent); }
.workflow-inspector-node strong { display: block; color: var(--sb-text-primary); font-size: 13px; }
.workflow-inspector-node small { display: block; margin-top: 3px; color: var(--sb-text-faint); font-size: 10px; }
.workflow-field-label { display: grid; gap: 7px; color: var(--sb-text-muted); font-size: 10px; }
.workflow-inspector-input { width: 100%; height: 31px; padding: 0 9px; font-size: 11px; }
.workflow-inspector-section { display: grid; gap: 10px; padding-top: 15px; border-top: 1px solid var(--sb-border-subtle); }
.workflow-section-title { display: flex; justify-content: space-between; color: var(--sb-text-primary); font-size: 11px; font-weight: 650; }
.workflow-section-title span { color: var(--sb-text-faint); font-size: 10px; font-weight: 400; }
.workflow-inspector-mapping { display: grid; grid-template-columns: 1fr 1fr 1fr 26px; gap: 5px; align-items: center; }
.workflow-inspector-mapping .sb-input { min-width: 0; height: 28px; padding: 0 5px; font-size: 9px; }
.workflow-add-mapping { color: var(--sb-accent-solid); font-size: 10px; text-align: left; }
.workflow-add-mapping:hover { text-decoration: underline; }
.workflow-inspector-empty { color: var(--sb-text-faint); font-size: 10px; }
.workflow-inspector-empty--large { display: grid; flex: 1; place-items: center; padding: 20px; text-align: center; }

.pipeline-canvas-hint {
  color: color-mix(in srgb, var(--sb-accent-solid) 70%, var(--sb-text-muted));
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.pipeline-canvas-tools { display: flex; align-items: center; gap: 6px; }
.pipeline-tool-button { height: 25px; padding: 0 9px; border: 1px solid color-mix(in srgb, var(--sb-border) 72%, transparent); border-radius: 7px; color: var(--sb-text-muted); font-size: 10px; transition: 160ms ease; }
.pipeline-tool-button:hover, .pipeline-tool-button.is-active { border-color: color-mix(in srgb, var(--sb-accent-solid) 58%, var(--sb-border)); color: var(--sb-accent-solid); background: color-mix(in srgb, var(--sb-accent-solid) 9%, transparent); }
.pipeline-tool-divider { width: 1px; height: 17px; margin: 0 3px; background: var(--sb-border); }
.pipeline-zoom-button { display: grid; width: 23px; height: 23px; place-items: center; border: 1px solid color-mix(in srgb, var(--sb-border) 75%, transparent); border-radius: 7px; color: var(--sb-text-muted); font-size: 14px; line-height: 1; }
.pipeline-zoom-button:hover { color: var(--sb-text-primary); border-color: color-mix(in srgb, var(--sb-accent-solid) 55%, var(--sb-border)); background: color-mix(in srgb, var(--sb-accent-solid) 10%, transparent); }
.pipeline-zoom-value { min-width: 37px; color: var(--sb-text-muted); font-size: 10px; text-align: center; font-variant-numeric: tabular-nums; }

.pipeline-canvas {
  position: relative;
  min-height: 560px;
  overflow-x: auto;
  overflow-y: auto;
  border: 1px solid color-mix(in srgb, var(--sb-border) 80%, transparent);
  border-radius: 14px;
  cursor: grab;
  scrollbar-width: thin;
  background-color: color-mix(in srgb, var(--sb-bg-panel) 92%, transparent);
  background-image: radial-gradient(color-mix(in srgb, var(--sb-text-faint) 20%, transparent) 1px, transparent 1px);
  background-size: 18px 18px;
}

.pipeline-canvas:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--sb-accent-solid) 65%, transparent);
  outline-offset: 2px;
}

.pipeline-canvas.no-grid { background-image: none; }

.pipeline-canvas.is-panning {
  cursor: grabbing;
  user-select: none;
}

.pipeline-canvas-track {
  position: relative;
  display: flex;
  align-items: center;
  width: max-content;
  min-width: 100%;
  min-height: 560px;
  padding: 76px 84px;
}

.workflow-connections { position: absolute; inset: 0 auto auto 0; z-index: 1; overflow: visible; pointer-events: none; }
.workflow-connection { color: color-mix(in srgb, var(--sb-accent-solid) 70%, white); }
.workflow-connection-line, .workflow-connection-halo { fill: none; stroke-linecap: round; }
.workflow-connection-line { stroke: currentColor; stroke-width: 2; stroke-dasharray: 7 7; animation: workflow-dash 1.5s linear infinite; }
.workflow-connection-halo { stroke: currentColor; stroke-width: 10; opacity: .1; filter: url(#workflow-line-glow); }
.workflow-connection.is-success { color: #22c55e; }
.workflow-connection.is-success .workflow-connection-line { stroke-dasharray: none; animation: none; }
.workflow-connection.is-error { color: #f43f5e; }
.workflow-connection.is-error .workflow-connection-line { stroke-dasharray: 4 6; }
.workflow-connection-particle { fill: currentColor; filter: drop-shadow(0 0 7px currentColor); }
.workflow-connection-particle.is-delayed { opacity: .55; }
@keyframes workflow-dash { to { stroke-dashoffset: -28; } }

.pipeline-canvas-empty {
  display: grid;
  min-height: 560px;
  place-items: center;
  color: var(--sb-text-faint);
  font-size: 12px;
}

.pipeline-node-card {
  position: relative;
  flex: 0 0 340px;
  min-height: 342px;
  overflow: hidden;
  padding: 21px;
  border: 1px solid color-mix(in srgb, var(--sb-border) 90%, transparent);
  border-radius: 20px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--sb-bg-panel) 98%, white), var(--sb-bg-panel));
  box-shadow: 0 20px 44px color-mix(in srgb, #000 10%, transparent), inset 0 1px 0 color-mix(in srgb, white 24%, transparent);
  transition: border-color 220ms ease, box-shadow 220ms ease, transform 220ms ease;
}

.pipeline-node-card:hover,
.pipeline-node-card.is-current {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--sb-accent-solid) 62%, var(--sb-border));
  box-shadow: 0 18px 36px color-mix(in srgb, var(--sb-accent-solid) 13%, transparent);
}

.pipeline-node-card.is-success { border-color: color-mix(in srgb, #22c55e 58%, var(--sb-border)); }
.pipeline-node-card.is-error { border-color: color-mix(in srgb, #f43f5e 72%, var(--sb-border)); }
.pipeline-node-card.is-running { border-color: color-mix(in srgb, var(--sb-accent-solid) 80%, var(--sb-border)); }

.pipeline-node-glow {
  position: absolute;
  inset: -55% 25% auto;
  height: 120px;
  pointer-events: none;
  background: radial-gradient(circle, color-mix(in srgb, var(--sb-accent-solid) 18%, transparent), transparent 70%);
  opacity: 0;
  transition: opacity 220ms ease;
}

.pipeline-node-card.is-running .pipeline-node-glow,
.pipeline-node-card.is-current .pipeline-node-glow { opacity: 1; animation: pipeline-glow 2.6s ease-in-out infinite; }

.pipeline-node-index {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 10px;
  color: var(--sb-accent-solid);
  font-size: 12px;
  font-weight: 700;
  background: color-mix(in srgb, var(--sb-accent-solid) 14%, transparent);
}

.pipeline-node-name {
  width: 100%;
  padding: 2px 0;
  border: 0;
  outline: 0;
  color: var(--sb-text-primary);
  font-size: 16px;
  font-weight: 680;
  background: transparent;
}

.pipeline-node-script { margin-top: 5px; color: var(--sb-text-faint); font-size: 11px; }
.pipeline-node-status-dot { width: 7px; height: 7px; margin-top: 5px; border-radius: 999px; background: var(--sb-text-faint); }
.pipeline-node-card.is-running .pipeline-node-status-dot { background: var(--sb-accent-solid); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sb-accent-solid) 14%, transparent); animation: pipeline-pulse 1.4s ease-in-out infinite; }
.pipeline-node-card.is-success .pipeline-node-status-dot { background: #22c55e; }
.pipeline-node-card.is-error .pipeline-node-status-dot { background: #f43f5e; }

.pipeline-node-actions { display: flex; justify-content: flex-end; gap: 3px; margin-top: 19px; padding-bottom: 3px; border-bottom: 1px solid color-mix(in srgb, var(--sb-border) 75%, transparent); }
.pipeline-field-links { display: grid; gap: 7px; margin-top: 8px; }
.pipeline-field-group { display: grid; gap: 5px; }
.pipeline-field-group-label { color: var(--sb-text-faint); font-size: 9px; letter-spacing: 0.04em; text-transform: uppercase; }
.pipeline-field-chip, .pipeline-result-source { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 25px; padding: 4px 7px; border: 1px dashed color-mix(in srgb, var(--sb-accent-solid) 42%, var(--sb-border)); border-radius: 7px; color: var(--sb-text-secondary); font-size: 10px; text-align: left; background: color-mix(in srgb, var(--sb-accent-solid) 6%, transparent); }
.pipeline-field-chip:hover, .pipeline-result-source:hover { border-color: var(--sb-accent-solid); color: var(--sb-text-primary); cursor: grab; }
.pipeline-result-source { border-color: color-mix(in srgb, #22c55e 42%, var(--sb-border)); color: color-mix(in srgb, #22c55e 75%, var(--sb-text-secondary)); }
.pipeline-param-drop { display: grid; grid-template-columns: 74px minmax(0, 1fr) 7px; align-items: center; gap: 5px; min-height: 30px; padding: 3px 5px; border: 1px dashed color-mix(in srgb, var(--sb-border) 80%, transparent); border-radius: 7px; }
.pipeline-param-drop:hover { border-color: color-mix(in srgb, var(--sb-accent-solid) 70%, var(--sb-border)); background: color-mix(in srgb, var(--sb-accent-solid) 6%, transparent); }
.pipeline-param-drop-label { overflow: hidden; color: var(--sb-text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.pipeline-fixed-param { min-width: 0; height: 23px; padding: 0 5px; border: 1px solid color-mix(in srgb, var(--sb-border) 70%, transparent); border-radius: 5px; outline: none; color: var(--sb-text-secondary); font-size: 9px; background: color-mix(in srgb, var(--sb-bg-panel) 80%, transparent); }
.pipeline-fixed-param:focus { border-color: var(--sb-accent-solid); }
.pipeline-port { width: 6px; height: 6px; flex: 0 0 6px; border: 1px solid currentColor; border-radius: 999px; background: var(--sb-bg-panel); }
.pipeline-port.is-target { color: var(--sb-accent-solid); }
.pipeline-mappings { min-height: 32px; margin-top: 10px; padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--sb-border) 70%, transparent); }
.pipeline-mapping-row { display: grid; grid-template-columns: 58px minmax(0, 1fr) 78px 22px; gap: 4px; align-items: center; margin-bottom: 5px; }
.pipeline-mapping-source, .pipeline-mapping-path, .pipeline-mapping-target { min-width: 0; height: 25px; padding: 0 5px; font-size: 9px; }
.pipeline-add-mapping { color: var(--sb-accent-solid); font-size: 10px; }
.pipeline-add-mapping:hover { text-decoration: underline; }

.pipeline-connector { display: grid; width: 132px; height: 72px; flex: 0 0 132px; place-items: center; color: var(--sb-text-faint); }
.pipeline-connector-svg { width: 100%; height: 100%; overflow: visible; }
.pipeline-connector-shadow { fill: none; stroke: color-mix(in srgb, var(--sb-text-faint) 22%, transparent); stroke-width: 5; stroke-linecap: round; }
.pipeline-connector-path { fill: none; stroke: color-mix(in srgb, var(--sb-text-faint) 36%, transparent); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 6 7; }
.pipeline-connector-path.is-running { stroke-dasharray: 5 5; animation: connector-dash 1s linear infinite; }
.pipeline-connector-path.is-success { stroke: #22c55e; stroke-dasharray: none; }
.pipeline-connector-path.is-error { stroke: #f43f5e; stroke-dasharray: 4 5; }
.pipeline-connector-head { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pipeline-connector.is-running { color: var(--sb-accent-solid); }
.pipeline-connector.is-success { color: #22c55e; }
.pipeline-connector.is-error { color: #f43f5e; }
.pipeline-connector-particle { fill: color-mix(in srgb, var(--sb-accent-solid) 88%, white); filter: drop-shadow(0 0 7px color-mix(in srgb, var(--sb-accent-solid) 90%, transparent)); }
.pipeline-connector-particle.is-delayed { opacity: 0.7; }

@keyframes connector-dash { to { stroke-dashoffset: -20; } }
@keyframes pipeline-pulse { 50% { opacity: 0.48; transform: scale(0.72); } }
@keyframes pipeline-glow { 50% { transform: translateX(18px); opacity: 0.55; } }

@media (prefers-reduced-motion: reduce) {
  .pipeline-node-card, .pipeline-node-glow, .pipeline-connector-path, .pipeline-node-status-dot { animation: none !important; transition: none; }
}
</style>
