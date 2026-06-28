<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { PencilLine } from 'lucide-vue-next'
import { resolvePrompt, usePromptDialog } from '../composables/usePromptDialog'

const { state } = usePromptDialog()
const inputRef = ref<HTMLInputElement | null>(null)

function onCancel(): void {
  resolvePrompt(null)
}

function onConfirm(): void {
  resolvePrompt(state.value.value)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    onConfirm()
  }
}

watch(
  () => state.value.open,
  (open) => {
    if (!open) return
    void nextTick(() => {
      inputRef.value?.focus()
      inputRef.value?.select()
    })
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-dialog">
      <div
        v-if="state.open"
        class="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6"
        @click.self="onCancel"
      >
        <div class="absolute inset-0 bg-stone-950/40 backdrop-blur-[3px]" aria-hidden="true" />

        <div
          class="confirm-dialog-panel relative w-full max-w-md rounded-xl border sb-border sb-bg-panel shadow-[0_24px_64px_rgba(28,25,23,0.18)] overflow-hidden"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="state.open ? 'prompt-dialog-title' : undefined"
          @click.stop
        >
          <div class="relative flex items-start gap-3 px-5 py-4 border-b sb-border-subtle confirm-dialog-header overflow-hidden">
            <div
              class="absolute inset-x-0 top-0 h-px pointer-events-none"
              style="background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sb-accent-solid) 50%, transparent), transparent)"
              aria-hidden="true"
            />
            <div class="w-9 h-9 rounded-lg border sb-border-subtle sb-bg-inset flex items-center justify-center flex-shrink-0">
              <PencilLine class="w-4 h-4 text-[var(--sb-accent-solid)]" :stroke-width="1.5" />
            </div>
            <div class="min-w-0 pt-0.5 flex-1">
              <h2 id="prompt-dialog-title" class="text-[15px] font-semibold sb-text-primary tracking-tight">
                {{ state.title }}
              </h2>
              <p v-if="state.message" class="text-[13px] sb-text-muted mt-1.5 leading-relaxed">
                {{ state.message }}
              </p>
            </div>
          </div>

          <div class="px-5 py-4">
            <label v-if="state.label" class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">
              {{ state.label }}
            </label>
            <input
              ref="inputRef"
              v-model="state.value"
              type="text"
              class="mt-1.5 w-full h-9 px-3 rounded-lg sb-bg-input border sb-border text-[13px] sb-text-primary outline-none focus:sb-input"
              :placeholder="state.placeholder"
              @keydown="onKeydown"
            />
          </div>

          <div class="flex items-center justify-end gap-2 px-5 py-3.5 border-t sb-border-subtle">
            <button
              type="button"
              class="h-9 px-4 rounded-lg border sb-border sb-bg-surface sb-text-secondary text-[13px] hover:sb-text-primary hover:sb-bg-hover transition-colors"
              @click="onCancel"
            >
              {{ state.cancelLabel }}
            </button>
            <button
              type="button"
              class="h-9 px-4 rounded-lg sb-btn-accent text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
              :disabled="!state.value.trim()"
              @click="onConfirm"
            >
              {{ state.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-dialog-header {
  background: color-mix(in srgb, var(--sb-accent-solid) 8%, var(--sb-bg-panel));
  box-shadow: inset 3px 0 0 var(--sb-accent-solid);
}

.confirm-dialog-enter-active,
.confirm-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.confirm-dialog-enter-from,
.confirm-dialog-leave-to {
  opacity: 0;
}

.confirm-dialog-enter-active .confirm-dialog-panel,
.confirm-dialog-leave-active .confirm-dialog-panel {
  transition:
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.2s ease;
}

.confirm-dialog-enter-from .confirm-dialog-panel,
.confirm-dialog-leave-to .confirm-dialog-panel {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}
</style>
