<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, ChevronRight, FileCode2, FileJson2 } from 'lucide-vue-next'
import type { FileTreeNode } from './ScriptFileTree.vue'
import ScriptFileTreeNode from './ScriptFileTreeNode.vue'

const props = defineProps<{
  node: FileTreeNode
  depth: number
  activePath?: string
  isDirty?: (path: string) => boolean
}>()

const emit = defineEmits<{
  select: [path: string]
}>()

const expanded = ref(true)
const isFolder = !!props.node.children?.length && !props.node.path

function iconFor(path: string) {
  return path.endsWith('.json') ? FileJson2 : FileCode2
}
</script>

<template>
  <li>
    <button
      v-if="isFolder"
      type="button"
      class="w-full flex items-center gap-1 px-2 py-1 rounded-md sb-text-muted hover:sb-text-secondary hover:sb-bg-hover text-left"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      @click="expanded = !expanded"
    >
      <component :is="expanded ? ChevronDown : ChevronRight" class="w-3 h-3 flex-shrink-0" :stroke-width="1.5" />
      <span class="truncate">{{ node.name }}</span>
    </button>
    <button
      v-else
      type="button"
      class="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left transition-colors"
      :class="activePath === node.path ? 'sb-nav-active sb-text-primary font-medium' : 'sb-text-muted hover:sb-text-secondary hover:sb-bg-hover'"
      :style="{ paddingLeft: `${depth * 12 + 20}px` }"
      @click="node.path && emit('select', node.path)"
    >
      <component :is="iconFor(node.path || '')" class="w-3 h-3 flex-shrink-0 opacity-70" :stroke-width="1.5" />
      <span class="truncate flex-1">{{ node.name }}</span>
      <span v-if="node.path && isDirty?.(node.path)" class="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
    </button>
    <ul v-if="isFolder && expanded && node.children?.length" class="space-y-0.5">
      <ScriptFileTreeNode
        v-for="child in node.children"
        :key="child.path ?? child.name"
        :node="child"
        :depth="depth + 1"
        :active-path="activePath"
        :is-dirty="isDirty"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>
