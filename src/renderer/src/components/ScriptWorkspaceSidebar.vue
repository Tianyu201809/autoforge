<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import ScriptFileTree from './ScriptFileTree.vue'

const props = withDefaults(
  defineProps<{
    files: string[]
    activePath?: string
    isDirty?: (path: string) => boolean
    title?: string
    storageKey?: string
    /** Tailwind width class when expanded, e.g. w-36 */
    expandedWidthClass?: string
    /** flush = border-r only (popout editor); panel = rounded border box */
    variant?: 'panel' | 'flush'
  }>(),
  {
    title: '工作区',
    storageKey: 'autoforge-workspace-sidebar',
    expandedWidthClass: 'w-36',
    variant: 'panel'
  }
)

const emit = defineEmits<{
  select: [path: string]
}>()

const expanded = ref(true)

onMounted(() => {
  const stored = localStorage.getItem(props.storageKey)
  if (stored === '0') expanded.value = false
})

function toggle(): void {
  expanded.value = !expanded.value
  localStorage.setItem(props.storageKey, expanded.value ? '1' : '0')
}
</script>

<template>
  <aside
    class="flex-shrink-0 sb-bg-panel overflow-hidden flex flex-col transition-[width] duration-200 ease-out"
    :class="[
      expanded ? expandedWidthClass : 'w-8',
      variant === 'flush' ? 'border-r sb-border-subtle' : 'border sb-border-subtle rounded-lg'
    ]"
  >
    <div
      class="border-b sb-border-subtle flex items-center flex-shrink-0"
      :class="expanded ? 'px-2 py-1.5 gap-1' : 'px-1 py-1.5 justify-center'"
    >
      <span
        v-if="expanded"
        class="text-[10px] font-medium sb-text-faint uppercase tracking-wider flex-1 truncate"
      >
        {{ title }}
      </span>
      <button
        type="button"
        class="w-6 h-6 flex items-center justify-center rounded sb-text-muted hover:sb-text-secondary hover:sb-bg-inset transition-colors flex-shrink-0"
        :title="expanded ? '收起工作区' : '展开工作区'"
        @click="toggle"
      >
        <PanelLeftClose v-if="expanded" class="w-3.5 h-3.5" :stroke-width="1.5" />
        <PanelLeftOpen v-else class="w-3.5 h-3.5" :stroke-width="1.5" />
      </button>
    </div>
    <ScriptFileTree
      v-show="expanded"
      class="flex-1 min-h-0"
      :files="files"
      :active-path="activePath"
      :is-dirty="isDirty"
      @select="emit('select', $event)"
    />
  </aside>
</template>
