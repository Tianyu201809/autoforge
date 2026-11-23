<script setup lang="ts">
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  FolderKanban,
  History,
  PanelLeftOpen,
  Settings,
  Store
} from 'lucide-vue-next'
import type { WorkspaceView } from '../composables/useWorkspaceNavigation'

defineProps<{ view: WorkspaceView; collapsed: boolean }>()
const emit = defineEmits<{
  navigate: [view: WorkspaceView]
  toggleCollapsed: []
  toggleContext: []
}>()

const primaryItems: Array<{ id: WorkspaceView; label: string; icon: typeof FolderKanban }> = [
  { id: 'projects', label: '项目', icon: FolderKanban },
  { id: 'scripts', label: '脚本', icon: Code2 },
  { id: 'history', label: '运行历史', icon: History },
  { id: 'hub', label: 'Autoforge Hub', icon: Store }
]
</script>

<template>
  <nav class="workspace-navigation" aria-label="主导航">
    <div class="workspace-navigation-group">
      <button
        v-for="item in primaryItems"
        :key="item.id"
        type="button"
        class="workspace-navigation-item"
        :class="view === item.id && 'workspace-navigation-item--active'"
        :aria-current="view === item.id ? 'page' : undefined"
        :aria-label="item.label"
        :title="collapsed ? item.label : undefined"
        @click="emit('navigate', item.id)"
      >
        <component :is="item.icon" :size="17" :stroke-width="1.8" />
        <span v-if="!collapsed">{{ item.label }}</span>
      </button>
    </div>

    <div class="workspace-navigation-spacer" />

    <button
      type="button"
      class="workspace-navigation-item"
      aria-label="开发指南"
      :title="collapsed ? '开发指南' : undefined"
      :class="view === 'guide' && 'workspace-navigation-item--active'"
      @click="emit('navigate', 'guide')"
    >
      <BookOpen :size="17" :stroke-width="1.8" />
      <span v-if="!collapsed">开发指南</span>
    </button>
    <button
      type="button"
      class="workspace-navigation-item"
      aria-label="设置"
      :title="collapsed ? '设置' : undefined"
      :class="view === 'settings' && 'workspace-navigation-item--active'"
      @click="emit('navigate', 'settings')"
    >
      <Settings :size="17" :stroke-width="1.8" />
      <span v-if="!collapsed">设置</span>
    </button>
    <button
      type="button"
      class="workspace-navigation-toggle"
      :aria-label="collapsed ? '展开导航' : '收起导航'"
      :title="collapsed ? '展开导航' : '收起导航'"
      @click="emit('toggleCollapsed')"
    >
      <ChevronRight v-if="collapsed" :size="16" />
      <ChevronLeft v-else :size="16" />
      <span v-if="!collapsed">收起导航</span>
    </button>
    <button
      v-if="collapsed"
      type="button"
      class="workspace-navigation-toggle workspace-context-toggle"
      aria-label="显示上下文侧栏"
      title="显示上下文侧栏"
      @click="emit('toggleContext')"
    >
      <PanelLeftOpen :size="16" />
    </button>
  </nav>
</template>

<style scoped>
.workspace-navigation {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 10px 8px 8px;
  border-right: 1px solid var(--sb-border-subtle);
  background: var(--sb-bg-panel);
}

.workspace-navigation-group {
  display: grid;
  gap: 3px;
}

.workspace-navigation-item,
.workspace-navigation-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--sb-text-muted);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.workspace-navigation-item:hover,
.workspace-navigation-toggle:hover {
  background: var(--sb-bg-hover);
  color: var(--sb-text-primary);
}

.workspace-navigation-item:focus-visible,
.workspace-navigation-toggle:focus-visible {
  outline: 2px solid var(--sb-ring);
  outline-offset: 1px;
}

.workspace-navigation-item--active {
  background: var(--sb-bg-inset);
  color: var(--sb-text-primary);
}

.workspace-navigation-item--active :deep(svg) {
  color: var(--sb-accent-solid);
}

.workspace-navigation-spacer {
  flex: 1;
}

.workspace-navigation-toggle {
  margin-top: 3px;
  border-top: 1px solid var(--sb-border-subtle);
  border-radius: 0 0 6px 6px;
  padding-top: 4px;
}

.workspace-navigation-toggle + .workspace-context-toggle {
  justify-content: center;
  padding-inline: 0;
}
</style>
