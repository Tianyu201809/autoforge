<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    maxWidth?: 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl'
    zIndex?: number
    ariaLabelledby?: string
    inline?: boolean
  }>(),
  {
    maxWidth: '4xl',
    zIndex: 200
  }
)

const emit = defineEmits<{ close: [] }>()

const maxWidthClass = computed(() => {
  const map = {
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-3xl',
    '2xl': 'max-w-4xl',
    '3xl': 'max-w-5xl',
    '4xl': 'max-w-6xl',
    '5xl': 'max-w-[min(96vw,72rem)]'
  } as const
  return map[props.maxWidth]
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) {
    e.preventDefault()
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown)
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <Transition name="app-feature-modal">
      <div
        v-if="open"
        :class="inline ? 'app-feature-modal-inline' : 'fixed inset-0 flex items-center justify-center p-4 sm:p-6'"
        :style="inline ? undefined : { zIndex }"
        @click.self="emit('close')"
      >
        <div v-if="!inline" class="absolute inset-0 bg-stone-950/45 backdrop-blur-[4px]" aria-hidden="true" />

        <div
          class="app-feature-modal-panel relative w-full rounded-xl border sb-border sb-bg-panel shadow-[0_28px_80px_rgba(28,25,23,0.22)] flex flex-col max-h-[min(92vh,880px)] overflow-hidden"
          :class="inline ? 'app-feature-modal-panel--inline' : maxWidthClass"
          role="dialog"
          :aria-modal="inline ? undefined : 'true'"
          :aria-labelledby="ariaLabelledby"
          @click.stop
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-feature-modal-inline {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.app-feature-modal-panel--inline {
  width: 100%;
  max-width: none;
  max-height: none;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.app-feature-modal-enter-active,
.app-feature-modal-leave-active {
  transition: opacity 0.24s ease;
}

.app-feature-modal-enter-from,
.app-feature-modal-leave-to {
  opacity: 0;
}

.app-feature-modal-enter-active .app-feature-modal-panel,
.app-feature-modal-leave-active .app-feature-modal-panel {
  transition:
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.24s ease;
}

.app-feature-modal-enter-from .app-feature-modal-panel,
.app-feature-modal-leave-to .app-feature-modal-panel {
  transform: scale(0.965) translateY(10px);
  opacity: 0;
}
</style>
