<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Check,
  CheckCircle2,
  ChevronUp,
  Copy,
  FolderOpen,
  Layers,
  ListTree
} from 'lucide-vue-next'
import { formatRunResult } from '../../../shared/run-result'
import RunResultJsonNode from './RunResultJsonNode.vue'

const props = withDefaults(
  defineProps<{
    result: unknown
    finishedAt?: string
    finishedAtLabel?: string
    outputDir?: string | null
    fillHeight?: boolean
  }>(),
  { finishedAtLabel: '完成于', fillHeight: false }
)

const emit = defineEmits<{
  openOutputDir: []
}>()

const treeExpandDepth = ref(2)
const resultCopied = ref(false)
let resultCopiedTimer: ReturnType<typeof setTimeout> | undefined

type ParsedResult =
  | { kind: 'json'; data: unknown }
  | { kind: 'text'; text: string }

const parsed = computed((): ParsedResult => {
  const value = props.result
  if (value === undefined || value === null) return { kind: 'text', text: '' }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return { kind: 'json', data: JSON.parse(trimmed) }
      } catch {
        /* plain text */
      }
    }
    return { kind: 'text', text: value }
  }
  if (typeof value === 'object') return { kind: 'json', data: value }
  return { kind: 'text', text: String(value) }
})

const resultText = computed(() => formatRunResult(props.result))
const hasResult = computed(() => resultText.value.length > 0)

const summaryChips = computed(() => {
  if (parsed.value.kind !== 'json' || !parsed.value.data || typeof parsed.value.data !== 'object') {
    return []
  }
  const obj = parsed.value.data as Record<string, unknown>
  const chips: Array<{ label: string; value: string; tone?: 'ok' | 'warn' | 'neutral' }> = []

  if (typeof obj.ok === 'boolean') {
    chips.push({
      label: '状态',
      value: obj.ok ? '成功' : '失败',
      tone: obj.ok ? 'ok' : 'warn'
    })
  }
  if (Array.isArray(obj.targets)) {
    chips.push({ label: '目标', value: `${obj.targets.length} 项` })
  }
  if (Array.isArray(obj.skipped)) {
    chips.push({ label: '跳过', value: `${obj.skipped.length} 项` })
  }
  const keys = Object.keys(obj)
  if (keys.length && chips.length < 3) {
    chips.push({ label: '字段', value: `${keys.length} 个` })
  }
  return chips.slice(0, 4)
})

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

function expandAll(): void {
  treeExpandDepth.value = 99
}

