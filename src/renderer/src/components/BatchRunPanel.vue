<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Layers, Pencil, Plus, Square, Trash2, X } from 'lucide-vue-next'
import type {
  EnvironmentProfile,
  RunSession,
  ScriptInstanceSlot,
  ScriptItem
} from '../../../shared/types/script'
import { MAX_CONCURRENT_SESSIONS_PER_SCRIPT, MAX_INSTANCE_SLOTS, normalizeInstanceSlots } from '../../../shared/instance-slots'
import { defaultSchemaValue } from '../../../shared/schema-values'
import SchemaValueField from './SchemaValueField.vue'
import { useToast } from '../composables/useToast'
import { askConfirm } from '../composables/useConfirmDialog'
import type { useScriptRunner } from '../composables/useScriptRunner'

const props = defineProps<{
  open: boolean
  script: ScriptItem | null
  runner: ReturnType<typeof useScriptRunner>
}>()

const emit = defineEmits<{
  close: []
  refresh: []
  started: [sessionIds: string[]]
}>()

const { pushToast } = useToast()
const slots = ref<ScriptInstanceSlot[]>([])
const environments = ref<EnvironmentProfile[]>([])
const selectedIds = ref<string[]>([])
const editingId = ref<string | null>(null)
const draft = ref<ScriptInstanceSlot | null>(null)
const draftTab = ref<'config' | 'params'>('config')
const saving = ref(false)
const starting = ref(false)

const editingSlot = computed(() => slots.value.find((s) => s.id === editingId.value) ?? null)
const canAdd = computed(() => slots.value.length < MAX_INSTANCE_SLOTS)
const runningSessions = computed(() => {
  const scriptId = props.script?.id
  if (!scriptId) return [] as RunSession[]
  return props.runner.sessions.value.filter((s) => s.scriptId === scriptId && s.status === 'running')
})
const runningCount = computed(() => runningSessions.value.length)

watch(
  () => [props.open, props.script?.id] as const,
  async ([open]) => {
    if (!open || !props.script) return
    editingId.value = null
    draft.value = null
    draftTab.value = 'config'
    selectedIds.value = []
    environments.value = await window.autoforge.env.list()
    slots.value = await window.autoforge.scripts.getInstanceSlots(props.script.id)
    selectedIds.value = slots.value.map((s) => s.id)
  }
)

function envName(envId: string): string {
  return environments.value.find((e) => e.id === envId)?.name ?? envId
}

function paramsSummary(slot: ScriptInstanceSlot): string {
  const keys = Object.keys(slot.params).filter((k) => (slot.params[k] ?? '') !== '')
  if (!keys.length) return '无参数'
  return keys
    .slice(0, 3)
    .map((k) => `${k}=${slot.params[k]}`)
    .join(' · ')
}

function defaultEnvId(): string {
  return (
    props.script?.defaultEnvId ??
    environments.value.find((e) => e.isDefault)?.id ??
    environments.value[0]?.id ??
    ''
  )
}

function buildEmptyParams(): Record<string, string> {
  const params: Record<string, string> = {}
  for (const def of props.script?.paramSchema ?? []) {
    params[def.key] = defaultSchemaValue(def)
  }
  return params
}

function buildConfigForEnv(envId: string): Record<string, string> {
  const config: Record<string, string> = {}
  const saved = props.script?.configByEnv?.[envId] ?? {}
  for (const def of props.script?.envSchema ?? []) {
    config[def.key] = saved[def.key] ?? defaultSchemaValue(def)
  }
  return config
}

function startCreate(): void {
  if (!canAdd.value) return
  const id = crypto.randomUUID()
  const envId = defaultEnvId()
  draft.value = {
    id,
    name: `实例 ${slots.value.length + 1}`,
    envId,
    config: buildConfigForEnv(envId),
    params: buildEmptyParams(),
    browser: { headless: props.script?.browser?.headless ?? false }
  }
  editingId.value = id
  draftTab.value = props.script?.envSchema?.length ? 'config' : 'params'
}

function startEdit(slot: ScriptInstanceSlot): void {
  editingId.value = slot.id
  draft.value = {
    ...slot,
    config: { ...(slot.config ?? buildConfigForEnv(slot.envId)) },
    params: { ...slot.params },
    browser: { headless: slot.browser?.headless ?? false }
  }
  draftTab.value = props.script?.envSchema?.length ? 'config' : 'params'
}

function onDraftEnvChange(envId: string): void {
  if (!draft.value) return
  draft.value.envId = envId
  draft.value.config = buildConfigForEnv(envId)
}

