<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Copy, CircleDot, Minus, Notebook, PanelBottom, Square, X } from 'lucide-vue-next'
import appIcon from '@build/icon.png?url'
import ThemeToggle from './ThemeToggle.vue'
import { useWindowMaximized } from '../composables/useWindowMaximized'
import { useGlobalEnvNotebook } from '../composables/useGlobalEnvNotebook'

defineProps<{
  breadcrumb: string
}>()

const { isMaximized, toggleMaximize } = useWindowMaximized()
const { active: notebookActive, toggle: toggleNotebook } = useGlobalEnvNotebook()

const floatingMode = ref(false)
const trayMode = ref(false)

let offModeChange: (() => void) | undefined

onMounted(async () => {
  const mode = await window.api.getMode()
  floatingMode.value = !!mode.floatingMode
  trayMode.value = !!mode.trayMode
  offModeChange = window.api.onModeChange((next) => {
    floatingMode.value = !!next.floatingMode
    trayMode.value = !!next.trayMode
  })
})

onUnmounted(() => {
  offModeChange?.()
})

async function toggleFloating(): Promise<void> {
  const next = await window.api.setMode({ floatingMode: !floatingMode.value })
  floatingMode.value = !!next.floatingMode
}

function minimize(): void {
  window.api.minimize()
}

function hideToTray(): void {
  void window.api.hide()
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
    <div class="flex items-center gap-3" style="-webkit-app-region: no-drag">
      <img :src="appIcon" alt="Autoforge" class="w-6 h-6 rounded-md object-cover" draggable="false" />
      <span class="text-[13px] font-semibold sb-text-primary tracking-wide">Autoforge</span>
      <span class="sb-text-faint">/</span>
      <span class="text-[13px] sb-text-muted font-medium">{{ breadcrumb }}</span>
    </div>
    <div class="flex items-center gap-1" style="-webkit-app-region: no-drag">
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-md transition-colors"
        :class="notebookActive ? 'text-[var(--sb-accent-solid)] sb-bg-inset' : 'sb-text-muted hover:sb-text-primary sb-bg-hover'"
        title="全局变量笔记本"
        @click="toggleNotebook"
      >
        <Notebook class="w-4 h-4" :stroke-width="1.5" />
      </button>
      <ThemeToggle />
      <button
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-md transition-colors"
        :class="floatingMode ? 'text-[var(--sb-accent-solid)] sb-bg-inset' : 'sb-text-muted hover:sb-text-primary sb-bg-hover'"
        :title="floatingMode ? '关闭悬浮球' : '开启悬浮球'"
        @click="toggleFloating"
      >
        <CircleDot class="w-4 h-4" :stroke-width="1.5" />
      </button>
      <button
        v-if="trayMode"
        type="button"
        class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors"
        title="隐藏到托盘"
        @click="hideToTray"
      >
        <PanelBottom class="w-4 h-4" :stroke-width="1.5" />
      </button>
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
        :title="trayMode ? '隐藏到托盘' : '关闭'"
        @click="close"
      >
        <X class="w-4 h-4" :stroke-width="1.5" />
      </button>
    </div>
  </header>
</template>
