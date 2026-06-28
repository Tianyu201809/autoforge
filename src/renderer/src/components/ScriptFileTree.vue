<script setup lang="ts">
import ScriptFileTreeNode from './ScriptFileTreeNode.vue'

export interface FileTreeNode {
  name: string
  path?: string
  children?: FileTreeNode[]
}

defineProps<{
  files: string[]
  activePath?: string
  isDirty?: (path: string) => boolean
}>()

const emit = defineEmits<{
  select: [path: string]
}>()

function buildTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = []

  for (const filePath of paths) {
    const parts = filePath.split('/')
    let level = root
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1
      let node = level.find((item) => item.name === part)
      if (!node) {
        node = isFile ? { name: part, path: filePath } : { name: part, children: [] }
        level.push(node)
      }
      if (!isFile) {
        node.children ??= []
        level = node.children
      }
    })
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] =>
    [...nodes]
      .sort((a, b) => {
        const aDir = !!a.children?.length && !a.path
        const bDir = !!b.children?.length && !b.path
        if (aDir !== bDir) return aDir ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-CN')
      })
      .map((node) => (node.children ? { ...node, children: sortNodes(node.children) } : node))

  return sortNodes(root)
}
</script>

<template>
  <nav class="h-full overflow-y-auto py-1 text-[11px] font-mono">
    <p v-if="!files.length" class="px-2 py-3 sb-text-faint">暂无文件</p>
    <ul v-else class="space-y-0.5">
      <ScriptFileTreeNode
        v-for="node in buildTree(files)"
        :key="node.path ?? node.name"
        :node="node"
        :depth="0"
        :active-path="activePath"
        :is-dirty="isDirty"
        @select="emit('select', $event)"
      />
    </ul>
  </nav>
</template>
