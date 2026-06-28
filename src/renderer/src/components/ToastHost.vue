<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-vue-next'
import { useToast } from '../composables/useToast'

const { toasts, dismissToast } = useToast()

const iconMap = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info
} as const

const styleMap = {
  error: {
    border: 'border-red-500/25',
    bg: 'bg-red-500/10',
    icon: 'text-red-400',
    title: 'text-red-300'
  },
  success: {
    border: 'border-emerald-500/25',
    bg: 'bg-emerald-500/10',
    icon: 'text-emerald-400',
    title: 'text-emerald-300'
  },
  info: {
    border: 'border-blue-500/25',
    bg: 'bg-blue-500/10',
    icon: 'text-blue-400',
    title: 'text-blue-300'
  }
} as const
</script>

<template>
  <div
    class="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none w-[min(100vw-2rem,22rem)]"
    aria-live="polite"
    aria-relevant="additions"
  >
    <TransitionGroup
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-2 scale-95"
      move-class="transition-transform duration-300"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto rounded-xl border backdrop-blur-md shadow-lg sb-bg-panel p-3.5"
        :class="[styleMap[toast.type].border, styleMap[toast.type].bg]"
        role="alert"
      >
        <div class="flex items-start gap-2.5">
          <component
            :is="iconMap[toast.type]"
            class="w-4 h-4 flex-shrink-0 mt-0.5"
            :class="styleMap[toast.type].icon"
            :stroke-width="1.5"
          />
          <div class="min-w-0 flex-1">
            <p class="text-[13px] font-medium leading-snug" :class="styleMap[toast.type].title">
              {{ toast.title }}
            </p>
            <p class="mt-1 text-[12px] sb-text-muted leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              {{ toast.message }}
            </p>
          </div>
          <button
            type="button"
            class="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-md sb-text-faint hover:sb-text-secondary hover:sb-bg-hover transition-colors"
            aria-label="关闭"
            @click="dismissToast(toast.id)"
          >
            <X class="w-3.5 h-3.5" :stroke-width="1.5" />
          </button>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>
