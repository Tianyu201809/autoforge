<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { buildCategoryTree } from '../../../shared/category-tree'
import type { CategoryDefinition } from '../../../shared/types/script'
import CategorySelectNodes from './CategorySelectNodes.vue'

const props = defineProps<{
  modelValue: string
  definitions: CategoryDefinition[]
}>()

const emit = defineEmits<{
  'update:modelValue': [key: string]
}>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const tree = computed(() => buildCategoryTree(props.definitions))

const selectedLabel = computed(() => {
  const def = props.definitions.find((c) => c.key === props.modelValue)
  return def?.label ?? props.modelValue
})

function select(key: string): void {
  emit('update:modelValue', key)
  open.value = false
}

function onDocClick(event: MouseEvent): void {
  if (!rootEl.value?.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-2 h-8 px-2.5 rounded-md border sb-border-subtle sb-bg-inset text-[12px] sb-text-primary"
      @click="open = !open"
    >
      <span class="truncate">{{ selectedLabel }}</span>
      <ChevronDown class="w-3.5 h-3.5 sb-text-faint flex-shrink-0" :stroke-width="1.5" />
    </button>
    <div
      v-if="open"
      class="absolute z-40 mt-1 w-full max-h-56 overflow-y-auto rounded-md border sb-border sb-bg-panel shadow-lg p-1"
    >
      <CategorySelectNodes
        :nodes="tree"
        :depth="0"
        :model-value="modelValue"
        @select="select"
      />
    </div>
  </div>
</template>
