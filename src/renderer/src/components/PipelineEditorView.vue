<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronLeft, ChevronRight, Play, Plus, Save, Trash2, Workflow, X } from 'lucide-vue-next'
import { gsap } from 'gsap'
import type { EnvironmentProfile, LogLine, PipelineLogLine, PipelineMeta, PipelineNode, PipelineSession, ScriptMeta } from '../../../shared/types/script'
import { askConfirm } from '../composables/useConfirmDialog'
import { resolveScriptIcon } from '../lib/script-icon-map'

const props = defineProps<{ open: boolean; scripts: ScriptMeta[]; pipeline: PipelineMeta | null; initialSession?: PipelineSession | null }>()
const emit = defineEmits<{ close: []; back: []; saved: [pipeline: PipelineMeta]; deleted: [] }>()

const selectedNodeId = ref<string | null>(null)
const draft = ref<PipelineMeta | null>(props.pipeline ? cloneForIpc(props.pipeline) : null)
const lastSavedSnapshot = ref('')
const runtimeValues = ref<Record<string, string>>({})
const runtimeConfig = ref<Record<string, string>>({})
const persistedRuntimeValues = ref<Record<string, Record<string, string>>>({})
const persistedRuntimeConfig = ref<Record<string, Record<string, string>>>({})
const currentEnvId = ref('default')
const environments = ref<EnvironmentProfile[]>([])
const session = ref<PipelineSession | null>(null)
const pipelineLogs = ref<PipelineLogLine[]>([])
const saving = ref(false)
const error = ref('')
const search = ref('')
const canvasRef = ref<HTMLElement | null>(null)
const nameInputRef = ref<HTMLInputElement | null>(null)
const canvasSize = ref({ width: 1200, height: 700 })
const leftSidebarRef = ref<HTMLElement | null>(null)
const rightSidebarRef = ref<HTMLElement | null>(null)
const leftSidebarWidth = ref(250)
const rightSidebarWidth = ref(330)
const resizingPanel = ref<'left' | 'right' | null>(null)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartOffsetX = ref(0)
const panOffsetX = ref(0)
const panOffsetY = ref(0)
const canvasScale = ref(1)
const showGrid = ref(true)
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)
const runtimeDrawerOpen = ref(false)
const dragSource = ref<{ source: 'previous-result' | 'pipeline-input'; sourcePath?: string } | null>(null)
interface ConnectionDraft {
  sourceNodeId: string
  pointerX: number
  pointerY: number
}

const connectionDraft = ref<ConnectionDraft | null>(null)
const connectionPreviewPath = ref('')
const panStartY = ref(0)
const panStartOffsetY = ref(0)
const fieldRefs = new Map<string, HTMLElement>()
const connectionPaths = ref<{ id: string; d: string; status: string }[]>([])

const PIPELINE_LEFT_WIDTH_KEY = 'autoforge-pipeline-left-width'
const PIPELINE_RIGHT_WIDTH_KEY = 'autoforge-pipeline-right-width'
const PIPELINE_LEFT_MIN_WIDTH = 210
const PIPELINE_LEFT_MAX_WIDTH = 380
const PIPELINE_RIGHT_MIN_WIDTH = 280
const PIPELINE_RIGHT_MAX_WIDTH = 460

const canvasTrackStyle = computed(() => ({
  zoom: canvasScale.value,
  minWidth: `${Math.max(900, Math.ceil(canvasSize.value.width / canvasScale.value + 240))}px`,
  minHeight: `${Math.max(880, Math.ceil(canvasSize.value.height / canvasScale.value + 240))}px`,
  transform: `translate3d(${panOffsetX.value / canvasScale.value}px, ${panOffsetY.value / canvasScale.value}px, 0)`
}))

function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const filteredScripts = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return props.scripts.filter((script) => !keyword || script.name.toLowerCase().includes(keyword))
})

const selectedNode = computed(() => draft.value?.nodes.find((node) => node.id === selectedNodeId.value) ?? null)
const leftSidebarStyle = computed(() => ({
  width: `${leftCollapsed.value ? 48 : leftSidebarWidth.value}px`,
  flexBasis: `${leftCollapsed.value ? 48 : leftSidebarWidth.value}px`
}))
const rightSidebarStyle = computed(() => ({
  width: `${rightCollapsed.value ? 48 : rightSidebarWidth.value}px`,
  flexBasis: `${rightCollapsed.value ? 48 : rightSidebarWidth.value}px`
}))

function clampPipelinePanelWidth(side: 'left' | 'right', width: number): number {
  return side === 'left'
    ? Math.min(PIPELINE_LEFT_MAX_WIDTH, Math.max(PIPELINE_LEFT_MIN_WIDTH, width))
    : Math.min(PIPELINE_RIGHT_MAX_WIDTH, Math.max(PIPELINE_RIGHT_MIN_WIDTH, width))
}

function loadPipelinePanelWidths(): void {
  const storedLeft = Number(localStorage.getItem(PIPELINE_LEFT_WIDTH_KEY))
  const storedRight = Number(localStorage.getItem(PIPELINE_RIGHT_WIDTH_KEY))
  leftSidebarWidth.value = clampPipelinePanelWidth('left', Number.isFinite(storedLeft) && storedLeft > 0 ? storedLeft : 250)
  rightSidebarWidth.value = clampPipelinePanelWidth('right', Number.isFinite(storedRight) && storedRight > 0 ? storedRight : 330)
}

