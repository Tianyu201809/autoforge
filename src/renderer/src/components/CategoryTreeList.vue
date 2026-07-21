<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { buildCategoryTree } from '../../../shared/category-tree'
import type { CategoryItem } from '../../../shared/types/script'
import CategoryTreeNodes from './CategoryTreeNodes.vue'

const EXPANDED_KEY = 'autoforge.sidebar.categoryExpanded'

const props = withDefaults(
  defineProps<{
    items: CategoryItem[]
    activeKey?: string | null
    enableContextMenu?: boolean
  }>(),
  {
    activeKey: null,
    enableContextMenu: false
  }
)

const emit = defineEmits<{
  select: [key: string]
  createChild: [item: CategoryItem]
  rename: [item: CategoryItem]
  delete: [item: CategoryItem]
}>()

const expanded = ref<Record<string, boolean>>({})
const menu = ref<{ x: number; y: number; item: CategoryItem } | null>(null)

const tree = computed(() => buildCategoryTree(props.items))

onMounted(() => {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (raw) expanded.value = JSON.parse(raw) as Record<string, boolean>
  } catch {
    expanded.value = {}
  }
  document.addEventListener('click', closeMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', closeMenu)
})

watch(
  expanded,
  (value) => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(value))
  },
  { deep: true }
)

function isExpanded(id: string): boolean {
  return expanded.value[id] !== false
}

function toggleExpand(id: string, event: MouseEvent): void {
  event.stopPropagation()
  expanded.value = { ...expanded.value, [id]: !isExpanded(id) }
}

function openMenu(item: CategoryItem, event: MouseEvent): void {
  if (!props.enableContextMenu) return
  event.preventDefault()
  event.stopPropagation()
  menu.value = { x: event.clientX, y: event.clientY, item }
}

function closeMenu(): void {
  menu.value = null
}

function isBuiltin(item: CategoryItem): boolean {
  return item.id.startsWith('builtin:')
}
</script>

<template>
  <div class="space-y-0.5">
    <CategoryTreeNodes
      :nodes="tree"
      :depth="0"
      :active-key="activeKey"
      :is-expanded="isExpanded"
      @toggle="toggleExpand"
      @select="(key) => emit('select', key)"
      @context="openMenu"
    />

    <Teleport to="body">
      <div
        v-if="menu"
        class="fixed z-[300] min-w-[140px] rounded-md border sb-border sb-bg-panel shadow-lg py-1 text-[12px]"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
      >
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left sb-text-secondary hover:sb-bg-hover"
          @click="emit('createChild', menu.item); closeMenu()"
        >
          新建子分类
        </button>
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left sb-text-secondary hover:sb-bg-hover"
          @click="emit('rename', menu.item); closeMenu()"
        >
          重命名
        </button>
        <button
          v-if="!isBuiltin(menu.item)"
          type="button"
          class="w-full px-3 py-1.5 text-left text-red-500 hover:sb-bg-hover"
          @click="emit('delete', menu.item); closeMenu()"
        >
          删除
        </button>
      </div>
    </Teleport>
  </div>
</template>
