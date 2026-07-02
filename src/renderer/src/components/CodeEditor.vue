<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Circle, ExternalLink } from 'lucide-vue-next'
import { highlightCode } from '../utils/syntaxHighlight'

const props = withDefaults(
  defineProps<{
    modelValue: string
    filename?: string
    language?: 'javascript' | 'json' | 'python'
    dirty?: boolean
    readonly?: boolean
    placeholder?: string
    standalone?: boolean
  }>(),
  {
    language: 'javascript',
    dirty: false,
    readonly: false,
    placeholder: '在此编写脚本…',
    standalone: false
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  popout: []
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const gutterRef = ref<HTMLDivElement | null>(null)
const scrollRef = ref<HTMLDivElement | null>(null)

const cursorLine = ref(1)
const cursorCol = ref(1)

const lineCount = computed(() => Math.max(1, props.modelValue.split('\n').length))

const contentMinHeight = computed(() => {
  const lineHeight = 12 * 1.65
  const padding = 12 * 2
  return `${lineCount.value * lineHeight + padding}px`
})

const lineNumbers = computed(() => Array.from({ length: lineCount.value }, (_, i) => i + 1))

const highlighted = computed(() => {
  if (!props.modelValue) {
    return `<span class="sb-hl-placeholder">${props.placeholder}</span>`
  }
  return highlightCode(props.modelValue, props.language) + '\n'
})

const languageLabel = computed(() => {
  if (props.language === 'json') return 'JSON'
  if (props.language === 'python') return 'Python'
  return 'JavaScript'
})

function updateCursor(): void {
  const el = textareaRef.value
  if (!el) return
  const before = el.value.slice(0, el.selectionStart)
  const lines = before.split('\n')
  cursorLine.value = lines.length
  cursorCol.value = (lines.at(-1)?.length ?? 0) + 1
}

function onInput(e: Event): void {
  if (props.readonly) return
  const value = (e.target as HTMLTextAreaElement).value
  emit('update:modelValue', value)
  updateCursor()
}

function onKeydown(e: KeyboardEvent): void {
  if (props.readonly) return
  if (e.key === 'Tab') {
    e.preventDefault()
    const el = textareaRef.value
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const value = el.value
    const next = `${value.slice(0, start)}  ${value.slice(end)}`
    emit('update:modelValue', next)
    void nextTick(() => {
      el.selectionStart = el.selectionEnd = start + 2
      updateCursor()
    })
  }
}

function onScroll(): void {
  if (gutterRef.value && scrollRef.value) {
    gutterRef.value.scrollTop = scrollRef.value.scrollTop
  }
}

function onEditorWheel(e: WheelEvent): void {
  const scroller = scrollRef.value
  if (!scroller) return
  scroller.scrollTop += e.deltaY
  scroller.scrollLeft += e.deltaX
  e.preventDefault()
  onScroll()
}

watch(
  () => props.modelValue,
  () => {
    void nextTick(() => {
      onScroll()
    })
  }
)

defineExpose({ focus: () => textareaRef.value?.focus() })
</script>

<template>
  <div
    class="code-editor flex flex-col flex-1 min-h-0 rounded-lg border sb-border overflow-hidden sb-editor"
    :class="readonly && 'code-editor--readonly'"
  >
    <div class="flex items-center justify-between px-3 h-8 border-b sb-border-subtle sb-editor-toolbar flex-shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-[11px] font-mono sb-text-secondary truncate">{{ filename ?? 'untitled' }}</span>
        <span v-if="dirty" class="flex items-center gap-1 text-[10px] text-amber-400/90 flex-shrink-0">
          <Circle class="w-1.5 h-1.5 fill-current" />
          未保存
        </span>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          v-if="!standalone"
          type="button"
          class="w-6 h-6 flex items-center justify-center rounded sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors"
          title="弹出独立窗口"
          @click="emit('popout')"
        >
          <ExternalLink class="w-3 h-3" :stroke-width="1.5" />
        </button>
        <span class="text-[10px] px-1.5 py-0.5 rounded sb-editor-badge sb-text-faint font-mono">
          {{ languageLabel }}
        </span>
      </div>
    </div>

    <div class="flex flex-1 min-h-0 overflow-hidden sb-editor-body">
      <div
        ref="gutterRef"
        class="gutter flex-shrink-0 select-none border-r sb-border-subtle sb-editor-gutter"
        aria-hidden="true"
      >
        <div class="gutter-inner" :style="{ minHeight: contentMinHeight }">
          <div
            v-for="n in lineNumbers"
            :key="n"
            class="gutter-line text-right tabular-nums"
            :class="n === cursorLine && 'gutter-line--active'"
          >
            {{ n }}
          </div>
        </div>
      </div>

      <div ref="scrollRef" class="editor-scroll flex-1 min-w-0" @scroll="onScroll">
        <div class="editor-stack" :style="{ height: contentMinHeight, minHeight: '100%' }">
          <pre class="editor-highlight" aria-hidden="true"><code v-html="highlighted" /></pre>
          <textarea
            ref="textareaRef"
            class="editor-input"
            :value="modelValue"
            :readonly="readonly"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            wrap="off"
            :placeholder="placeholder"
            @input="onInput"
            @keydown="onKeydown"
            @click="updateCursor"
            @keyup="updateCursor"
            @focus="updateCursor"
            @wheel="onEditorWheel"
          />
        </div>
      </div>
    </div>

    <div class="flex items-center justify-between px-3 h-6 border-t sb-border-subtle sb-editor-statusbar flex-shrink-0">
      <span class="text-[10px] sb-text-faint font-mono tabular-nums">
        行 {{ cursorLine }} · 列 {{ cursorCol }}
      </span>
      <span class="text-[10px] sb-text-faint font-mono tabular-nums">{{ lineCount }} 行</span>
    </div>
  </div>
</template>

<style scoped>
.code-editor {
  --editor-font-size: 12px;
  --editor-line-height: 1.65;
  --editor-padding-x: 14px;
  --editor-padding-y: 12px;
  --editor-gutter-width: 44px;
}

.sb-editor-toolbar {
  background: var(--sb-editor-toolbar);
}

.sb-editor-body {
  background: var(--sb-editor-bg);
}

.sb-editor-gutter {
  width: var(--editor-gutter-width);
  background: var(--sb-editor-gutter);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

.sb-editor-gutter::-webkit-scrollbar {
  display: none;
}

.gutter-inner {
  padding-top: var(--editor-padding-y);
}

.gutter-line {
  padding: 0 8px 0 4px;
  height: calc(var(--editor-font-size) * var(--editor-line-height));
  line-height: calc(var(--editor-font-size) * var(--editor-line-height));
  font-size: 10px;
  color: var(--sb-editor-gutter-text);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.gutter-line--active {
  color: var(--sb-editor-gutter-active);
  background: var(--sb-editor-line-active);
}

.sb-editor-badge {
  background: var(--sb-editor-badge);
}

.editor-scroll {
  background: var(--sb-editor-bg);
  overflow: auto;
}

.editor-stack {
  position: relative;
  min-width: 100%;
}

.editor-highlight,
.editor-input {
  margin: 0;
  padding: var(--editor-padding-y) var(--editor-padding-x);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  tab-size: 2;
  white-space: pre;
  word-wrap: normal;
  overflow-wrap: normal;
  letter-spacing: 0.01em;
}

.editor-highlight {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--sb-editor-text);
  background: transparent;
}

.editor-highlight :deep(.sb-hl-keyword) {
  color: var(--sb-hl-keyword);
  font-weight: 500;
}

.editor-highlight :deep(.sb-hl-string) {
  color: var(--sb-hl-string);
}

.editor-highlight :deep(.sb-hl-comment) {
  color: var(--sb-hl-comment);
  font-style: italic;
}

.editor-highlight :deep(.sb-hl-number) {
  color: var(--sb-hl-number);
}

.editor-highlight :deep(.sb-hl-boolean) {
  color: var(--sb-hl-boolean);
}

.editor-highlight :deep(.sb-hl-fn) {
  color: var(--sb-hl-fn);
}

.editor-highlight :deep(.sb-hl-key) {
  color: var(--sb-hl-key);
}

.editor-highlight :deep(.sb-hl-placeholder) {
  color: var(--sb-text-faint);
}

.editor-input {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  background: transparent;
  color: transparent;
  caret-color: var(--sb-editor-caret);
}

.editor-input::selection {
  background: var(--sb-editor-selection-bg);
}

.code-editor--readonly .editor-input {
  cursor: default;
}

.sb-editor-statusbar {
  background: var(--sb-editor-toolbar);
}
</style>