function onPipelinePanelResizeStart(side: 'left' | 'right', event: MouseEvent): void {
  event.preventDefault()
  resizingPanel.value = side
  const startX = event.clientX
  const startWidth = side === 'left' ? leftSidebarWidth.value : rightSidebarWidth.value

  const onMove = (moveEvent: MouseEvent): void => {
    const delta = moveEvent.clientX - startX
    const nextWidth = side === 'left' ? startWidth + delta : startWidth - delta
    if (side === 'left') leftSidebarWidth.value = clampPipelinePanelWidth(side, nextWidth)
    else rightSidebarWidth.value = clampPipelinePanelWidth(side, nextWidth)
    void nextTick(measureConnections)
  }

  const onUp = (): void => {
    resizingPanel.value = null
    localStorage.setItem(side === 'left' ? PIPELINE_LEFT_WIDTH_KEY : PIPELINE_RIGHT_WIDTH_KEY, String(side === 'left' ? leftSidebarWidth.value : rightSidebarWidth.value))
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function resetPipelinePanelWidth(side: 'left' | 'right'): void {
  const width = side === 'left' ? 250 : 330
  if (side === 'left') leftSidebarWidth.value = width
  else rightSidebarWidth.value = width
  localStorage.setItem(side === 'left' ? PIPELINE_LEFT_WIDTH_KEY : PIPELINE_RIGHT_WIDTH_KEY, String(width))
  void nextTick(measureConnections)
}

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

function resetDraft(pipeline: PipelineMeta | null): void {
  cancelConnection()
  canvasScale.value = 1
  panOffsetX.value = 0
  panOffsetY.value = 0
  draft.value = pipeline ? cloneForIpc(pipeline) : blankDraft()
  lastSavedSnapshot.value = JSON.stringify(draft.value)
  persistedRuntimeValues.value = cloneForIpc(draft.value.paramsByEnv ?? {})
  persistedRuntimeConfig.value = cloneForIpc(draft.value.configByEnv ?? {})
  syncRuntimeValuesForEnvironment()
  session.value = props.initialSession ?? null
  if (session.value) hydrateSessionLogs(session.value)
  error.value = ''
  selectedNodeId.value = draft.value.nodes[0]?.id ?? null
  void nextTick(() => centerCanvasView('auto', 'start'))
}

function syncRuntimeValuesForEnvironment(envId = currentEnvId.value): void {
  runtimeValues.value = cloneForIpc(persistedRuntimeValues.value[envId] ?? {})
  runtimeConfig.value = cloneForIpc(persistedRuntimeConfig.value[envId] ?? {})
}

function hydrateSessionLogs(next: PipelineSession): void {
  const hydrated = next.nodes.flatMap((node) => (node.logs ?? []).map((line) => ({
    ...line,
    pipelineSessionId: next.id,
    nodeId: node.nodeId,
    scriptSessionId: line.sessionId
  })))
  if (!hydrated.length) return
  const existing = pipelineLogs.value.filter((line) => line.pipelineSessionId !== next.id)
  pipelineLogs.value = [...existing, ...hydrated]
}

function mergePipelineLog(line: PipelineLogLine): void {
  const key = `${line.pipelineSessionId}:${line.nodeId}:${line.ts}:${line.sessionId}:${line.level}:${line.message}`
  if (pipelineLogs.value.some((item) => `${item.pipelineSessionId}:${item.nodeId}:${item.ts}:${item.sessionId}:${item.level}:${item.message}` === key)) return
  pipelineLogs.value = [...pipelineLogs.value, line].slice(-2000)
}

const activePipelineLogs = computed(() => pipelineLogs.value.filter((line) => line.pipelineSessionId === session.value?.id))

function pipelineLogTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function pipelineLogClass(level: LogLine['level']): string {
  return level === 'ERROR' ? 'text-rose-400' : level === 'WARN' ? 'text-amber-400' : 'sb-text-secondary'
}

function pipelineNodeName(nodeId: string): string {
  return draft.value?.nodes.find((node) => node.id === nodeId)?.name ?? nodeId
}

const isDirty = computed(() => Boolean(draft.value && JSON.stringify(draft.value) !== lastSavedSnapshot.value))

async function loadEnvironment(): Promise<void> {
  environments.value = await window.autoforge.env.list()
  currentEnvId.value = environments.value.find((item) => item.isDefault)?.id ?? environments.value[0]?.id ?? 'default'
  syncRuntimeValuesForEnvironment()
}

async function attemptLeave(target: 'back' | 'close'): Promise<void> {
  if (isDirty.value) {
    const confirmed = await askConfirm({
      title: '放弃未保存修改？',
      message: '当前流水线还有未保存的修改，离开后这些修改将丢失。',
      confirmLabel: '放弃修改',
      cancelLabel: '继续编辑',
      variant: 'danger'
    })
    if (!confirmed) return
  }
  if (target === 'back') emit('back')
  else emit('close')
  cancelConnection()
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
    paramValues: {},
    inputMappings: []
  }
  draft.value.nodes.push(node)
  selectedNodeId.value = node.id
  void nextTick(() => {
    revealNodeInCanvas(node.id)
    animateNodeIn(node.id)
  })
}

function nodeElement(nodeId: string): HTMLElement | undefined {
  return Array.from(canvasRef.value?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])
    .find((element) => element.dataset.nodeId === nodeId)
}

function animateNodeIn(nodeId: string): void {
  const element = nodeElement(nodeId)
  if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  gsap.fromTo(element, { opacity: 0, y: 18, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.38, ease: 'back.out(1.4)', clearProps: 'transform' })
}

function revealNodeInCanvas(nodeId: string): void {
  const canvas = canvasRef.value
  const element = nodeElement(nodeId)
  if (!canvas || !element) return
  const canvasRect = canvas.getBoundingClientRect()
  const nodeRect = element.getBoundingClientRect()
  canvas.scrollTo({
    left: Math.max(0, canvas.scrollLeft + nodeRect.left - canvasRect.left - (canvas.clientWidth - nodeRect.width) / 2),
    top: Math.max(0, canvas.scrollTop + nodeRect.top - canvasRect.top - (canvas.clientHeight - nodeRect.height) / 2),
    behavior: 'smooth'
  })
}

function centerCanvasView(behavior: 'auto' | 'smooth' = 'smooth', align: 'start' | 'center' = 'center'): void {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.scrollTo({
    left: align === 'start' ? 0 : Math.max(0, (canvas.scrollWidth - canvas.clientWidth) / 2),
    top: Math.max(0, (canvas.scrollHeight - canvas.clientHeight) / 2),
    behavior
  })
}

function onCanvasWheel(event: WheelEvent): void {
  const canvas = canvasRef.value
  if (!canvas) return
  if (event.ctrlKey) {
    event.preventDefault()
    const delta = event.deltaY < 0 ? 0.1 : -0.1
    canvasScale.value = Math.min(1.5, Math.max(0.5, Number((canvasScale.value + delta).toFixed(2))))
    return
  }
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.preventDefault()
  canvas.scrollLeft += event.deltaX + event.deltaY
}

function setCanvasScale(delta: number): void {
  canvasScale.value = Math.min(1.5, Math.max(0.5, Number((canvasScale.value + delta).toFixed(2))))
}

function resetCanvasView(): void {
  canvasScale.value = 1
  panOffsetX.value = 0
  panOffsetY.value = 0
  void nextTick(() => centerCanvasView('smooth', 'start'))
}

function fitCanvasView(): void {
  if (!draft.value) return
  canvasScale.value = Math.min(1.08, Math.max(0.5, Number((1.08 - Math.max(0, draft.value.nodes.length - 3) * 0.04).toFixed(2))))
  panOffsetX.value = 0
  panOffsetY.value = 0
  void nextTick(() => {
    const canvas = canvasRef.value
    if (canvas) centerCanvasView('smooth')
  })
}

function onCanvasKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    cancelConnection()
    return
  }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  canvasRef.value?.scrollBy({
    left: event.key === 'ArrowRight' ? 180 : event.key === 'ArrowLeft' ? -180 : 0,
    top: event.key === 'ArrowDown' ? 180 : event.key === 'ArrowUp' ? -180 : 0,
    behavior: 'smooth'
  })
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
  const target = event.target as HTMLElement
  if (target.closest('button, input, select, textarea, .pipeline-node-card, .pipeline-field-links, .pipeline-mapping-row')) return
  if (connectionDraft.value) cancelConnection()
  if (event.button !== 0 && event.button !== 2) return
  event.preventDefault()
  const canvas = canvasRef.value
  if (!canvas) return
  isPanning.value = true
  panStartX.value = event.clientX
  panStartOffsetX.value = panOffsetX.value
  panStartY.value = event.clientY
  panStartOffsetY.value = panOffsetY.value
  canvas.setPointerCapture(event.pointerId)
}

function onCanvasPointerMove(event: PointerEvent): void {
  updateConnectionPreview(event)
  if (!isPanning.value || !canvasRef.value) return
  panOffsetX.value = panStartOffsetX.value + event.clientX - panStartX.value
  panOffsetY.value = panStartOffsetY.value + event.clientY - panStartY.value
}