function cancelEdit(): void {
  editingId.value = null
  draft.value = null
  draftTab.value = 'config'
}

async function persistSlots(next: ScriptInstanceSlot[]): Promise<boolean> {
  if (!props.script) return false
  saving.value = true
  try {
    // Electron IPC 使用 structured clone；Vue Proxy 会报 "An object could not be cloned"
    const plain = normalizeInstanceSlots(next)
    await window.autoforge.scripts.setInstanceSlots(props.script.id, plain)
    slots.value = plain
    selectedIds.value = selectedIds.value.filter((id) => plain.some((s) => s.id === id))
    emit('refresh')
    return true
  } catch (err) {
    pushToast({
      type: 'error',
      title: '保存失败',
      message: err instanceof Error ? err.message : '无法保存实例配置'
    })
    return false
  } finally {
    saving.value = false
  }
}

async function saveDraft(): Promise<void> {
  if (!draft.value) return
  const name = draft.value.name.trim()
  if (!name) {
    pushToast({ type: 'error', title: '保存失败', message: '实例名称不能为空' })
    return
  }
  if (!draft.value.envId) {
    pushToast({ type: 'error', title: '保存失败', message: '请选择运行环境' })
    return
  }
  const nextSlot: ScriptInstanceSlot = {
    id: draft.value.id,
    name,
    envId: draft.value.envId,
    config: { ...draft.value.config },
    params: { ...draft.value.params },
    browser: { headless: !!draft.value.browser?.headless }
  }
  const idx = slots.value.findIndex((s) => s.id === nextSlot.id)
  const next =
    idx >= 0
      ? slots.value.map((s, i) => (i === idx ? nextSlot : s))
      : [...slots.value, nextSlot]
  const ok = await persistSlots(next)
  if (ok) {
    if (!selectedIds.value.includes(nextSlot.id)) selectedIds.value = [...selectedIds.value, nextSlot.id]
    cancelEdit()
    pushToast({ type: 'success', title: '已保存', message: `实例「${name}」已保存` })
  }
}

async function deleteSlot(slot: ScriptInstanceSlot): Promise<void> {
  const confirmed = await askConfirm({
    title: '删除实例',
    message: `确定删除实例「${slot.name}」？`,
    confirmLabel: '删除',
    variant: 'danger'
  })
  if (!confirmed) return
  const next = slots.value.filter((s) => s.id !== slot.id)
  const ok = await persistSlots(next)
  if (ok) {
    if (editingId.value === slot.id) cancelEdit()
    pushToast({ type: 'success', title: '已删除', message: `实例「${slot.name}」已删除` })
  }
}

function toggleSelect(id: string, checked: boolean): void {
  if (checked) {
    if (!selectedIds.value.includes(id)) selectedIds.value = [...selectedIds.value, id]
  } else {
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
  }
}

async function startSelected(): Promise<void> {
  if (!props.script || !selectedIds.value.length) return
  starting.value = true
  try {
    const result = await props.runner.startBatch(props.script.id, [...selectedIds.value])
    if (result.ok) {
      emit('started', result.started.map((s) => s.id))
      emit('refresh')
      pushToast({
        type: 'success',
        title: '批量启动',
        message: `已启动 ${result.started.length} 个实例`
      })
    }
  } finally {
    starting.value = false
  }
}

async function stopAll(): Promise<void> {
  if (!props.script) return
  try {
    await props.runner.stopByScript(props.script.id)
    emit('refresh')
    pushToast({ type: 'info', title: '已停止', message: '已停止该脚本全部运行中的实例' })
  } catch (err) {
    pushToast({
      type: 'error',
      title: '停止失败',
      message: err instanceof Error ? err.message : '无法停止运行中的实例'
    })
  }
}

async function stopSession(sessionId: string): Promise<void> {
  try {
    await props.runner.stop(sessionId)
    emit('refresh')
  } catch (err) {
    pushToast({
      type: 'error',
      title: '停止失败',
      message: err instanceof Error ? err.message : '无法停止该实例'
    })
  }
}