function collapseAll(): void {
  treeExpandDepth.value = 0
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

watch(
  () => props.result,
  () => {
    treeExpandDepth.value = 2
  }
)
</script>

<template>
  <div v-if="hasResult" class="rr-viewer" :class="fillHeight && 'rr-viewer--fill'">
    <div class="rr-viewer-header">
      <div class="rr-viewer-header-left">
        <div class="rr-viewer-icon">
          <CheckCircle2 class="w-3.5 h-3.5" :stroke-width="1.5" />
        </div>
        <div class="min-w-0">
          <p v-if="finishedAt" class="rr-viewer-meta">
            {{ finishedAtLabel }}
            <time>{{ formatFinishedAt(finishedAt) }}</time>
          </p>
          <div v-if="summaryChips.length" class="rr-viewer-chips" :class="!finishedAt && 'rr-viewer-chips--solo'">
            <span
              v-for="chip in summaryChips"
              :key="chip.label"
              class="rr-viewer-chip"
              :class="chip.tone && `rr-viewer-chip--${chip.tone}`"
            >
              <span class="rr-viewer-chip-label">{{ chip.label }}</span>
              {{ chip.value }}
            </span>
          </div>
        </div>
      </div>
      <div class="rr-viewer-header-actions">
        <button
          type="button"
          class="run-result-action"
          :class="resultCopied && 'is-copied'"
          title="复制 JSON"
          @click="copyResult"
        >
          <Check v-if="resultCopied" class="w-3 h-3" :stroke-width="1.5" />
          <Copy v-else class="w-3 h-3" :stroke-width="1.5" />
          {{ resultCopied ? '已复制' : '复制' }}
        </button>
      </div>
    </div>

    <div class="rr-viewer-body">
      <div v-if="outputDir" class="rr-viewer-output">
        <div class="flex items-center justify-between gap-3">
          <span class="rr-viewer-output-label">
            <FolderOpen class="w-3 h-3" :stroke-width="1.5" />
            产物目录
          </span>
          <button type="button" class="run-result-open" @click="emit('openOutputDir')">
            <FolderOpen class="w-3 h-3" :stroke-width="1.5" />
            打开
          </button>
        </div>
        <p class="run-result-path mt-1.5" :title="outputDir">{{ outputDir }}</p>
      </div>

      <div v-if="parsed.kind === 'json'" class="rr-viewer-tree-wrap">
        <div class="rr-viewer-tree-toolbar">
          <span class="rr-viewer-tree-label">
            <ListTree class="w-3 h-3" :stroke-width="1.5" />
            结构化结果
          </span>
          <div class="rr-viewer-tree-actions">
            <button type="button" class="rr-viewer-tree-btn" @click="expandAll">
              <Layers class="w-3 h-3" :stroke-width="1.5" />
              全部展开
            </button>
            <button type="button" class="rr-viewer-tree-btn" @click="collapseAll">
              <ChevronUp class="w-3 h-3" :stroke-width="1.5" />
              全部收起
            </button>
          </div>
        </div>
        <div class="rr-viewer-tree-scroll" :class="fillHeight && 'rr-viewer-tree-scroll--fill'">
          <RunResultJsonNode
            :key="`tree-${treeExpandDepth}`"
            :value="parsed.data"
            :default-expand-depth="treeExpandDepth"
            :is-last="true"
          />
        </div>
      </div>

      <div v-else class="rr-viewer-tree-wrap">
        <div class="rr-viewer-tree-scroll" :class="fillHeight && 'rr-viewer-tree-scroll--fill'">
          <pre class="run-result-pre rr-viewer-plain">{{ parsed.text }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rr-viewer {
  border-radius: 0.625rem;
  border: 1px solid color-mix(in srgb, var(--sb-accent-solid) 22%, var(--sb-border));
  background:
    linear-gradient(
      165deg,
      color-mix(in srgb, var(--sb-accent-solid) 5%, var(--sb-bg-elevated)) 0%,
      var(--sb-bg-elevated) 45%,
      color-mix(in srgb, var(--sb-bg-log) 40%, var(--sb-bg-elevated)) 100%
    );
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--sb-text-primary) 5%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 40%, transparent);
  overflow: hidden;
}

.rr-viewer--fill {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.rr-viewer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: none;
  background: color-mix(in srgb, var(--sb-accent-solid) 6%, var(--sb-bg-surface));
}

.rr-viewer-header-left {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  min-width: 0;
}

.rr-viewer-icon {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  border: 1px solid color-mix(in srgb, var(--sb-accent-solid) 30%, var(--sb-border-subtle));
  background: color-mix(in srgb, var(--sb-accent-solid) 12%, var(--sb-bg-inset));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sb-accent-solid);
  flex-shrink: 0;
}

.rr-viewer-meta {
  font-size: 11px;
  color: var(--sb-text-faint);
  font-variant-numeric: tabular-nums;
}

.rr-viewer-meta time {
  margin-left: 0.25rem;
  color: var(--sb-text-secondary);
  font-weight: 500;
}

.rr-viewer-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}

.rr-viewer-chips--solo {
  margin-top: 0;
}

.rr-viewer-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  border: 1px solid var(--sb-border-subtle);
  background: var(--sb-bg-inset);
  color: var(--sb-text-secondary);
}

.rr-viewer-chip-label {
  color: var(--sb-text-muted);
  font-weight: 500;
}