function onCanvasPointerUp(event: PointerEvent): void {
  if (!isPanning.value) return
  isPanning.value = false
  canvasRef.value?.releasePointerCapture(event.pointerId)
}

async function removeNode(index: number): Promise<void> {
  cancelConnection()
  const node = draft.value?.nodes[index]
  const element = node ? nodeElement(node.id) : undefined
  if (element && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await new Promise<void>((resolve) => {
      gsap.to(element, { opacity: 0, y: -8, scale: 0.95, duration: 0.18, ease: 'power1.in', onComplete: resolve })
    })
  }
  const removed = draft.value?.nodes.splice(index, 1)[0]
  if (removed?.id === selectedNodeId.value) selectedNodeId.value = draft.value?.nodes[index]?.id ?? null
  normalizeOrder()
}

function moveNode(index: number, offset: number): void {
  if (!draft.value) return
  cancelConnection()
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
  void nextTick(measureConnections)
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

function bezierPath(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const distance = Math.max(56, Math.abs(target.x - source.x) * 0.45)
  return `M ${source.x} ${source.y} C ${source.x + distance} ${source.y}, ${target.x - distance} ${target.y}, ${target.x} ${target.y}`
}

function isAdjacentConnectionTarget(sourceNodeId: string, targetNodeId: string): boolean {
  if (!draft.value) return false
  const sourceIndex = draft.value.nodes.findIndex((node) => node.id === sourceNodeId)
  const targetIndex = draft.value.nodes.findIndex((node) => node.id === targetNodeId)
  return sourceIndex >= 0 && targetIndex === sourceIndex + 1
}

function isConnectionSource(nodeId: string): boolean {
  return connectionDraft.value?.sourceNodeId === nodeId
}

function canStartConnection(nodeId: string): boolean {
  if (!draft.value) return false
  const sourceIndex = draft.value.nodes.findIndex((node) => node.id === nodeId)
  return sourceIndex >= 0 && sourceIndex < draft.value.nodes.length - 1
}

function isConnectionTarget(nodeId: string): boolean {
  return Boolean(connectionDraft.value && isAdjacentConnectionTarget(connectionDraft.value.sourceNodeId, nodeId))
}

function startConnection(event: PointerEvent, node: PipelineNode): void {
  if (!canStartConnection(node.id)) return
  cancelConnection()
  connectionDraft.value = { sourceNodeId: node.id, pointerX: event.clientX, pointerY: event.clientY }
  updateConnectionPreview(event)
}

function updateConnectionPreview(event: PointerEvent): void {
  const draftConnection = connectionDraft.value
  const track = document.querySelector('.pipeline-canvas-track')
  if (!draftConnection || !(track instanceof HTMLElement)) return
  const trackRect = track.getBoundingClientRect()
  const scale = canvasScale.value || 1
  const pointer = {
    x: (event.clientX - trackRect.left) / scale,
    y: (event.clientY - trackRect.top) / scale
  }
  const source = fieldPoint(`output:${draftConnection.sourceNodeId}`, trackRect, 'source')
  if (!source) return
  connectionDraft.value = { ...draftConnection, pointerX: event.clientX, pointerY: event.clientY }
  connectionPreviewPath.value = bezierPath(source, pointer)
}

function finishConnection(node: PipelineNode, targetParam: string): void {
  const draftConnection = connectionDraft.value
  if (!draftConnection || !isAdjacentConnectionTarget(draftConnection.sourceNodeId, node.id)) return
  const mappings = [...(node.inputMappings ?? [])]
  const nextMapping = { source: 'previous-result' as const, sourcePath: '', targetParam }
  const index = mappings.findIndex((mapping) => mapping.targetParam === targetParam)
  if (index >= 0) mappings[index] = nextMapping
  else mappings.push(nextMapping)
  node.inputMappings = mappings
  cancelConnection()
  void nextTick(measureConnections)
}

function cancelConnection(): void {
  connectionDraft.value = null
  connectionPreviewPath.value = ''
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
      const nodeState = nodeStatus(node.id)
      const status = nodeState === 'error' ? 'error' : nodeState === 'running' ? 'running' : nodeState === 'success' ? 'success' : 'idle'
      nextPaths.push({ id: `${node.id}-${mappingIndex}`, d: bezierPath(source, target), status })
    }
  }
  connectionPaths.value = nextPaths
}

