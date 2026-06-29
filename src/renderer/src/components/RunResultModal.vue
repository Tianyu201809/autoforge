<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CheckCircle2, Copy, FolderOpen, X, AlertCircle, Square } from 'lucide-vue-next'
import type { EnvironmentProfile, RunSession, ScriptItem } from '../../../shared/types/script'
import { parseParamAttachments } from '../../../shared/param-attachments'
import { parseCheckboxValue } from '../../../shared/param-choices'
import { extractRunResultOutputDir, formatRunResult } from '../../../shared/run-result'
import { defaultSchemaValue } from '../../../shared/schema-values'

const props = defineProps<{
  open: boolean
  script: ScriptItem | null
  session: RunSession | null
}>()

const emit = defineEmits<{
  close: []
}>()

const environments = ref<EnvironmentProfile[]>([])
const resultCopied = ref(false)
let resultCopiedTimer: ReturnType<typeof setTimeout> | undefined

const result = computed(() => props.session?.result)
const resultText = computed(() => formatRunResult(result.value))
const outputDir = computed(() => extractRunResultOutputDir(result.value))
const hasResult = computed(() => resultText.value.length > 0)

const sessionStatus = computed(() => props.session?.status ?? 'success')

const headerIcon = computed(() => {
  if (sessionStatus.value === 'error') return AlertCircle
  if (sessionStatus.value === 'stopped') return Square
  return CheckCircle2
})

const headerIconClass = computed(() => {
  if (sessionStatus.value === 'error') return 'text-red-400'
  if (sessionStatus.value === 'stopped') return 'sb-text-muted'
  return 'text-emerald-400'
})

const headerSubtitle = computed(() => {
  if (sessionStatus.value === 'running') return '运行中'
  if (sessionStatus.value === 'error') {
    const base = `失败于 ${formatFinishedAt(props.session?.finishedAt)}`
    return props.session?.exitCode != null ? `${base} · exit ${props.session.exitCode}` : base
  }
  if (sessionStatus.value === 'stopped') {
    return `已停止 · ${formatFinishedAt(props.session?.finishedAt)}`
  }
  const base = `完成于 ${formatFinishedAt(props.session?.finishedAt)}`
  return envName.value ? `${base} · 环境 ${envName.value}` : base
})

const envName = computed(() => {
  const envId = props.session?.envId
  if (!envId) return undefined
  return environments.value.find((e) => e.id === envId)?.name ?? envId
})

const paramRows = computed(() => {
  const script = props.script
  if (!script?.paramSchema.length) return []
  const envId = props.session?.envId ?? script.defaultEnvId
  const savedForEnv = envId ? script.paramsByEnv?.[envId] : undefined
  return script.paramSchema.map((def) => {
    const raw = savedForEnv?.[def.key] ?? defaultSchemaValue(def)
    const optionLabel = (value: string): string =>
      def.options?.find((opt) => opt.value === value)?.label ?? value
    if (def.type === 'attachment') {
      const items = parseParamAttachments(raw)
      return {
        label: def.label,
        key: def.key,
        value: items.length ? items.map((item) => item.name).join('、') : '—'
      }
    }
    if (def.type === 'checkbox') {
      const values = parseCheckboxValue(raw)
      return {
        label: def.label,
        key: def.key,
        value: values.length ? values.map(optionLabel).join('、') : '—'
      }
    }
    if (def.type === 'boolean') {
      return { label: def.label, key: def.key, value: raw === 'true' ? '是' : '否' }
    }
    if (def.type === 'select' || def.type === 'radio') {
      return { label: def.label, key: def.key, value: raw.trim() ? optionLabel(raw) : '—' }
    }
    if (def.secret) {
      return { label: def.label, key: def.key, value: raw.trim() ? '••••••' : '—' }
    }
    return { label: def.label, key: def.key, value: raw.trim() || '—' }
  })
})

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resultCopied.value = false
      if (resultCopiedTimer) clearTimeout(resultCopiedTimer)
      return
    }
    void window.autoforge.env.list().then((list) => {
      environments.value = list
    })
  }
)

