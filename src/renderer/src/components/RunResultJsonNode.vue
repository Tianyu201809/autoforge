<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

defineOptions({ name: 'RunResultJsonNode' })

const props = withDefaults(
  defineProps<{
    name?: string
    value: unknown
    depth?: number
    defaultExpandDepth?: number
    isLast?: boolean
  }>(),
  { depth: 0, defaultExpandDepth: 2, isLast: true }
)

const expanded = ref(props.depth < props.defaultExpandDepth)

const isArray = computed(() => Array.isArray(props.value))
const isObject = computed(
  () => props.value !== null && typeof props.value === 'object' && !isArray.value
)
const isCollapsible = computed(() => isArray.value || isObject.value)

const entries = computed((): Array<[string, unknown]> => {
  if (isArray.value) {
    return (props.value as unknown[]).map((item, index) => [String(index), item])
  }
  if (isObject.value) {
    return Object.entries(props.value as Record<string, unknown>)
  }
  return []
})

const preview = computed(() => {
  if (isArray.value) return `[${(props.value as unknown[]).length}]`
  if (isObject.value) return `{${Object.keys(props.value as object).length}}`
  return ''
})

const primitiveClass = computed(() => {
  const v = props.value
  if (v === null) return 'rr-json-null'
  if (typeof v === 'boolean') return 'rr-json-boolean'
  if (typeof v === 'number') return 'rr-json-number'
  return 'rr-json-string'
})

function formatPrimitive(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}

function toggle(): void {
  if (isCollapsible.value) expanded.value = !expanded.value
}
</script>

<template>
  <div class="rr-json-node" :class="`rr-json-node--depth-${Math.min(depth, 4)}`">
    <div class="rr-json-line">
      <button
        v-if="isCollapsible"
        type="button"
        class="rr-json-toggle"
        :aria-expanded="expanded"
        @click="toggle"
      >
        <ChevronRight class="rr-json-chevron" :class="expanded && 'is-open'" :stroke-width="2" />
      </button>
      <span v-else class="rr-json-toggle-spacer" aria-hidden="true" />

      <span v-if="name != null" class="rr-json-key">{{ name }}</span>
      <span v-if="name != null" class="rr-json-colon">:</span>

      <template v-if="isCollapsible">
        <button type="button" class="rr-json-bracket-btn" @click="toggle">
          <span class="rr-json-bracket">{{ isArray ? '[' : '{' }}</span>
          <span v-if="!expanded" class="rr-json-preview">{{ preview }}</span>
          <span v-if="!expanded" class="rr-json-bracket">{{ isArray ? ']' : '}' }}</span>
          <span v-if="!expanded && !isLast" class="rr-json-comma">,</span>
        </button>
      </template>
      <template v-else>
        <span :class="primitiveClass">{{ formatPrimitive(value) }}</span>
        <span v-if="!isLast" class="rr-json-comma">,</span>
      </template>
    </div>

    <div v-if="isCollapsible && expanded" class="rr-json-children">
      <RunResultJsonNode
        v-for="([childKey, childValue], index) in entries"
        :key="`${depth}-${childKey}`"
        :name="isArray ? undefined : childKey"
        :value="childValue"
        :depth="depth + 1"
        :default-expand-depth="defaultExpandDepth"
        :is-last="index === entries.length - 1"
      />
      <div class="rr-json-line rr-json-close">
        <span class="rr-json-toggle-spacer" aria-hidden="true" />
        <span class="rr-json-bracket">{{ isArray ? ']' : '}' }}</span>
        <span v-if="!isLast" class="rr-json-comma">,</span>
      </div>
    </div>
  </div>
</template>