function nodeStatus(nodeId: string): PipelineSession['status'] | 'idle' {
  return session.value?.nodes.find((item) => item.nodeId === nodeId)?.status ?? 'idle'
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
    draft.value = cloneForIpc(saved)
    lastSavedSnapshot.value = JSON.stringify(draft.value)
    emit('saved', saved)
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
    runtimeDrawerOpen.value = true
    const saved = await window.autoforge.pipelines.setValues(draft.value.id, currentEnvId.value, {
      config: cloneForIpc(runtimeConfig.value),
      params: cloneForIpc(runtimeValues.value)
    })
    persistedRuntimeValues.value = cloneForIpc(saved.paramsByEnv ?? {})
    persistedRuntimeConfig.value = cloneForIpc(saved.configByEnv ?? {})
    const started = await window.autoforge.pipelines.start(
      draft.value.id,
      currentEnvId.value,
      cloneForIpc(runtimeValues.value)
    )
    session.value = started
    hydrateSessionLogs(started)
    const latest = await window.autoforge.pipelines.getSession(started.id)
    if (latest) {
      session.value = latest
      hydrateSessionLogs(latest)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function removePipeline(): Promise<void> {
  if (!draft.value?.id) return
  const confirmed = await askConfirm({
    title: '删除流水线？',
    message: `确定删除流水线“${draft.value.name}”吗？此操作不可撤销。`,
    confirmLabel: '删除',
    cancelLabel: '取消',
    variant: 'danger'
  })
  if (!confirmed) return
  await window.autoforge.pipelines.delete(draft.value.id)
  emit('deleted')
  emit('back')
}

async function stop(): Promise<void> {
  if (!session.value || session.value.status !== 'running') return
  session.value = await window.autoforge.pipelines.stop(session.value.id)
}

let offSession: (() => void) | undefined
let offPipelineLog: (() => void) | undefined
let offResize: (() => void) | undefined
watch(() => props.open, (open) => {
  if (open) {
    resetDraft(props.pipeline)
    void loadEnvironment()
  }
})
watch(() => props.pipeline, (pipeline) => {
  if (props.open) resetDraft(pipeline)
})
watch(() => props.initialSession, (next) => {
  if (next && next.pipelineId === draft.value?.id) {
    session.value = next
    hydrateSessionLogs(next)
  }
})
watch(currentEnvId, (envId, previousEnvId) => {
  if (envId !== previousEnvId) syncRuntimeValuesForEnvironment(envId)
})
watch(() => JSON.stringify(draft.value?.nodes), () => void nextTick(measureConnections))
watch(canvasScale, () => void nextTick(measureConnections))
watch(leftCollapsed, () => {
  void nextTick(() => {
    measureConnections()
    if (leftSidebarRef.value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(leftSidebarRef.value, { opacity: 0.72 }, { opacity: 1, duration: 0.24, ease: 'power2.out' })
    }
  })
})
watch(rightCollapsed, () => {
  void nextTick(() => {
    measureConnections()
    if (rightSidebarRef.value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(rightSidebarRef.value, { opacity: 0.72 }, { opacity: 1, duration: 0.24, ease: 'power2.out' })
    }
  })
})
onMounted(() => {
  loadPipelinePanelWidths()
  if (props.open) {
    resetDraft(props.pipeline)
    void loadEnvironment()
    void nextTick(() => nameInputRef.value?.focus())
  }
  offSession = window.autoforge.pipelines.onSession((next) => {
    if (next.pipelineId === draft.value?.id && (!session.value || next.id === session.value.id || next.startedAt >= session.value.startedAt)) {
      session.value = next
      if (next.status === 'running') runtimeDrawerOpen.value = true
      hydrateSessionLogs(next)
      void nextTick(measureConnections)
    }
  })
  offPipelineLog = window.autoforge.pipelines.onLog((line) => {
    mergePipelineLog(line)
  })
  const handleResize = (): void => {
    if (canvasRef.value) canvasSize.value = { width: canvasRef.value.clientWidth, height: canvasRef.value.clientHeight }
    measureConnections()
  }
  handleResize()
  void nextTick(() => centerCanvasView('auto', 'start'))
  window.addEventListener('resize', handleResize)
  offResize = () => window.removeEventListener('resize', handleResize)
})
onUnmounted(() => {
  cancelConnection()
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  gsap.killTweensOf([canvasRef.value, leftSidebarRef.value, rightSidebarRef.value])
  offSession?.()
  offPipelineLog?.()
  offResize?.()
})
</script>

<template>
  <div v-if="open" class="pipeline-editor-view flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden">
      <header class="h-14 px-5 border-b sb-border-subtle flex items-center gap-3 shrink-0" style="-webkit-app-region: drag">
        <Workflow class="w-5 h-5 text-[var(--sb-accent-solid)]" />
        <button class="workflow-back-button" title="返回流水线列表" @click="attemptLeave('back')"><ArrowLeft class="w-4 h-4" />列表</button>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-[15px] font-semibold sb-text-primary">{{ draft?.name || '新建流水线' }}</h2>
          <p class="truncate text-[11px] sb-text-faint">{{ draft?.description || '串联已有脚本，逐步传递结果' }}</p>
        </div>
        <span class="workflow-save-state" :class="isDirty && 'is-dirty'"><i></i>{{ saving ? '保存中' : isDirty ? '未保存修改' : '已保存' }}</span>
        <div class="workflow-top-actions"><button class="workflow-top-action" :disabled="saving" @click="save"><Save class="w-3.5 h-3.5" />保存</button><button v-if="session?.status === 'running'" class="workflow-top-action is-danger" @click="stop">停止</button><button v-else class="workflow-top-action is-primary" @click="run"><Play class="w-3.5 h-3.5" />运行</button></div>
        <button class="sb-icon-btn" title="关闭" @click="attemptLeave('close')"><X class="w-4 h-4" /></button>
      </header>
      <div class="flex min-h-0 min-w-0 flex-1">
        <aside ref="leftSidebarRef" class="workflow-sidebar border-r sb-border-subtle p-4 flex flex-col gap-3 min-h-0 bg-[color-mix(in_srgb,var(--sb-bg-panel)_92%,transparent)]" :class="[leftCollapsed && 'is-collapsed', resizingPanel === 'left' && 'is-resizing']" :style="leftSidebarStyle">
          <div v-if="!leftCollapsed" class="resize-handle-col resize-handle-col--edge-right workflow-panel-resize-handle" :class="resizingPanel === 'left' && 'is-active'" title="拖拽调整宽度，双击恢复默认" @mousedown="onPipelinePanelResizeStart('left', $event)" @dblclick="resetPipelinePanelWidth('left')" />
          <button class="workflow-collapse-button" :title="leftCollapsed ? '展开左侧栏' : '收起左侧栏'" @click="leftCollapsed = !leftCollapsed"><ChevronRight v-if="leftCollapsed" class="w-4 h-4" /><ChevronLeft v-else class="w-4 h-4" /></button>
          <div class="workflow-library">
            <div class="workflow-pane-heading"><span>节点库</span><span class="workflow-pane-count">{{ filteredScripts.length }}</span></div>
            <input v-model="search" class="sb-input workflow-library-search" placeholder="搜索脚本" />
            <div class="workflow-library-list">
              <button v-for="script in filteredScripts" :key="script.id" draggable="true" class="workflow-library-item" @click="addNode(script.id)" @dragstart="onScriptDragStart($event, script.id)">
                <span class="workflow-library-icon" :class="[script.iconBg, script.iconBorder]"><component :is="resolveScriptIcon(script.icon)" class="w-3.5 h-3.5" :class="script.iconColor" :stroke-width="1.5" /></span><span class="truncate">{{ script.name }}</span><Plus class="w-3.5 h-3.5 ml-auto" />
              </button>
              <span v-if="!filteredScripts.length" class="workflow-library-empty">没有匹配脚本</span>
            </div>
          </div>
        </aside>
        <main v-if="draft" class="pipeline-editor-main flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden p-6">
          <div class="flex items-start gap-3">
            <div class="flex-1">
              <input ref="nameInputRef" v-model="draft.name" class="w-full bg-transparent text-xl font-semibold sb-text-primary outline-none border-b sb-border-subtle pb-1" placeholder="流水线名称" />
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
                <span class="pipeline-canvas-hint">{{ connectionDraft ? '请选择下一节点的输入字段' : 'Workflow canvas' }}</span>
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
              @contextmenu.prevent
              @keydown="onCanvasKeydown"
              @dragover.prevent
              @drop="onCanvasDrop"
              @pointerdown="onCanvasPointerDown"
              @pointermove="onCanvasPointerMove"
              @pointerup="onCanvasPointerUp"
              @pointercancel="onCanvasPointerUp"
            >
              <div v-if="!draft.nodes.length" class="pipeline-canvas-empty">从右侧选择脚本，开始搭建流水线</div>
              <div v-else class="pipeline-canvas-track" :style="canvasTrackStyle">
                <svg class="workflow-connections" :width="Math.max(900, draft.nodes.length * 360)" height="560" aria-hidden="true">
                  <defs>
                    <filter id="workflow-line-glow"><feGaussianBlur stdDeviation="2.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                    <marker v-for="status in ['idle', 'running', 'success', 'error']" :id="`workflow-arrow-${status}`" :key="status" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto" markerUnits="strokeWidth">
                      <path class="workflow-arrow" :class="`is-${status}`" d="M 1 1 L 9 5 L 1 9 Z" />
                    </marker>
                    <marker id="workflow-arrow-preview" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto" markerUnits="strokeWidth">
                      <path class="workflow-arrow is-preview" d="M 1 1 L 9 5 L 1 9 Z" />
                    </marker>
                  </defs>
                  <g v-for="connection in connectionPaths" :key="connection.id" class="workflow-connection" :class="`is-${connection.status}`">
                    <path class="workflow-connection-halo" :d="connection.d" />
                    <path class="workflow-connection-line" :d="connection.d" :marker-end="`url(#workflow-arrow-${connection.status})`" />
                    <circle v-if="connection.status === 'running'" class="workflow-connection-particle"><animateMotion dur="1.2s" repeatCount="indefinite" :path="connection.d" /></circle>
                    <circle v-if="connection.status === 'running'" class="workflow-connection-particle is-delayed"><animateMotion dur="1.2s" begin="-.58s" repeatCount="indefinite" :path="connection.d" /></circle>
                  </g>
                  <path v-if="connectionPreviewPath" class="workflow-connection-preview" :d="connectionPreviewPath" marker-end="url(#workflow-arrow-preview)" aria-hidden="true" />
                </svg>
                <template v-for="(node, index) in draft.nodes" :key="node.id">
                  <article class="pipeline-node-card" :data-node-id="node.id" :class="[`is-${nodeStatus(node.id)}`, selectedNodeId === node.id && 'is-selected', session?.currentNodeId === node.id && 'is-current', isConnectionSource(node.id) && 'is-connection-source']" @click="selectNode(node)">
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
                           @pointerdown.stop
                        >{{ field.label }}<span class="pipeline-port"></span></button>
                      </div>
                      <div v-else class="pipeline-field-group">
                        <span class="pipeline-field-group-label">可连接参数</span>
                        <div
                          v-for="field in nodeParamFields(node)"
                          :key="field.key"
                          class="pipeline-param-drop"
                          :ref="(element) => setFieldRef(`target:${node.id}:${field.key}`, element)"
                          :class="isConnectionTarget(node.id) && 'is-connection-target'"
                          @pointerdown.stop
                          @click.stop="finishConnection(node, field.key)"
                          @dragover.prevent
                          @drop="dropFieldMapping($event, node, field.key)"
                        >
                          <span class="pipeline-param-drop-label">{{ field.label }}</span>
                          <input :value="fixedParamValue(node, field.key)" class="pipeline-fixed-param" :placeholder="`固定值 · ${field.key}`" @input="onFixedParamInput($event, node, field.key)" />
                          <button class="pipeline-port-button is-target" type="button" aria-label="连接到此输入字段" @click.stop="finishConnection(node, field.key)">＋</button>
                        </div>
                      </div>
                      <button
                        class="pipeline-result-source"
                        :class="isConnectionSource(node.id) && 'is-connection-source'"
                        :ref="(element) => setFieldRef(`output:${node.id}`, element)"
                        :disabled="!canStartConnection(node.id)"
                        title="点击后连接到下一节点输入字段"
                        @pointerdown.stop.prevent="startConnection($event, node)"
                      ><span>完整输出 <small>点击连接</small></span><span class="pipeline-port"></span></button>
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
          <div v-if="false" class="grid grid-cols-2 gap-4">
            <div class="rounded-xl border sb-border-subtle p-4"><div class="flex items-center justify-between mb-3"><h3 class="text-[12px] font-semibold sb-text-primary">流水线输入参数</h3><select v-model="currentEnvId" class="sb-input h-7 rounded-md text-[11px] px-2"><option v-for="environment in environments" :key="environment.id" :value="environment.id">{{ environment.name }}</option></select></div><p class="text-[10px] sb-text-faint mb-3">仅首个脚本的参数作为流水线输入</p><div v-if="!aggregateParams.length" class="text-[11px] sb-text-faint">首个脚本没有声明参数</div><label v-for="field in aggregateParams" :key="field.key" class="block mb-3"><span class="block text-[11px] sb-text-muted mb-1">{{ field.label }}</span><input v-model="runtimeValues[field.key]" class="sb-input w-full h-8 rounded-md text-[12px] px-2" :placeholder="field.key" /></label><h3 v-if="draft.envSchema.length" class="text-[12px] font-semibold sb-text-primary mt-5 mb-3">全部节点环境配置</h3><p v-if="draft.envSchema.length" class="text-[10px] sb-text-faint mb-3">当前环境会统一应用到所有脚本节点</p><label v-for="field in draft.envSchema" :key="field.key" class="block mb-3"><span class="block text-[11px] sb-text-muted mb-1">{{ field.label }}</span><input v-model="runtimeConfig[field.key]" class="sb-input w-full h-8 rounded-md text-[12px] px-2" :placeholder="field.key" /></label></div>
            <div class="rounded-xl border sb-border-subtle p-4"><h3 class="text-[12px] font-semibold sb-text-primary mb-3">可用脚本</h3><p class="text-[10px] sb-text-faint mb-2">点击添加，或拖到画布末尾</p><input v-model="search" class="sb-input w-full h-8 rounded-md text-[12px] px-2 mb-2" placeholder="搜索脚本" /><div class="max-h-48 overflow-y-auto space-y-1"><button v-for="script in filteredScripts" :key="script.id" draggable="true" class="w-full text-left px-2.5 py-2 rounded-md sb-text-muted hover:sb-bg-hover text-[12px] flex items-center justify-between" @click="addNode(script.id)" @dragstart="onScriptDragStart($event, script.id)"><span>{{ script.name }}</span><Plus class="w-3.5 h-3.5" /></button></div></div>
          </div>
          <div v-if="error" class="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-[12px] text-rose-400">{{ error }}</div>
          <div v-if="false && session" class="rounded-xl border sb-border-subtle p-4"><div class="flex items-center justify-between mb-3"><h3 class="text-[12px] font-semibold sb-text-primary">运行状态</h3><span class="text-[11px]">{{ session.status }}</span></div><div class="space-y-1.5"><div v-for="node in session.nodes" :key="node.nodeId" class="flex items-center gap-2 text-[11px] sb-text-muted"><Check v-if="node.status === 'success'" class="w-3.5 h-3.5 text-emerald-400" /><span v-else class="w-3.5 h-3.5 rounded-full border sb-border-subtle"></span>{{ draft.nodes.find((item) => item.id === node.nodeId)?.name }}</div></div></div>
          <footer class="pipeline-editor-footer flex items-center justify-end gap-2"><button class="h-8 px-3 rounded-lg sb-btn-ghost text-[12px]" @click="attemptLeave('close')">关闭</button><button class="h-8 px-3 rounded-lg sb-btn-ghost text-[12px] flex items-center gap-1.5" :disabled="saving" @click="save"><Save class="w-3.5 h-3.5" />{{ saving ? '保存中' : '保存' }}</button><button v-if="session?.status === 'running'" class="h-8 px-3 rounded-lg bg-rose-500/10 text-rose-400 text-[12px]" @click="stop">停止</button><button v-else class="h-8 px-3 rounded-lg sb-btn-accent text-[12px] flex items-center gap-1.5" @click="run"><Play class="w-3.5 h-3.5" />运行流水线</button></footer>
        </main>
        <aside v-if="draft" ref="rightSidebarRef" class="workflow-inspector" :class="[rightCollapsed && 'is-collapsed', resizingPanel === 'right' && 'is-resizing']" :style="rightSidebarStyle">
          <div v-if="!rightCollapsed" class="resize-handle-col resize-handle-col--edge-left workflow-panel-resize-handle" :class="resizingPanel === 'right' && 'is-active'" title="拖拽调整宽度，双击恢复默认" @mousedown="onPipelinePanelResizeStart('right', $event)" @dblclick="resetPipelinePanelWidth('right')" />
          <button class="workflow-collapse-button workflow-collapse-button--right" :title="rightCollapsed ? '展开右侧栏' : '收起右侧栏'" @click="rightCollapsed = !rightCollapsed"><ChevronLeft v-if="rightCollapsed" class="w-4 h-4" /><ChevronRight v-else class="w-4 h-4" /></button>
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
      <section v-if="draft" class="pipeline-runtime-drawer" :class="runtimeDrawerOpen && 'is-open'">
        <button class="pipeline-runtime-toggle" @click="runtimeDrawerOpen = !runtimeDrawerOpen">
          <span><span class="pipeline-runtime-dot" :class="session?.status === 'running' && 'is-running'"></span><strong>运行与输入</strong><small>{{ session ? `上次运行：${session.status}` : '设置运行参数和环境' }}</small></span>
          <span class="pipeline-runtime-toggle-action">{{ runtimeDrawerOpen ? '收起' : '展开' }}⌃</span>
        </button>
        <div v-if="runtimeDrawerOpen" class="pipeline-runtime-body">
          <div class="pipeline-runtime-column">
            <div class="pipeline-runtime-heading"><strong>流水线输入</strong><select v-model="currentEnvId" class="sb-input pipeline-runtime-env"><option v-for="environment in environments" :key="environment.id" :value="environment.id">{{ environment.name }}</option></select></div>
            <p>仅首个脚本的参数作为流水线输入</p>
            <label v-for="field in aggregateParams" :key="field.key" class="pipeline-runtime-field"><span>{{ field.label }}</span><input v-model="runtimeValues[field.key]" class="sb-input" :placeholder="field.key" /></label>
            <span v-if="!aggregateParams.length" class="pipeline-runtime-empty">首个脚本没有声明参数</span>
          </div>
          <div class="pipeline-runtime-column">
            <div class="pipeline-runtime-heading"><strong>运行状态</strong><span class="pipeline-runtime-status">{{ session?.status ?? 'idle' }}</span></div>
            <div v-if="session" class="pipeline-runtime-steps"><div v-for="node in session.nodes" :key="node.nodeId" class="pipeline-runtime-step"><Check v-if="node.status === 'success'" class="h-3.5 w-3.5 text-emerald-400" /><span v-else class="pipeline-runtime-step-dot"></span><span>{{ draft.nodes.find((item) => item.id === node.nodeId)?.name }}</span><small>{{ node.status }}</small></div></div>
            <span v-else class="pipeline-runtime-empty">运行后会在这里显示每个节点的状态</span>
          </div>
          <div v-if="session" class="pipeline-runtime-log-wrap">
            <div class="pipeline-runtime-heading"><strong>脚本运行日志</strong><span class="pipeline-runtime-log-count">{{ activePipelineLogs.length }}</span></div>
            <div v-if="activePipelineLogs.length" class="pipeline-runtime-logs">
              <p v-for="(log, index) in activePipelineLogs" :key="`${log.ts}-${index}`" class="pipeline-runtime-log-line">
                <span class="pipeline-runtime-log-time">{{ pipelineLogTime(log.ts) }}</span>
                <span class="pipeline-runtime-log-node">{{ pipelineNodeName(log.nodeId) }}</span>
                <span :class="pipelineLogClass(log.level)">{{ log.message }}</span>
              </p>
            </div>
            <span v-else class="pipeline-runtime-empty">等待脚本输出日志</span>
          </div>
        </div>
      </section>
  </div>
</template>

<style scoped>
.pipeline-canvas-shell {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--sb-accent-solid) 10%, transparent), transparent 36%),
    var(--sb-bg-inset);
}

