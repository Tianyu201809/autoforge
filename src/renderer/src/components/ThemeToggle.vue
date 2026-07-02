<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { useTheme } from '../composables/useTheme'

const { mode, preset, toggleTheme } = useTheme()
</script>

<template>
  <button
    type="button"
    class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-primary sb-bg-hover transition-colors"
    :title="mode === 'dark' ? `切换至浅色（${preset.name} 对应系列）` : `切换至深色（${preset.name} 对应系列）`"
    @click="toggleTheme"
  >
    <Sun v-if="mode === 'dark'" class="w-4 h-4" :stroke-width="1.5" />
    <Moon v-else class="w-4 h-4" :stroke-width="1.5" />
  </button>
</template>
