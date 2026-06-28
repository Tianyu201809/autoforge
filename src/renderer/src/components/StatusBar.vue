<template>
  <footer class="h-6 flex-shrink-0 flex items-center justify-between px-4 sb-bg-panel border-t sb-border-subtle text-[10px] sb-text-faint">
    <div class="flex items-center gap-3">
      <span class="flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        引擎就绪
      </span>
      <span>Node.js v{{ nodeVersion }}</span>
      <span>Electron v{{ electronVersion }}</span>
    </div>
    <div class="flex items-center gap-3">
      <span>内存 {{ memoryMb }} MB</span>
      <span>{{ runningCount }} 脚本运行中</span>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

defineProps<{
  runningCount: number
}>()

const nodeVersion = ref('')
const electronVersion = ref('')
const memoryMb = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  nodeVersion.value = window.api.versions.node
  electronVersion.value = window.api.versions.electron

  const poll = async (): Promise<void> => {
    try {
      const mem = await window.autoforge.system.memory()
      memoryMb.value = Math.round(mem.workingSetSize / 1024 / 1024)
    } catch {
      memoryMb.value = 0
    }
  }
  void poll()
  timer = setInterval(poll, 5000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>