.pipeline-editor-view { position: relative; }
.pipeline-editor-view > .flex { min-width: 0; }
.pipeline-editor-main { gap: 16px; }
.pipeline-editor-main > .pipeline-canvas-shell { display: flex; min-height: 0; flex-direction: column; }
.pipeline-editor-main > .pipeline-canvas-shell > .pipeline-canvas { min-height: 0; flex: 1; }
.workflow-save-state { display: inline-flex; align-items: center; gap: 6px; color: var(--sb-text-faint); font-size: 10px; }
.workflow-save-state i { width: 6px; height: 6px; border-radius: 999px; background: #22c55e; }
.workflow-save-state.is-dirty { color: #d97706; }
.workflow-save-state.is-dirty i { background: #f59e0b; }

.workflow-top-actions { display: flex; align-items: center; gap: 7px; }
.workflow-back-button { display: inline-flex; height: 30px; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--sb-border); border-radius: 8px; color: var(--sb-text-muted); font-size: 11px; transition: 160ms ease; }
.workflow-back-button:hover { border-color: color-mix(in srgb, var(--sb-accent-solid) 55%, var(--sb-border)); color: var(--sb-text-primary); background: color-mix(in srgb, var(--sb-accent-solid) 8%, transparent); }
.workflow-sidebar { position: relative; width: 250px; flex: 0 0 250px; transition: width 200ms ease, flex-basis 200ms ease, padding 200ms ease; }
.workflow-sidebar.is-resizing, .workflow-inspector.is-resizing { transition: none; }
.workflow-sidebar.is-collapsed { width: 48px; flex-basis: 48px; padding: 10px 8px; }
.workflow-sidebar.is-collapsed > :not(.workflow-collapse-button) { display: none; }
.workflow-collapse-button { position: relative; z-index: 2; display: grid; width: 28px; height: 28px; place-items: center; margin-left: auto; border: 1px solid color-mix(in srgb, var(--sb-border) 80%, transparent); border-radius: 999px; color: var(--sb-text-muted); background: color-mix(in srgb, var(--sb-bg-panel) 92%, transparent); box-shadow: 0 4px 12px color-mix(in srgb, #000 8%, transparent); transition: 160ms ease; }
.workflow-collapse-button:hover { color: var(--sb-accent-solid); border-color: color-mix(in srgb, var(--sb-accent-solid) 55%, var(--sb-border)); background: color-mix(in srgb, var(--sb-accent-solid) 8%, var(--sb-bg-panel)); transform: scale(1.05); }
.workflow-panel-resize-handle { z-index: 3; }
.pipeline-editor-view > header button { -webkit-app-region: no-drag; }
.workflow-top-action { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--sb-border); border-radius: 8px; color: var(--sb-text-secondary); font-size: 11px; transition: 160ms ease; }
.workflow-top-action:hover { border-color: color-mix(in srgb, var(--sb-accent-solid) 60%, var(--sb-border)); color: var(--sb-text-primary); }
.workflow-top-action.is-primary { border-color: transparent; color: white; background: var(--sb-accent-solid); box-shadow: 0 8px 18px color-mix(in srgb, var(--sb-accent-solid) 24%, transparent); }
.workflow-top-action.is-danger { color: #f43f5e; border-color: color-mix(in srgb, #f43f5e 35%, var(--sb-border)); }
.workflow-pane-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; color: var(--sb-text-primary); font-size: 11px; font-weight: 650; }
.workflow-pane-count { min-width: 19px; padding: 2px 6px; border-radius: 99px; color: var(--sb-accent-solid); font-size: 9px; text-align: center; background: color-mix(in srgb, var(--sb-accent-solid) 12%, transparent); }
.workflow-library { display: flex; min-height: 0; flex: 1; flex-direction: column; padding-top: 14px; border-top: 1px solid var(--sb-border-subtle); }
.workflow-library-search { width: 100%; height: 30px; margin-bottom: 8px; padding: 0 9px; font-size: 11px; }
.workflow-library-list { display: grid; align-content: start; grid-auto-rows: minmax(34px, max-content); min-height: 0; flex: 1; gap: 4px; overflow-y: auto; }
.workflow-library-item { display: flex; align-items: center; width: 100%; min-height: 34px; padding: 5px 7px; border: 1px solid transparent; border-radius: 8px; color: var(--sb-text-secondary); font-size: 10px; text-align: left; transition: 150ms ease; }
.workflow-library-item:hover { border-color: color-mix(in srgb, var(--sb-accent-solid) 40%, var(--sb-border)); color: var(--sb-text-primary); background: color-mix(in srgb, var(--sb-accent-solid) 8%, transparent); }
.workflow-library-icon { display: grid; width: 23px; height: 23px; flex: 0 0 23px; place-items: center; overflow: hidden; border-radius: 7px; }
.workflow-library-empty { padding: 16px 4px; color: var(--sb-text-faint); font-size: 10px; }
.workflow-inspector { position: relative; display: flex; width: 330px; flex: 0 0 330px; flex-direction: column; min-height: 0; border-left: 1px solid var(--sb-border-subtle); background: color-mix(in srgb, var(--sb-bg-panel) 94%, transparent); transition: width 200ms ease, flex-basis 200ms ease; }
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
.pipeline-runtime-drawer { position: absolute; z-index: 4; right: 330px; bottom: 0; left: 250px; border-top: 1px solid var(--sb-border-subtle); background: color-mix(in srgb, var(--sb-bg-panel) 96%, transparent); box-shadow: 0 -10px 28px color-mix(in srgb, #000 5%, transparent); }
.pipeline-runtime-toggle { display: flex; width: 100%; min-height: 42px; align-items: center; justify-content: space-between; padding: 0 18px; color: var(--sb-text-muted); text-align: left; }
.pipeline-runtime-toggle:hover { color: var(--sb-text-primary); background: color-mix(in srgb, var(--sb-accent-solid) 5%, transparent); }
.pipeline-runtime-toggle > span:first-child { display: inline-flex; align-items: center; gap: 9px; }
.pipeline-runtime-toggle strong { color: var(--sb-text-primary); font-size: 11px; }
.pipeline-runtime-toggle small { color: var(--sb-text-faint); font-size: 10px; }
.pipeline-runtime-toggle-action { color: var(--sb-accent-solid); font-size: 10px; }
.pipeline-runtime-dot { width: 7px; height: 7px; border-radius: 99px; background: var(--sb-text-faint); }
.pipeline-runtime-dot.is-running { background: var(--sb-accent-solid); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sb-accent-solid) 14%, transparent); animation: pipeline-pulse 1.4s ease-in-out infinite; }
.pipeline-runtime-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; padding: 0 18px 16px; border-top: 1px solid var(--sb-border-subtle); }
.pipeline-runtime-column { min-width: 0; padding-top: 13px; }
.pipeline-runtime-heading { display: flex; align-items: center; justify-content: space-between; color: var(--sb-text-primary); font-size: 11px; font-weight: 650; }
.pipeline-runtime-heading > p, .pipeline-runtime-column > p { margin: 5px 0 10px; color: var(--sb-text-faint); font-size: 10px; }
.pipeline-runtime-env { height: 27px; padding: 0 8px; font-size: 10px; }
.pipeline-runtime-status { color: var(--sb-text-faint); font-size: 10px; font-weight: 400; }
.pipeline-runtime-field { display: grid; grid-template-columns: 100px minmax(0, 1fr); align-items: center; gap: 8px; margin-top: 7px; color: var(--sb-text-muted); font-size: 10px; }
.pipeline-runtime-field .sb-input { height: 27px; padding: 0 8px; font-size: 10px; }
.pipeline-runtime-empty { display: block; padding: 14px 0; color: var(--sb-text-faint); font-size: 10px; }
.pipeline-runtime-steps { display: grid; gap: 7px; margin-top: 10px; }
.pipeline-runtime-step { display: flex; align-items: center; gap: 7px; color: var(--sb-text-muted); font-size: 10px; }
.pipeline-runtime-step small { margin-left: auto; color: var(--sb-text-faint); font-size: 9px; }
.pipeline-runtime-step-dot { width: 8px; height: 8px; border: 1px solid var(--sb-border); border-radius: 99px; }
.pipeline-runtime-log-wrap { grid-column: 1 / -1; min-width: 0; padding-top: 12px; border-top: 1px solid var(--sb-border-subtle); }
.pipeline-runtime-log-count { min-width: 18px; padding: 2px 5px; border-radius: 99px; color: var(--sb-text-faint); font-size: 9px; font-weight: 500; text-align: center; background: color-mix(in srgb, var(--sb-text-faint) 10%, transparent); }
.pipeline-runtime-logs { max-height: 150px; margin-top: 8px; padding: 7px 9px; overflow-y: auto; border: 1px solid var(--sb-border-subtle); border-radius: 8px; background: color-mix(in srgb, var(--sb-bg-inset) 72%, transparent); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.pipeline-runtime-log-line { display: grid; grid-template-columns: 62px 92px minmax(0, 1fr); gap: 7px; margin: 0; padding: 2px 0; color: var(--sb-text-secondary); font-size: 10px; line-height: 1.45; }
.pipeline-runtime-log-time, .pipeline-runtime-log-node { color: var(--sb-text-faint); white-space: nowrap; }
.pipeline-runtime-log-node { overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 900px) { .pipeline-runtime-body { grid-template-columns: 1fr; } .pipeline-runtime-log-wrap { grid-column: auto; } }
.pipeline-editor-footer { display: none; }

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
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 560px;
  overflow-x: auto;
  overflow-y: auto;
  border: 1px solid color-mix(in srgb, var(--sb-border) 80%, transparent);
  border-radius: 14px;
  cursor: grab;
  touch-action: none;
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
  gap: 56px;
  width: max-content;
  min-width: 100%;
  min-height: 880px;
  padding: 56px 32px;
}

.workflow-connections { position: absolute; inset: 0 auto auto 0; z-index: 1; overflow: visible; pointer-events: none; }
.workflow-connection { color: color-mix(in srgb, var(--sb-accent-solid) 70%, white); }
.workflow-connection-line, .workflow-connection-halo { fill: none; stroke-linecap: round; }
.workflow-connection-line { stroke: currentColor; stroke-width: 2; stroke-dasharray: 7 7; animation: workflow-dash 1.5s linear infinite; }
.workflow-arrow.is-idle, .workflow-arrow.is-running { fill: color-mix(in srgb, var(--sb-accent-solid) 70%, white); }
.workflow-arrow.is-success { fill: #22c55e; }
.workflow-arrow.is-error { fill: #f43f5e; }
.workflow-arrow.is-preview { fill: var(--sb-accent-solid); }
.workflow-connection-halo { stroke: currentColor; stroke-width: 10; opacity: .1; filter: url(#workflow-line-glow); }
.workflow-connection.is-success { color: #22c55e; }
.workflow-connection.is-success .workflow-connection-line { stroke-dasharray: none; animation: none; }
.workflow-connection.is-error { color: #f43f5e; }
.workflow-connection.is-error .workflow-connection-line { stroke-dasharray: 4 6; }
.workflow-connection-particle { fill: currentColor; filter: drop-shadow(0 0 7px currentColor); }
.workflow-connection-particle.is-delayed { opacity: .55; }
.workflow-connection-preview { fill: none; stroke: var(--sb-accent-solid); stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 6 6; opacity: .82; filter: drop-shadow(0 0 5px color-mix(in srgb, var(--sb-accent-solid) 42%, transparent)); animation: workflow-dash 0.8s linear infinite; }
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
  flex: 0 0 240px;
  min-height: 240px;
  overflow: hidden;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--sb-border) 90%, transparent);
  border-radius: 16px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--sb-bg-panel) 98%, white), var(--sb-bg-panel));
  box-shadow: 0 20px 44px color-mix(in srgb, #000 10%, transparent), inset 0 1px 0 color-mix(in srgb, white 24%, transparent);
  transition: border-color 220ms ease, box-shadow 220ms ease, transform 220ms ease;
}

.pipeline-node-card:hover,
.pipeline-node-card.is-current {
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
  font-size: 14px;
  font-weight: 680;
  background: transparent;
}

.pipeline-node-script { margin-top: 5px; color: var(--sb-text-faint); font-size: 11px; }
.pipeline-node-status-dot { width: 7px; height: 7px; margin-top: 5px; border-radius: 999px; background: var(--sb-text-faint); }
.pipeline-node-card.is-running .pipeline-node-status-dot { background: var(--sb-accent-solid); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sb-accent-solid) 14%, transparent); animation: pipeline-pulse 1.4s ease-in-out infinite; }
.pipeline-node-card.is-success .pipeline-node-status-dot { background: #22c55e; }
.pipeline-node-card.is-error .pipeline-node-status-dot { background: #f43f5e; }

.pipeline-node-actions { display: flex; justify-content: flex-end; gap: 3px; margin-top: 12px; padding-bottom: 3px; border-bottom: 1px solid color-mix(in srgb, var(--sb-border) 75%, transparent); }
.pipeline-field-links { display: grid; gap: 6px; margin-top: 7px; }
.pipeline-field-group { display: grid; gap: 5px; }
.pipeline-field-group-label { color: var(--sb-text-faint); font-size: 9px; letter-spacing: 0.04em; text-transform: uppercase; }
.pipeline-field-chip, .pipeline-result-source { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 24px; padding: 3px 7px; border: 1px dashed color-mix(in srgb, var(--sb-accent-solid) 42%, var(--sb-border)); border-radius: 7px; color: var(--sb-text-secondary); font-size: 10px; text-align: left; background: color-mix(in srgb, var(--sb-accent-solid) 6%, transparent); }
.pipeline-field-chip:hover, .pipeline-result-source:hover { border-color: var(--sb-accent-solid); color: var(--sb-text-primary); }
.pipeline-result-source { border-color: color-mix(in srgb, #22c55e 42%, var(--sb-border)); color: color-mix(in srgb, #22c55e 75%, var(--sb-text-secondary)); }
.pipeline-result-source small { margin-left: 4px; color: var(--sb-text-faint); font-size: 8px; font-weight: 400; }
.pipeline-result-source:disabled { cursor: default; opacity: .52; }
.pipeline-result-source .pipeline-port { display: grid; width: 18px; height: 18px; flex: 0 0 18px; aspect-ratio: 1; place-items: center; border: 1px solid color-mix(in srgb, currentColor 42%, transparent); border-radius: 50%; font-size: 12px; line-height: 1; opacity: .35; }
.pipeline-result-source .pipeline-port::after { content: '+'; }
.pipeline-result-source:hover .pipeline-port, .pipeline-result-source.is-connection-source .pipeline-port { opacity: 1; }
.pipeline-param-drop { display: grid; grid-template-columns: 66px minmax(0, 1fr) 20px; align-items: center; gap: 5px; min-height: 28px; padding: 3px 5px; border: 1px dashed color-mix(in srgb, var(--sb-border) 80%, transparent); border-radius: 7px; }
.pipeline-param-drop:hover, .pipeline-param-drop.is-connection-target { border-color: color-mix(in srgb, var(--sb-accent-solid) 70%, var(--sb-border)); background: color-mix(in srgb, var(--sb-accent-solid) 6%, transparent); }
.pipeline-param-drop.is-connection-target { cursor: crosshair; box-shadow: 0 0 0 2px color-mix(in srgb, var(--sb-accent-solid) 12%, transparent); }
.pipeline-param-drop-label { overflow: hidden; color: var(--sb-text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.pipeline-fixed-param { min-width: 0; height: 23px; padding: 0 5px; border: 1px solid color-mix(in srgb, var(--sb-border) 70%, transparent); border-radius: 5px; outline: none; color: var(--sb-text-secondary); font-size: 9px; background: color-mix(in srgb, var(--sb-bg-panel) 80%, transparent); }
.pipeline-fixed-param:focus { border-color: var(--sb-accent-solid); }
.pipeline-port { width: 6px; height: 6px; flex: 0 0 6px; border: 1px solid currentColor; border-radius: 999px; background: var(--sb-bg-panel); }
.pipeline-port-button { display: grid; width: 18px; height: 18px; flex: 0 0 18px; aspect-ratio: 1; place-items: center; border: 1px solid color-mix(in srgb, currentColor 42%, transparent); border-radius: 50%; color: currentColor; font-size: 12px; line-height: 1; opacity: .35; transition: 150ms ease; }
.pipeline-field-chip:hover .pipeline-port-button, .pipeline-result-source:hover .pipeline-port-button, .pipeline-param-drop.is-connection-target .pipeline-port-button, .pipeline-node-card.is-connection-source .pipeline-port-button { opacity: 1; transform: scale(1.06); }
.pipeline-port-button:hover { border-color: var(--sb-accent-solid); color: var(--sb-accent-solid); background: color-mix(in srgb, var(--sb-accent-solid) 12%, transparent); }
.pipeline-port-button.is-target { color: var(--sb-accent-solid); }
.pipeline-result-source.is-connection-source { border-color: #22c55e; box-shadow: 0 0 0 3px color-mix(in srgb, #22c55e 16%, transparent); }
.pipeline-mappings { min-height: 32px; margin-top: 10px; padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--sb-border) 70%, transparent); }
.pipeline-mapping-row { display: grid; grid-template-columns: 58px minmax(0, 1fr) 78px 22px; gap: 4px; align-items: center; margin-bottom: 5px; }
.pipeline-mapping-source, .pipeline-mapping-path, .pipeline-mapping-target { min-width: 0; height: 25px; padding: 0 5px; font-size: 9px; }
.pipeline-add-mapping { color: var(--sb-accent-solid); font-size: 10px; }
.pipeline-add-mapping:hover { text-decoration: underline; }

@keyframes pipeline-pulse { 50% { opacity: 0.48; transform: scale(0.72); } }
@keyframes pipeline-glow { 50% { transform: translateX(18px); opacity: 0.55; } }

@media (prefers-reduced-motion: reduce) {
  .pipeline-node-card, .pipeline-node-glow, .pipeline-node-status-dot, .workflow-connection-preview { animation: none !important; transition: none; }
}
</style>
