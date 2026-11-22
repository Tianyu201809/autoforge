<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'

defineProps<{ collapsed: boolean; width: number }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <aside v-if="!collapsed" class="workspace-context" :style="{ width: `${width}px` }">
    <div class="workspace-context-header">
      <slot name="title">Workspace</slot>
      <button type="button" aria-label="收起上下文侧栏" title="收起侧栏" @click="emit('toggle')">
        <PanelLeftClose :size="16" />
      </button>
    </div>
    <div class="workspace-context-content">
      <slot />
    </div>
  </aside>
  <button
    v-else
    type="button"
    class="workspace-context-reopen"
    aria-label="展开上下文侧栏"
    title="展开上下文侧栏"
    @click="emit('toggle')"
  >
    <PanelLeftOpen :size="17" />
  </button>
</template>

<style scoped>
.workspace-context {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  border-right: 1px solid var(--sb-border-subtle);
  background: var(--sb-bg-base);
}

.workspace-context-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--sb-border-subtle);
  color: var(--sb-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.workspace-context-header button,
.workspace-context-reopen {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--sb-text-muted);
  cursor: pointer;
}

.workspace-context-header button:hover,
.workspace-context-reopen:hover {
  background: var(--sb-bg-hover);
  color: var(--sb-text-primary);
}

.workspace-context-header button:focus-visible,
.workspace-context-reopen:focus-visible {
  outline: 2px solid var(--sb-ring);
  outline-offset: 1px;
}

.workspace-context-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-context-reopen {
  align-self: flex-start;
  margin: 8px 6px;
  border: 1px solid var(--sb-border-subtle);
  background: var(--sb-bg-panel);
}
</style>
