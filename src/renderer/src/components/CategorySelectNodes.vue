<script setup lang="ts">
import type { CategoryTreeNode } from '../../../shared/category-tree'
import type { CategoryDefinition } from '../../../shared/types/script'

defineProps<{
  nodes: CategoryTreeNode<CategoryDefinition>[]
  depth: number
  modelValue: string
}>()

const emit = defineEmits<{
  select: [key: string]
}>()
</script>

<script lang="ts">
export default {
  name: 'CategorySelectNodes'
}
</script>

<template>
  <template v-for="node in nodes" :key="node.category.id">
    <button
      type="button"
      class="w-full text-left px-2 py-1.5 text-[12px] rounded-md transition-colors"
      :class="
        modelValue === node.category.key
          ? 'sb-nav-active sb-text-primary'
          : 'sb-text-secondary hover:sb-bg-hover'
      "
      :style="{ paddingLeft: `${8 + depth * 12}px` }"
      @click="emit('select', node.category.key)"
    >
      <span
        class="inline-block w-2 h-2 rounded-full mr-2 align-middle"
        :class="node.category.dotColor"
      />
      {{ node.category.label }}
    </button>
    <CategorySelectNodes
      v-if="node.children.length"
      :nodes="node.children"
      :depth="depth + 1"
      :model-value="modelValue"
      @select="(key) => emit('select', key)"
    />
  </template>
</template>
