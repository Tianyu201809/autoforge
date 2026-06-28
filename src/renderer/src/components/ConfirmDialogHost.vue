<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import { resolveConfirm, useConfirmDialog } from '../composables/useConfirmDialog'

const { state } = useConfirmDialog()

function onCancel(): void {
  resolveConfirm(false)
}

function onConfirm(): void {
  resolveConfirm(true)
}
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
          role="alertdialog"
          :aria-labelledby="state.open ? 'confirm-dialog-title' : undefined"
          :aria-describedby="state.open ? 'confirm-dialog-message' : undefined"
          @click.stop
        >
          <div
            class="relative flex items-start gap-3 px-5 py-4 border-b sb-border-subtle confirm-dialog-header overflow-hidden"
            :class="state.variant === 'danger' ? 'confirm-dialog-header-danger' : ''"
          >
            <div
              class="absolute inset-x-0 top-0 h-px pointer-events-none"
              :style="
                state.variant === 'danger'
                  ? 'background: linear-gradient(90deg, transparent, color-mix(in srgb, rgb(248 113 113) 50%, transparent), transparent)'
                  : 'background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sb-accent-solid) 50%, transparent), transparent)'
              "
              aria-hidden="true"
            />
            <div
              class="w-9 h-9 rounded-lg border sb-border-subtle flex items-center justify-center flex-shrink-0"
              :class="state.variant === 'danger' ? 'bg-red-500/10' : 'sb-bg-inset'"
            >
              <AlertTriangle
                class="w-4 h-4"
                :class="state.variant === 'danger' ? 'text-red-400' : 'text-[var(--sb-accent-solid)]'"
                :stroke-width="1.5"
              />
            </div>
            <div class="min-w-0 pt-0.5">
              <h2 id="confirm-dialog-title" class="text-[15px] font-semibold sb-text-primary tracking-tight">
                {{ state.title }}
              </h2>
              <p
                id="confirm-dialog-message"
                class="text-[13px] sb-text-muted mt-1.5 leading-relaxed whitespace-pre-wrap"
              >
                {{ state.message }}
              </p>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 px-5 py-3.5">
            <button
              type="button"
              class="h-9 px-4 rounded-lg border sb-border sb-bg-surface sb-text-secondary text-[13px] hover:sb-text-primary hover:sb-bg-hover transition-colors"
              @click="onCancel"
            >
              {{ state.cancelLabel }}
            </button>
            <button
              type="button"
              class="h-9 px-4 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-90"
              :class="
                state.variant === 'danger'
                  ? 'bg-red-500/90 text-white hover:bg-red-500'
                  : 'sb-btn-accent'
              "
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

.confirm-dialog-header-danger {
  background: color-mix(in srgb, rgb(248 113 113) 8%, var(--sb-bg-panel));
  box-shadow: inset 3px 0 0 rgb(248 113 113 / 0.7);
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
