<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import {
  DEFAULT_GLOBAL_SHORTCUT,
  formatAcceleratorForDisplay,
  isValidAccelerator
} from '../../../shared/accelerator'
import { keyboardEventToAccelerator } from '../utils/keyboard-accelerator'

const props = defineProps<{
  modelValue: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const recording = ref(false)
const isMac = navigator.platform.toUpperCase().includes('MAC')

const display = computed(() =>
  formatAcceleratorForDisplay(props.modelValue || DEFAULT_GLOBAL_SHORTCUT, isMac)
)

/** 开始监听按键以录制快捷键 */
function startRecording(): void {
  if (props.disabled) return
  recording.value = true
  window.addEventListener('keydown', onKeyDown, true)
}

/** 停止录制并移除监听 */
function stopRecording(): void {
  recording.value = false
  window.removeEventListener('keydown', onKeyDown, true)
}

function onKeyDown(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    stopRecording()
    return
  }

  const accelerator = keyboardEventToAccelerator(event)
  if (accelerator && isValidAccelerator(accelerator)) {
    emit('update:modelValue', accelerator)
    stopRecording()
  }
}

function resetDefault(): void {
  emit('update:modelValue', DEFAULT_GLOBAL_SHORTCUT)
}

onUnmounted(() => {
  stopRecording()
})
</script>

<template>
  <div class="flex items-center gap-2 flex-wrap">
    <button
      type="button"
      class="h-9 min-w-[10rem] px-3 rounded-lg border text-[13px] font-mono outline-none transition-colors"
      :class="
        disabled
          ? 'sb-border-subtle sb-text-faint cursor-not-allowed opacity-60'
          : recording
            ? 'sb-border-accent sb-bg-inset sb-text-primary ring-1 ring-[var(--sb-accent)]'
            : 'sb-input sb-border sb-text-secondary hover:sb-bg-hover'
      "
      :disabled="disabled"
      @click="startRecording"
    >
      {{ recording ? '按下新快捷键…' : display }}
    </button>
    <button
      type="button"
      class="h-9 px-3 rounded-lg sb-bg-inset sb-text-muted text-[12px] flex items-center gap-1 disabled:opacity-50"
      :disabled="disabled || modelValue === DEFAULT_GLOBAL_SHORTCUT"
      title="恢复默认"
      @click="resetDefault"
    >
      <RotateCcw class="w-3.5 h-3.5" :stroke-width="1.5" />
      默认
    </button>
  </div>
</template>