function sessionLabel(session: RunSession): string {
  return session.instanceName?.trim() || session.id.slice(0, 8)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="batch-modal">
      <div
        v-if="open && script"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
        @click.self="emit('close')"
      >
        <div class="absolute inset-0 bg-stone-950/40 backdrop-blur-[3px]" aria-hidden="true" />
        <div
          class="relative w-full max-w-xl rounded-xl border sb-border sb-bg-panel shadow-[0_24px_64px_rgba(28,25,23,0.18)] flex flex-col max-h-[min(90vh,720px)] overflow-hidden"
          role="dialog"
          @click.stop
        >
          <div class="flex items-start justify-between gap-3 px-5 py-4 border-b sb-border-subtle">
            <div class="flex items-start gap-3 min-w-0">
              <div class="w-9 h-9 rounded-lg sb-bg-inset border sb-border-subtle flex items-center justify-center flex-shrink-0">
                <Layers class="w-4 h-4 text-[var(--sb-accent-solid)]" :stroke-width="1.5" />
              </div>
              <div class="min-w-0">
                <h2 class="text-[15px] font-semibold sb-text-primary">批量运行</h2>
                <p class="text-[11px] sb-text-muted mt-0.5 truncate">
                  {{ script.name }} · 运行中 {{ runningCount }}/{{ MAX_CONCURRENT_SESSIONS_PER_SCRIPT }}
                </p>
              </div>
            </div>
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-bg-inset"
              @click="emit('close')"
            >
              <X class="w-4 h-4" :stroke-width="1.5" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">
            <div class="flex items-center justify-between">
              <p class="text-[10px] font-medium sb-text-faint uppercase tracking-wider">
                实例配置 {{ slots.length }}/{{ MAX_INSTANCE_SLOTS }}
              </p>
              <button
                type="button"
                class="flex items-center gap-1 text-[12px] text-[var(--sb-accent-solid)] disabled:opacity-40"
                :disabled="!canAdd || !!draft"
                @click="startCreate"
              >
                <Plus class="w-3.5 h-3.5" :stroke-width="1.5" />
                添加实例
              </button>
            </div>

            <ul v-if="slots.length" class="space-y-1.5">
              <li
                v-for="slot in slots"
                :key="slot.id"
                class="flex items-start gap-2 px-3 py-2.5 rounded-lg border sb-border-subtle sb-bg-surface"
              >
                <input
                  type="checkbox"
                  class="mt-1"
                  :checked="selectedIds.includes(slot.id)"
                  @change="toggleSelect(slot.id, ($event.target as HTMLInputElement).checked)"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-[13px] sb-text-primary font-medium truncate">{{ slot.name }}</p>
                  <p class="text-[11px] sb-text-faint truncate">
                    {{ envName(slot.envId) }} · {{ paramsSummary(slot) }}
                    <template v-if="slot.browser?.headless"> · 无头</template>
                  </p>
                </div>
                <button
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded-md sb-text-muted hover:sb-bg-hover"
                  title="编辑"
                  @click="startEdit(slot)"
                >
                  <Pencil class="w-3.5 h-3.5" :stroke-width="1.5" />
                </button>
                <button
                  type="button"
                  class="w-7 h-7 flex items-center justify-center rounded-md text-red-400/80 hover:bg-red-500/10"
                  title="删除"
                  @click="deleteSlot(slot)"
                >
                  <Trash2 class="w-3.5 h-3.5" :stroke-width="1.5" />
                </button>
              </li>
            </ul>
            <p v-else class="text-[12px] sb-text-faint py-6 text-center">还没有实例配置，点击上方添加</p>

            <div v-if="runningSessions.length" class="space-y-1.5 pt-1">
              <p class="text-[10px] font-medium sb-text-faint uppercase tracking-wider">
                运行中 {{ runningCount }}/{{ MAX_CONCURRENT_SESSIONS_PER_SCRIPT }}
              </p>
              <ul class="space-y-1">
                <li
                  v-for="session in runningSessions"
                  :key="session.id"
                  class="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5"
                >
                  <div class="flex-1 min-w-0">
                    <p class="text-[13px] sb-text-primary font-medium truncate">{{ sessionLabel(session) }}</p>
                    <p class="text-[11px] sb-text-faint truncate">{{ session.id.slice(0, 8) }} · {{ session.phase ?? 'running' }}</p>
                  </div>
                  <button
                    type="button"
                    class="flex items-center gap-1 h-7 px-2 rounded-md text-[12px] text-red-400/90 hover:text-red-400 hover:bg-red-500/10"
                    title="停止此实例"
                    @click="stopSession(session.id)"
                  >
                    <Square class="w-3 h-3" :stroke-width="1.5" />
                    停止
                  </button>
                </li>
              </ul>
            </div>

            <div v-if="draft" class="rounded-lg border sb-border sb-bg-inset/50 p-3 space-y-3">
              <p class="text-[12px] font-medium sb-text-secondary">
                {{ editingSlot && slots.some((s) => s.id === draft.id) ? '编辑实例' : '新建实例' }}
              </p>
              <div>
                <label class="text-[10px] sb-text-faint uppercase tracking-wider">名称</label>
                <input
                  v-model="draft.name"
                  type="text"
                  class="mt-1 w-full h-8 px-2 rounded-md border sb-border sb-bg-input text-[13px] outline-none focus:sb-input"
                />
              </div>
              <div>
                <label class="text-[10px] sb-text-faint uppercase tracking-wider">运行环境</label>
                <select
                  :value="draft.envId"
                  class="mt-1 w-full h-8 px-2 rounded-md border sb-border sb-bg-input text-[13px] outline-none focus:sb-input"
                  @change="onDraftEnvChange(($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="env in environments" :key="env.id" :value="env.id">{{ env.name }}</option>
                </select>
              </div>
              <label class="flex items-center gap-2 text-[12px] sb-text-secondary">
                <input
                  type="checkbox"
                  class="rounded border sb-border"
                  :checked="!!draft.browser?.headless"
                  @change="draft.browser = { headless: ($event.target as HTMLInputElement).checked }"
                />
                无头模式
              </label>

              <div class="flex gap-1 border-b sb-border-subtle">
                <button
                  type="button"
                  class="px-3 py-1.5 text-[12px] transition-colors"
                  :class="draftTab === 'config' ? 'font-medium sb-text-primary border-b-2 border-[var(--sb-text-primary)] -mb-px' : 'sb-text-muted hover:sb-text-secondary'"
                  @click="draftTab = 'config'"
                >
                  环境变量
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-[12px] transition-colors"
                  :class="draftTab === 'params' ? 'font-medium sb-text-primary border-b-2 border-[var(--sb-text-primary)] -mb-px' : 'sb-text-muted hover:sb-text-secondary'"
                  @click="draftTab = 'params'"
                >
                  运行参数
                </button>
              </div>

              <div v-if="draftTab === 'config'" class="space-y-2">
                <p class="text-[11px] sb-text-faint">仅作用于本实例，不会写回详情页「配置」</p>
                <template v-if="script.envSchema?.length">
                  <SchemaValueField
                    v-for="def in script.envSchema"
                    :key="`env-${def.key}`"
                    :def="def"
                    :model-value="draft.config[def.key] ?? ''"
                    :script-id="script.id"
                    :attachment-storage-key="`instance/${draft.id}/env/${def.key}`"
                    @update:model-value="draft.config[def.key] = $event"
                  />
                </template>
                <p v-else class="text-[12px] sb-text-muted py-2">此脚本未声明环境变量</p>
              </div>
              <div v-else class="space-y-2">
                <template v-if="script.paramSchema?.length">
                  <SchemaValueField
                    v-for="def in script.paramSchema"
                    :key="`param-${def.key}`"
                    :def="def"
                    :model-value="draft.params[def.key] ?? ''"
                    :script-id="script.id"
                    :attachment-storage-key="`instance/${draft.id}/param/${def.key}`"
                    @update:model-value="draft.params[def.key] = $event"
                  />
                </template>
                <p v-else class="text-[12px] sb-text-muted py-2">此脚本未定义运行参数</p>
              </div>

              <div class="flex gap-2">
                <button
                  type="button"
                  class="flex-1 h-8 rounded-lg sb-btn-accent text-[12px] font-medium disabled:opacity-40"
                  :disabled="saving"
                  @click="saveDraft"
                >
                  {{ saving ? '保存中…' : '保存' }}
                </button>
                <button
                  type="button"
                  class="h-8 px-3 rounded-lg border sb-border text-[12px] sb-text-muted"
                  @click="cancelEdit"
                >
                  取消
                </button>
              </div>
            </div>
          </div>

          <div class="flex-shrink-0 border-t sb-border-subtle px-4 py-3 flex gap-2">
            <button
              type="button"
              class="flex-1 h-9 rounded-lg sb-btn-accent text-[13px] font-medium disabled:opacity-40"
              :disabled="!selectedIds.length || starting || runningCount >= MAX_CONCURRENT_SESSIONS_PER_SCRIPT"
              @click="startSelected"
            >
              {{ starting ? '启动中…' : `启动所选 (${selectedIds.length})` }}
            </button>
            <button
              type="button"
              class="h-9 px-3 rounded-lg border sb-border text-[13px] sb-text-muted disabled:opacity-40"
              :disabled="runningCount === 0"
              @click="stopAll"
            >
              停止全部
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.batch-modal-enter-active,
.batch-modal-leave-active {
  transition: opacity 0.2s ease;
}
.batch-modal-enter-from,
.batch-modal-leave-to {
  opacity: 0;
}
</style>
