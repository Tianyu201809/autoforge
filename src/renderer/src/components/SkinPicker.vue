<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import SkinPreviewIcon from './SkinPreviewIcon.vue'
import { useTheme, type SkinId, type SkinPreset } from '../composables/useTheme'

const { skin, setSkin, darkSkins, lightSkins } = useTheme()

function pick(id: SkinId): void {
  setSkin(id)
}

/** 预览区渐变：强调色光晕 + 主题色调底色 */
function previewBackground(item: SkinPreset): string {
  const { base, panel, accent } = item.preview
  return [
    `radial-gradient(ellipse 90% 80% at 50% -10%, color-mix(in srgb, ${accent} 32%, transparent) 0%, transparent 65%)`,
    `linear-gradient(155deg, ${base} 0%, ${panel} 52%, ${base} 100%)`
  ].join(', ')
}
</script>

<template>
  <div class="skin-picker space-y-4">
    <div class="space-y-2">
      <p class="text-[11px] font-semibold tracking-wider uppercase sb-text-faint">深色皮肤</p>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="item in darkSkins"
          :key="item.id"
          type="button"
          class="skin-card group"
          :class="{ 'skin-card--active': skin === item.id }"
          :aria-pressed="skin === item.id"
          @click="pick(item.id)"
        >
          <div
            class="skin-card__preview skin-card__preview--light"
            :style="{
              background: previewBackground(item),
              borderColor: `color-mix(in srgb, ${item.preview.accent} 18%, transparent)`
            }"
          >
            <SkinPreviewIcon :skin-id="item.id" />
          </div>
          <div class="skin-card__meta">
            <span class="skin-card__name">{{ item.name }}</span>
            <span class="skin-card__tagline">{{ item.tagline }}</span>
          </div>
          <span v-if="skin === item.id" class="skin-card__check">
            <Check class="w-3 h-3" :stroke-width="2.5" />
          </span>
        </button>
      </div>
    </div>

    <div class="space-y-2">
      <p class="text-[11px] font-semibold tracking-wider uppercase sb-text-faint">浅色皮肤</p>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="item in lightSkins"
          :key="item.id"
          type="button"
          class="skin-card group"
          :class="{ 'skin-card--active': skin === item.id }"
          :aria-pressed="skin === item.id"
          @click="pick(item.id)"
        >
          <div
            class="skin-card__preview skin-card__preview--light"
            :style="{
              background: previewBackground(item),
              borderColor: `color-mix(in srgb, ${item.preview.accent} 18%, transparent)`
            }"
          >
            <SkinPreviewIcon :skin-id="item.id" />
          </div>
          <div class="skin-card__meta">
            <span class="skin-card__name">{{ item.name }}</span>
            <span class="skin-card__tagline">{{ item.tagline }}</span>
          </div>
          <span v-if="skin === item.id" class="skin-card__check">
            <Check class="w-3 h-3" :stroke-width="2.5" />
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skin-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem;
  border-radius: 0.625rem;
  border: 1px solid var(--sb-border-subtle);
  background: var(--sb-bg-surface);
  text-align: left;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.15s ease;
}

.skin-card:hover {
  border-color: var(--sb-border);
  transform: translateY(-1px);
}

.skin-card--active {
  border-color: var(--sb-accent-solid);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--sb-accent-solid) 35%, transparent),
    0 4px 16px color-mix(in srgb, var(--sb-accent-solid) 12%, transparent);
}

.skin-card__preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 3.25rem;
  border-radius: 0.375rem;
  overflow: hidden;
  border: 1px solid transparent;
}

.skin-card__preview--light {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.skin-card__meta {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.skin-card__name {
  font-size: 12px;
  font-weight: 600;
  color: var(--sb-text-primary);
}

.skin-card__tagline {
  font-size: 10px;
  line-height: 1.3;
  color: var(--sb-text-faint);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skin-card__check {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 9999px;
  background: var(--sb-accent-solid);
  color: var(--sb-accent-text);
}
</style>