.rr-viewer-chip--ok {
  border-color: color-mix(in srgb, #22c55e 35%, var(--sb-border-subtle));
  background: color-mix(in srgb, #22c55e 10%, var(--sb-bg-inset));
  color: #16a34a;
}

.rr-viewer-chip--warn {
  border-color: color-mix(in srgb, #ef4444 35%, var(--sb-border-subtle));
  background: color-mix(in srgb, #ef4444 10%, var(--sb-bg-inset));
  color: #dc2626;
}

.rr-viewer-header-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.rr-viewer-body {
  border-top: 1px solid var(--sb-border-subtle);
}

.rr-viewer--fill .rr-viewer-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.rr-viewer-output {
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid var(--sb-border-subtle);
  background: color-mix(in srgb, var(--sb-accent-solid) 4%, var(--sb-bg-muted));
}

.rr-viewer-output-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 11px;
  font-weight: 500;
  color: var(--sb-text-secondary);
}

.rr-viewer-tree-wrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.rr-viewer--fill .rr-viewer-tree-wrap {
  flex: 1;
}

.rr-viewer-tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--sb-border-subtle);
  background: color-mix(in srgb, var(--sb-bg-log) 50%, transparent);
}

.rr-viewer-tree-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--sb-text-label);
}

.rr-viewer-tree-actions {
  display: flex;
  gap: 0.25rem;
}

.rr-viewer-tree-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  font-size: 10px;
  color: var(--sb-text-muted);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}

.rr-viewer-tree-btn:hover {
  color: var(--sb-text-secondary);
  background: var(--sb-bg-hover);
  border-color: var(--sb-border-subtle);
}

.rr-viewer-tree-scroll {
  max-height: 16rem;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0.5rem 0.625rem 0.625rem;
  background: var(--sb-bg-log);
}

.rr-viewer-tree-scroll--fill {
  max-height: none;
  flex: 1;
  min-height: 0;
}

.rr-viewer-plain {
  margin: 0;
  padding: 0.25rem;
}

/* JSON tree nodes */
:deep(.rr-json-node) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.55;
}

:deep(.rr-json-line) {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.15rem;
  padding: 0.05rem 0;
  min-height: 1.35rem;
}

:deep(.rr-json-line:hover) {
  background: color-mix(in srgb, var(--sb-accent-solid) 4%, transparent);
  border-radius: 0.2rem;
}

:deep(.rr-json-toggle) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  margin-right: 0.1rem;
  padding: 0;
  border: none;
  border-radius: 0.15rem;
  background: transparent;
  color: var(--sb-text-faint);
  cursor: pointer;
  flex-shrink: 0;
}

:deep(.rr-json-toggle:hover) {
  color: var(--sb-text-secondary);
  background: var(--sb-bg-hover);
}

:deep(.rr-json-toggle-spacer) {
  display: inline-block;
  width: 1.1rem;
  flex-shrink: 0;
}

:deep(.rr-json-chevron) {
  width: 0.75rem;
  height: 0.75rem;
  transition: transform 0.15s ease;
}

:deep(.rr-json-chevron.is-open) {
  transform: rotate(90deg);
}

:deep(.rr-json-key) {
  color: var(--sb-hl-key);
  font-weight: 500;
}

:deep(.rr-json-colon) {
  color: var(--sb-text-faint);
  margin-right: 0.2rem;
}

:deep(.rr-json-bracket-btn) {
  display: inline;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  color: var(--sb-text-muted);
  cursor: pointer;
}

:deep(.rr-json-bracket) {
  color: var(--sb-text-muted);
  font-weight: 600;
}

:deep(.rr-json-preview) {
  margin: 0 0.25rem;
  font-size: 10px;
  color: var(--sb-text-faint);
  font-style: italic;
}

:deep(.rr-json-comma) {
  color: var(--sb-text-faint);
}

:deep(.rr-json-children) {
  padding-left: 1rem;
  border-left: 1px dashed color-mix(in srgb, var(--sb-border-subtle) 80%, transparent);
  margin-left: 0.45rem;
}

:deep(.rr-json-close) {
  opacity: 0.85;
}

:deep(.rr-json-string) {
  color: var(--sb-hl-string);
  word-break: break-all;
}

:deep(.rr-json-number) {
  color: var(--sb-hl-number);
}

:deep(.rr-json-boolean) {
  color: var(--sb-hl-boolean);
  font-weight: 600;
}

:deep(.rr-json-null) {
  color: var(--sb-text-faint);
  font-style: italic;
}
</style>
