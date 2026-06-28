<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { useTheme, type ThemeId } from '../composables/useTheme'

const props = defineProps<{
  variant?: 'icon' | 'segment'
}>()

const { theme, setTheme, toggleTheme } = useTheme()

function pick(id: ThemeId): void {
  setTheme(id)
}
</script>

<template>
  <!-- 标题栏图标切换 -->
  <button
    v-if="(variant ?? 'icon') === 'icon'"
    type="button"
    class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors"
    :title="theme === 'dark' ? '切换浅色皮肤' : '切换深色皮肤'"
    @click="toggleTheme"
  >
    <Sun v-if="theme === 'dark'" class="w-4 h-4" :stroke-width="1.5" />
    <Moon v-else class="w-4 h-4" :stroke-width="1.5" />
  </button>

  <!-- 设置页分段选择 -->
  <div v-else class="flex p-0.5 rounded-lg border sb-border sb-bg-muted gap-0.5">
    <button
      type="button"
      class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[12px] transition-all"
      :class="theme === 'dark' ? 'sb-bg-elevated sb-text-primary shadow-sm font-medium' : 'sb-text-muted hover:sb-text-secondary'"
      @click="pick('dark')"
    >
      <Moon class="w-3.5 h-3.5" :stroke-width="1.5" />
      曜石深色
    </button>
    <button
      type="button"
      class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[12px] transition-all"
      :class="theme === 'light' ? 'sb-bg-elevated sb-text-primary shadow-sm font-medium' : 'sb-text-muted hover:sb-text-secondary'"
      @click="pick('light')"
    >
      <Sun class="w-3.5 h-3.5" :stroke-width="1.5" />
      暖纸浅色
    </button>
  </div>
</template>
