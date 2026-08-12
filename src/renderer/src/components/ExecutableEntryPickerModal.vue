<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Binary, X } from 'lucide-vue-next'
import type { ExecutableCandidate } from '../../../shared/types/script'

const props = defineProps<{
  open: boolean
  candidates: ExecutableCandidate[]
}>()

const emit = defineEmits<{
  confirm: [entry: string]
  cancel: []
}>()

const selectedEntry = ref('')
const selected = computed(() => props.candidates.find((item) => item.entry === selectedEntry.value))

watch(
  () => [props.open, props.candidates] as const,
  ([open, candidates]) => {
    selectedEntry.value = open && candidates.length === 1 ? candidates[0].entry : ''
  },
  { immediate: true }
)

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function confirmSelection(): void {
  if (selectedEntry.value) emit('confirm', selectedEntry.value)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-dialog">
      <div
        v-if="open"
        class="fixed inset-0 z-[310] flex items-center justify-center p-4 sm:p-6"
        @click.self="emit('cancel')"
      >
        <div class="absolute inset-0 bg-stone-950/40 backdrop-blur-[3px]" aria-hidden="true" />
        <section
          class="relative w-full max-w-xl overflow-hidden rounded-lg border sb-border sb-bg-panel shadow-[0_24px_64px_rgba(28,25,23,0.18)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="executable-picker-title"
          @click.stop
        >
          <header class="flex items-start gap-3 border-b sb-border-subtle px-5 py-4">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border sb-border-subtle sb-bg-inset">
              <Binary class="h-4 w-4 text-[var(--sb-accent-solid)]" :stroke-width="1.5" />
            </div>
            <div class="min-w-0 flex-1">
              <h2 id="executable-picker-title" class="text-[15px] font-semibold sb-text-primary">选择程序入口</h2>
              <p class="mt-1 text-[12px] leading-relaxed sb-text-muted">该包包含多个可执行程序，请选择 Autoforge 启动的入口。</p>
            </div>
            <button type="button" class="flex h-8 w-8 items-center justify-center rounded-md sb-text-faint hover:sb-bg-hover hover:sb-text-primary" title="取消" @click="emit('cancel')">
              <X class="h-4 w-4" :stroke-width="1.5" />
            </button>
          </header>

          <div class="max-h-[min(55vh,420px)] overflow-y-auto p-3">
            <label
              v-for="candidate in candidates"
              :key="candidate.entry"
              class="flex min-h-14 cursor-pointer items-center gap-3 border-b sb-border-subtle px-3 py-2.5 last:border-b-0 hover:sb-bg-hover"
              :class="candidate.entry === selected?.entry ? 'sb-bg-inset' : ''"
            >
              <input v-model="selectedEntry" type="radio" name="executable-entry" :value="candidate.entry" />
              <span class="w-14 shrink-0 rounded border sb-border px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold uppercase sb-text-secondary">{{ candidate.format }}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-mono text-[12px] sb-text-primary" :title="candidate.entry">{{ candidate.entry }}</span>
                <span class="mt-0.5 block text-[10px] sb-text-faint">{{ formatBytes(candidate.size) }}</span>
              </span>
            </label>
          </div>

          <footer class="flex items-center justify-end gap-2 border-t sb-border-subtle px-5 py-3.5">
            <button type="button" class="h-9 rounded-lg border sb-border px-4 text-[13px] sb-bg-surface sb-text-secondary hover:sb-bg-hover" @click="emit('cancel')">取消</button>
            <button type="button" class="h-9 rounded-lg px-4 text-[13px] font-medium sb-btn-accent disabled:cursor-not-allowed disabled:opacity-40" :disabled="!selectedEntry" @click="confirmSelection">使用此入口</button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
