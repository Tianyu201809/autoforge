<script setup lang="ts">
import { computed } from 'vue'
import type { ScriptProgressSlice, ScriptRunProgress } from '../../../shared/script-progress'

const props = withDefaults(
  defineProps<{
    progress?: ScriptRunProgress
    compact?: boolean
  }>(),
  { compact: false }
)

function percent(slice?: ScriptProgressSlice): number | null {
  if (!slice || slice.total == null || slice.total <= 0) return null
  return Math.min(100, Math.round((slice.current / slice.total) * 100))
}

function ratioText(slice: ScriptProgressSlice): string {
  const unit = slice.unit ? ` ${slice.unit}` : ''
  if (slice.total != null && slice.total > 0) {
    return `${slice.current}/${slice.total}${unit}`
  }
  return `${slice.current}${unit}`
}

const stageTitle = computed(() => {
  const stage = props.progress?.stage
  if (!stage) return ''
  return stage.label?.trim() || stage.name
})

const taskPercent = computed(() => percent(props.progress?.task))
const totalPercent = computed(() => percent(props.progress?.total))

const hasContent = computed(
  () => !!(props.progress?.stage || props.progress?.task || props.progress?.total)
)
</script>

<template>
  <div v-if="hasContent" class="run-progress" :class="compact && 'run-progress--compact'">
    <div v-if="progress?.stage" class="run-progress__stage">
      <span class="run-progress__tag">阶段</span>
      <span class="run-progress__stage-title">{{ stageTitle }}</span>
      <span v-if="progress.stage.message" class="run-progress__stage-msg">{{ progress.stage.message }}</span>
    </div>

    <div v-if="progress?.total" class="run-progress__row">
      <div class="run-progress__label">
        <span>{{ progress.total.label?.trim() || '总进度' }}</span>
        <span class="run-progress__ratio tabular-nums">{{ ratioText(progress.total) }}</span>
      </div>
      <div v-if="totalPercent != null" class="run-progress__bar">
        <div class="run-progress__bar-fill" :style="{ width: `${totalPercent}%` }" />
      </div>
      <p v-if="progress.total.message" class="run-progress__message">{{ progress.total.message }}</p>
    </div>

    <div v-if="progress?.task" class="run-progress__row">
      <div class="run-progress__label">
        <span>{{ progress.task.label?.trim() || '当前任务' }}</span>
        <span class="run-progress__ratio tabular-nums">{{ ratioText(progress.task) }}</span>
      </div>
      <div v-if="taskPercent != null" class="run-progress__bar">
        <div class="run-progress__bar-fill run-progress__bar-fill--task" :style="{ width: `${taskPercent}%` }" />
      </div>
      <p v-if="progress.task.message" class="run-progress__message">{{ progress.task.message }}</p>
    </div>
  </div>
</template>

<style scoped>
.run-progress {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid var(--sb-border-subtle);
  background: color-mix(in srgb, var(--sb-bg-surface) 88%, transparent);
}

.run-progress--compact {
  padding: 0.375rem 0.5rem;
  gap: 0.375rem;
}

.run-progress__stage {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  font-size: 11px;
}

.run-progress__tag {
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--sb-accent-solid) 16%, transparent);
  color: var(--sb-accent-solid);
  font-weight: 600;
}

.run-progress__stage-title {
  color: var(--sb-text-secondary);
  font-weight: 500;
}

.run-progress__stage-msg {
  color: var(--sb-text-faint);
}

.run-progress__row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.run-progress__label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 11px;
  color: var(--sb-text-muted);
}

.run-progress__ratio {
  color: var(--sb-text-secondary);
}

.run-progress__bar {
  height: 4px;
  border-radius: 9999px;
  background: var(--sb-bg-inset);
  overflow: hidden;
}

.run-progress__bar-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--sb-accent-solid), color-mix(in srgb, var(--sb-accent-solid) 70%, white));
  transition: width 0.2s ease;
}

.run-progress__bar-fill--task {
  opacity: 0.85;
}

.run-progress__message {
  font-size: 10px;
  color: var(--sb-text-faint);
}
</style>
