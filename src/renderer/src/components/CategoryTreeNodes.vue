<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { CategoryTreeNode } from '../../../shared/category-tree'
import type { CategoryItem } from '../../../shared/types/script'

defineProps<{
  nodes: CategoryTreeNode<CategoryItem>[]
  depth: number
  activeKey?: string | null
  isExpanded: (id: string) => boolean
}>()

const emit = defineEmits<{
  toggle: [id: string, event: MouseEvent]
  select: [key: string]
  context: [item: CategoryItem, event: MouseEvent]
}>()
</script>

<script lang="ts">
export default {
  name: 'CategoryTreeNodes'
}
</script>

<template>
  <template v-for="node in nodes" :key="node.category.id">
    <button
      type="button"
      class="w-full flex items-center gap-1.5 py-1.5 rounded-md text-[13px] transition-colors text-left"
      :class="
        activeKey === node.category.key
          ? 'sb-category-active sb-text-primary font-medium'
          : 'sb-text-muted hover:sb-text-secondary sb-bg-hover'
      "
      :style="{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '8px' }"
      @click="emit('select', node.category.key)"
      @contextmenu="emit('context', node.category, $event)"
    >
      <span
        class="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0"
        @click="node.children.length ? emit('toggle', node.category.id, $event) : undefined"
      >
        <ChevronDown
          v-if="node.children.length && isExpanded(node.category.id)"
          class="w-3 h-3 sb-text-faint"
          :stroke-width="1.5"
        />
        <ChevronRight
          v-else-if="node.children.length"
          class="w-3 h-3 sb-text-faint"
          :stroke-width="1.5"
        />
      </span>
      <span
        class="w-2 h-2 rounded-full shrink-0"
        :class="[
          node.category.color,
          activeKey === node.category.key &&
            'ring-2 ring-[var(--sb-accent-solid)] ring-offset-1 ring-offset-[var(--sb-bg-panel)]'
        ]"
      />
      <span class="truncate flex-1">{{ node.category.name }}</span>
      <span class="ml-auto text-[11px] sb-text-faint tabular-nums">{{ node.category.count }}</span>
    </button>
    <CategoryTreeNodes
      v-if="node.children.length && isExpanded(node.category.id)"
      :nodes="node.children"
      :depth="depth + 1"
      :active-key="activeKey"
      :is-expanded="isExpanded"
      @toggle="(id, event) => emit('toggle', id, event)"
      @select="(key) => emit('select', key)"
      @context="(item, event) => emit('context', item, event)"
    />
  </template>
</template>
