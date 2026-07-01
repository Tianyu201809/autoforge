<script setup lang="ts">
import { Copy, Minus, PanelBottomClose, Pin, PinOff, Square, X } from 'lucide-vue-next'
import appIcon from '@build/icon.ico?url'
import { useWindowMaximized } from '../composables/useWindowMaximized'

defineProps<{
  breadcrumb: string
  subtitle?: string
  subtitleType?: 'success' | 'error'
  pinned?: boolean
}>()

const emit = defineEmits<{
  togglePin: []
  dock: []
}>()

const { isMaximized, toggleMaximize } = useWindowMaximized()

function minimize(): void {
  window.api.minimize()
}

function close(): void {
  window.api.close()
}
</script>

<template>
  <header
    class="h-11 flex-shrink-0 flex items-center justify-between px-4 border-b sb-border sb-titlebar backdrop-blur-xl"
    style="-webkit-app-region: drag"
  >
    <div class="flex items-center gap-3 min-w-0" style="-webkit-app-region: no-drag">
      <img :src="appIcon" alt="Autoforge" class="w-6 h-6 rounded-md object-cover flex-shrink-0" draggable="false" />
      <span class="text-[13px] font-semibold sb-text-primary tracking-wide flex-shrink-0">Autoforge</span>
      <span class="sb-text-faint flex-shrink-0">/</span>
      <span class="text-[13px] sb-text-muted font-medium truncate">{{ breadcrumb }}</span>
      <span
        v-if="subtitle"
        class="text-[11px] truncate hidden sm:inline"
        :class="subtitleType === 'error' ? 'text-red-400' : subtitleType === 'success' ? 'text-emerald-400' : 'sb-text-faint'"
      >{{ subtitle }}</span>
    </div>
    <div class="flex items-center gap-1 flex-shrink-0" style="-webkit-app-region: no-drag">
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-md transition-colors"
        :class="pinned ? 'text-[var(--sb-accent-solid)] sb-bg-inset' : 'sb-text-muted hover:sb-text-primary sb-bg-hover'"
        :title="pinned ? '取消置顶' : '窗口置顶'"
        @click="emit('togglePin')"
      >
        <PinOff v-if="pinned" class="w-4 h-4" :stroke-width="1.5" />
        <Pin v-else class="w-4 h-4" :stroke-width="1.5" />
      </button>
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors"
        title="收回主窗口"
        @click="emit('dock')"
      >
        <PanelBottomClose class="w-4 h-4" :stroke-width="1.5" />
      </button>
      <span class="w-px h-4 sb-bg-muted mx-0.5" aria-hidden="true" />
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors"
        title="最小化"
        @click="minimize"
      >
        <Minus class="w-4 h-4" :stroke-width="1.5" />
      </button>
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors"
        :title="isMaximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <Copy v-if="isMaximized" class="w-3 h-3" :stroke-width="1.5" />
        <Square v-else class="w-3 h-3" :stroke-width="1.5" />
      </button>
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
        title="关闭"
        @click="close"
      >
        <X class="w-4 h-4" :stroke-width="1.5" />
      </button>
    </div>
  </header>
</template>