function formatFinishedAt(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

async function copyResult(): Promise<void> {
  const text = resultText.value
  if (!text) return
  await navigator.clipboard.writeText(text)
  resultCopied.value = true
  if (resultCopiedTimer) clearTimeout(resultCopiedTimer)
  resultCopiedTimer = setTimeout(() => {
    resultCopied.value = false
  }, 2000)
}

async function openOutputDir(): Promise<void> {
  const dir = outputDir.value
  if (!dir) return
  await window.autoforge.system.openPath(dir)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="run-result-modal">
      <div
        v-if="open"
        class="fixed inset-0 z-[250] flex items-center justify-center p-4 sm:p-6"
        @click.self="emit('close')"
      >
        <div class="absolute inset-0 bg-stone-950/40 backdrop-blur-[3px]" aria-hidden="true" />

        <div
          class="run-result-modal-panel relative w-full max-w-2xl rounded-xl border sb-border sb-bg-panel shadow-[0_24px_64px_rgba(28,25,23,0.18)] flex flex-col max-h-[min(90vh,720px)] overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-result-modal-title"
          @click.stop
        >
          <div class="relative flex items-start justify-between gap-3 px-5 py-4 border-b sb-border-subtle run-result-modal-header overflow-hidden">
            <div
              class="absolute inset-x-0 top-0 h-px pointer-events-none"
              style="background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sb-accent-solid) 50%, transparent), transparent)"
              aria-hidden="true"
            />
            <div class="flex items-start gap-3 min-w-0">
              <div class="w-9 h-9 rounded-lg border sb-border-subtle sb-bg-inset flex items-center justify-center flex-shrink-0">
                <component :is="headerIcon" class="w-4 h-4" :class="headerIconClass" :stroke-width="1.5" />
              </div>
              <div class="min-w-0">
                <h2 id="run-result-modal-title" class="text-[15px] font-semibold sb-text-primary tracking-tight truncate">
                  {{ script?.name ?? '运行结果' }}
                </h2>
                <p class="text-[11px] sb-text-muted mt-0.5 leading-relaxed">
                  {{ headerSubtitle }}
                </p>
              </div>
            </div>
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-secondary hover:sb-bg-inset transition-colors flex-shrink-0"
              title="关闭"
              @click="emit('close')"
            >
              <X class="w-4 h-4" :stroke-width="1.5" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
            <section>
              <h3 class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">运行参数</h3>
              <div v-if="paramRows.length" class="mt-2 rounded-lg border sb-border-subtle overflow-hidden">
                <div
                  v-for="(row, index) in paramRows"
                  :key="row.key"
                  class="flex items-start gap-3 px-3 py-2.5 text-[12px]"
                  :class="index > 0 && 'border-t sb-border-subtle'"
                >
                  <span class="sb-text-muted flex-shrink-0 min-w-[5rem]">{{ row.label }}</span>
                  <span class="sb-text-primary break-all flex-1">{{ row.value }}</span>
                </div>
              </div>
              <p v-else class="mt-2 text-[12px] sb-text-muted">此脚本未定义运行参数</p>
            </section>

            <section v-if="outputDir">
              <div class="flex items-center justify-between gap-3 mb-2">
                <h3 class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">产物目录</h3>
                <button type="button" class="run-result-open" @click="openOutputDir">
                  <FolderOpen class="w-3 h-3" :stroke-width="1.5" />
                  打开目录
                </button>
              </div>
              <p class="run-result-path" :title="outputDir">{{ outputDir }}</p>
            </section>

            <section>
              <div class="flex items-center justify-between gap-3 mb-2">
                <h3 class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">运行结果</h3>
                <button
                  v-if="hasResult"
                  type="button"
                  class="run-result-action"
                  :class="resultCopied && 'is-copied'"
                  @click="copyResult"
                >
                  <Check v-if="resultCopied" class="w-3 h-3" :stroke-width="1.5" />
                  <Copy v-else class="w-3 h-3" :stroke-width="1.5" />
                  {{ resultCopied ? '已复制' : '复制' }}
                </button>
              </div>
              <div v-if="hasResult" class="run-result-body rounded-lg border overflow-hidden">
                <div class="run-result-scroll max-h-64 overflow-y-auto overscroll-contain">
                  <pre class="run-result-pre">{{ resultText }}</pre>
                </div>
              </div>
              <p v-else class="text-[12px] sb-text-muted">脚本未返回结果数据</p>
            </section>
          </div>

          <div class="flex-shrink-0 flex justify-end px-5 py-3.5 border-t sb-border-subtle">
            <button
              type="button"
              class="h-9 px-4 rounded-lg sb-btn-accent text-[13px] font-medium transition-opacity hover:opacity-90"
              @click="emit('close')"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.run-result-modal-header {
  background: color-mix(in srgb, var(--sb-accent-solid) 8%, var(--sb-bg-panel));
  box-shadow: inset 3px 0 0 var(--sb-accent-solid);
}

.run-result-modal-enter-active,
.run-result-modal-leave-active {
  transition: opacity 0.2s ease;
}

.run-result-modal-enter-from,
.run-result-modal-leave-to {
  opacity: 0;
}

.run-result-modal-enter-active .run-result-modal-panel,
.run-result-modal-leave-active .run-result-modal-panel {
  transition:
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.2s ease;
}

.run-result-modal-enter-from .run-result-modal-panel,
.run-result-modal-leave-to .run-result-modal-panel {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}
</style>
