<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useSlots } from 'vue'
import type { WorkspaceNavigationState } from '../composables/useWorkspaceNavigation'

const props = defineProps<{ layout: WorkspaceNavigationState }>()
const emit = defineEmits<{
  resize: [widths: Partial<Pick<WorkspaceNavigationState, 'navWidth' | 'contextWidth' | 'inspectorWidth'>>]
  closeInspector: []
}>()
const slots = useSlots()
const narrow = ref(false)
const inspectorVisible = computed(() => Boolean(slots.inspector) && props.layout.inspectorOpen)

function updateViewport(): void {
  narrow.value = window.innerWidth < 1180
}

function startResize(event: PointerEvent, target: 'nav' | 'context' | 'inspector'): void {
  if (event.button !== 0) return
  event.preventDefault()
  const startX = event.clientX
  const startWidth = target === 'nav'
    ? props.layout.navWidth
    : target === 'context'
      ? props.layout.contextWidth
      : props.layout.inspectorWidth
  const direction = target === 'inspector' ? -1 : 1
  const onMove = (moveEvent: PointerEvent): void => {
    const width = startWidth + (moveEvent.clientX - startX) * direction
    emit('resize', target === 'nav' ? { navWidth: width } : target === 'context' ? { contextWidth: width } : { inspectorWidth: width })
  }
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function resizeByKeyboard(event: KeyboardEvent, target: 'nav' | 'context' | 'inspector'): void {
  const step = event.shiftKey ? 24 : 8
  const direction = target === 'inspector' ? -1 : 1
  let width = target === 'nav'
    ? props.layout.navWidth
    : target === 'context'
      ? props.layout.contextWidth
      : props.layout.inspectorWidth
  if (event.key === 'ArrowRight') width += step * direction
  else if (event.key === 'ArrowLeft') width -= step * direction
  else return
  event.preventDefault()
  emit('resize', target === 'nav' ? { navWidth: width } : target === 'context' ? { contextWidth: width } : { inspectorWidth: width })
}

onMounted(() => {
  updateViewport()
  window.addEventListener('resize', updateViewport)
})
onUnmounted(() => {
  window.removeEventListener('resize', updateViewport)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})
</script>

<template>
  <div class="workspace-shell" :class="{ 'workspace-shell--narrow': narrow }">
    <aside class="workspace-shell-navigation" :style="{ width: layout.navCollapsed ? '56px' : `${layout.navWidth}px` }">
      <slot name="navigation" />
    </aside>
    <div
      v-if="!layout.navCollapsed"
      class="workspace-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整主导航宽度"
      tabindex="0"
      @pointerdown="startResize($event, 'nav')"
      @keydown="resizeByKeyboard($event, 'nav')"
    />

    <slot name="context" />
    <div
      v-if="slots.context && !layout.contextCollapsed"
      class="workspace-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整上下文侧栏宽度"
      tabindex="0"
      @pointerdown="startResize($event, 'context')"
      @keydown="resizeByKeyboard($event, 'context')"
    />

    <main class="workspace-shell-main">
      <slot />
    </main>

    <template v-if="inspectorVisible">
      <button
        v-if="narrow"
        type="button"
        class="workspace-inspector-backdrop"
        aria-label="关闭检查面板"
        @click="emit('closeInspector')"
      />
      <div
        v-if="!narrow"
        class="workspace-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整检查面板宽度"
        tabindex="0"
        @pointerdown="startResize($event, 'inspector')"
        @keydown="resizeByKeyboard($event, 'inspector')"
      />
      <aside
        class="workspace-shell-inspector"
        :class="narrow && 'workspace-shell-inspector--drawer'"
        :style="{ width: narrow ? 'min(360px, calc(100vw - 72px))' : `${layout.inspectorWidth}px` }"
      >
        <slot name="inspector" />
      </aside>
    </template>
  </div>
</template>

<style scoped>
.workspace-shell {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--sb-bg-base);
}

.workspace-shell-navigation {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  min-width: 56px;
  height: 100%;
  overflow: hidden;
  transition: width 120ms ease;
}

.workspace-shell-main {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-shell-inspector {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 0 0 auto;
  min-width: 260px;
  height: 100%;
  overflow: hidden;
  border-left: 1px solid var(--sb-border-subtle);
  background: var(--sb-bg-panel);
}

.workspace-shell-inspector--drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  min-width: 0;
  box-shadow: -16px 0 40px rgba(0, 0, 0, 0.2);
}

.workspace-inspector-backdrop {
  position: absolute;
  z-index: 1;
  inset: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.28);
}

.workspace-resizer {
  position: relative;
  z-index: 3;
  width: 5px;
  flex: 0 0 5px;
  margin-inline: -2px;
  cursor: col-resize;
  touch-action: none;
}

.workspace-resizer::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: transparent;
  content: '';
}

.workspace-resizer:hover::after,
.workspace-resizer:focus-visible::after {
  background: var(--sb-accent-solid);
}

.workspace-resizer:focus-visible {
  outline: none;
}

@media (max-width: 1180px) {
  .workspace-shell--narrow .workspace-shell-inspector {
    border-left: 1px solid var(--sb-border-subtle);
  }
}

@media (prefers-reduced-motion: reduce) {
  .workspace-shell-navigation {
    transition: none;
  }
}
</style>
