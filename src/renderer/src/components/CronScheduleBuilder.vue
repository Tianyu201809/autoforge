<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  buildCronExpression,
  DEFAULT_CRON_STATE,
  describeCronSchedule,
  parseCronExpression,
  type CronScheduleMode,
  type CronScheduleState,
  weekdayLabel
} from '../../../shared/cron-schedule'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const modeOptions: { value: CronScheduleMode; label: string }[] = [
  { value: 'interval-minutes', label: '按分钟间隔' },
  { value: 'interval-hours', label: '按小时间隔' },
  { value: 'daily', label: '每天固定时间' },
  { value: 'weekly', label: '每周固定时间' },
  { value: 'monthly', label: '每月固定日期' }
]

const state = ref<CronScheduleState>({ ...DEFAULT_CRON_STATE })
const syncingFromProp = ref(false)

function applyExpression(expression: string): void {
  const parsed = parseCronExpression(expression)
  state.value = parsed ? { ...parsed } : { ...DEFAULT_CRON_STATE }
}

function emitExpression(): void {
  if (syncingFromProp.value) return
  emit('update:modelValue', buildCronExpression(state.value))
}

watch(
  () => props.modelValue,
  (value) => {
    syncingFromProp.value = true
    applyExpression(value)
    syncingFromProp.value = false
  },
  { immediate: true }
)

watch(state, () => emitExpression(), { deep: true })

const summary = computed(() => describeCronSchedule(state.value))

function toggleWeekDay(day: number): void {
  const days = state.value.weekDays
  if (days.includes(day)) {
    state.value.weekDays = days.filter((d) => d !== day)
  } else {
    state.value.weekDays = [...days, day].sort((a, b) => a - b)
  }
}

const inputClass =
  'h-8 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input'
const selectClass = `${inputClass} w-full`
</script>

<template>
  <div class="space-y-3">
    <div>
      <label class="text-[12px] sb-text-muted">执行频率</label>
      <select v-model="state.mode" :class="selectClass" class="mt-1">
        <option v-for="opt in modeOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <div v-if="state.mode === 'interval-minutes'" class="flex items-center gap-2">
      <span class="text-[12px] sb-text-muted shrink-0">每</span>
      <input
        v-model.number="state.intervalMinutes"
        type="number"
        min="1"
        max="59"
        :class="inputClass"
        class="w-20"
      />
      <span class="text-[12px] sb-text-muted">分钟</span>
    </div>

    <div v-else-if="state.mode === 'interval-hours'" class="space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-[12px] sb-text-muted shrink-0">每</span>
        <input
          v-model.number="state.intervalHours"
          type="number"
          min="1"
          max="23"
          :class="inputClass"
          class="w-20"
        />
        <span class="text-[12px] sb-text-muted">小时</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[12px] sb-text-muted shrink-0">在第</span>
        <input
          v-model.number="state.minuteAt"
          type="number"
          min="0"
          max="59"
          :class="inputClass"
          class="w-20"
        />
        <span class="text-[12px] sb-text-muted">分钟执行</span>
      </div>
    </div>

    <div v-else-if="state.mode === 'daily'" class="flex items-center gap-2">
      <span class="text-[12px] sb-text-muted shrink-0">时间</span>
      <input
        v-model.number="state.hourAt"
        type="number"
        min="0"
        max="23"
        :class="inputClass"
        class="w-16"
      />
      <span class="text-[12px] sb-text-muted">:</span>
      <input
        v-model.number="state.minuteAt"
        type="number"
        min="0"
        max="59"
        :class="inputClass"
        class="w-16"
      />
    </div>

    <div v-else-if="state.mode === 'weekly'" class="space-y-2">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="day in 7"
          :key="day - 1"
          type="button"
          class="h-7 min-w-7 px-2 rounded-md border text-[12px] transition-colors"
          :class="
            state.weekDays.includes(day - 1)
              ? 'sb-btn-accent border-transparent'
              : 'sb-bg-input sb-border sb-text-muted hover:sb-text-secondary'
          "
          @click="toggleWeekDay(day - 1)"
        >
          {{ weekdayLabel(day - 1) }}
        </button>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[12px] sb-text-muted shrink-0">时间</span>
        <input
          v-model.number="state.hourAt"
          type="number"
          min="0"
          max="23"
          :class="inputClass"
          class="w-16"
        />
        <span class="text-[12px] sb-text-muted">:</span>
        <input
          v-model.number="state.minuteAt"
          type="number"
          min="0"
          max="59"
          :class="inputClass"
          class="w-16"
        />
      </div>
    </div>

    <div v-else-if="state.mode === 'monthly'" class="space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-[12px] sb-text-muted shrink-0">每月</span>
        <input
          v-model.number="state.dayOfMonth"
          type="number"
          min="1"
          max="31"
          :class="inputClass"
          class="w-20"
        />
        <span class="text-[12px] sb-text-muted">日</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[12px] sb-text-muted shrink-0">时间</span>
        <input
          v-model.number="state.hourAt"
          type="number"
          min="0"
          max="23"
          :class="inputClass"
          class="w-16"
        />
        <span class="text-[12px] sb-text-muted">:</span>
        <input
          v-model.number="state.minuteAt"
          type="number"
          min="0"
          max="59"
          :class="inputClass"
          class="w-16"
        />
      </div>
    </div>

    <div class="rounded-lg border sb-border-subtle sb-bg-surface px-3 py-2">
      <p class="text-[12px] sb-text-secondary">{{ summary }}</p>
      <p class="mt-1 text-[10px] sb-text-faint font-mono">{{ modelValue }}</p>
    </div>
  </div>
</template>
