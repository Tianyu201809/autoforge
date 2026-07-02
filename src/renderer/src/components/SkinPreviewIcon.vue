<script setup lang="ts">
import type { SkinId } from '../composables/useTheme'

defineProps<{
  skinId: SkinId
}>()
</script>

<template>
  <!-- 锻炉：仿暖纸 — 浅色卡片 + 细线 + 橙色锤印 -->
  <svg
    v-if="skinId === 'forge'"
    class="skin-preview-icon"
    viewBox="0 0 72 52"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect x="14" y="8" width="44" height="36" rx="2" fill="#fdf4eb" stroke="#e7d5c4" stroke-width="0.8" />
    <path d="M20 18 H52" stroke="#e7e5e4" stroke-width="1" stroke-linecap="round" />
    <path d="M20 24 H48" stroke="#f0ebe3" stroke-width="1" stroke-linecap="round" />
    <path d="M20 30 H44" stroke="#f0ebe3" stroke-width="1" stroke-linecap="round" />
    <path d="M26 36 Q32 34 38 36 T50 36" stroke="#ea580c" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.75" />
    <rect x="48" y="10" width="8" height="3" rx="0.5" fill="#ea580c" opacity="0.85" />
    <path d="M52 13 V19" stroke="#78716c" stroke-width="1.2" stroke-linecap="round" />
    <path d="M49 19 H55" stroke="#78716c" stroke-width="1.2" stroke-linecap="round" />
  </svg>

  <!-- 曜石：仿素纸 — 浅色卡片 + 虚线刻度 + 青色晶体 -->
  <svg
    v-else-if="skinId === 'obsidian'"
    class="skin-preview-icon"
    viewBox="0 0 72 52"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect x="12" y="6" width="48" height="40" rx="2" fill="#f8fafc" stroke="#c8d8e8" stroke-width="0.8" />
    <path d="M12 18 H60" stroke="#cffafe" stroke-width="0.6" stroke-dasharray="3 2" />
    <path d="M12 26 H60" stroke="#cffafe" stroke-width="0.6" stroke-dasharray="3 2" />
    <path d="M12 34 H60" stroke="#cffafe" stroke-width="0.6" stroke-dasharray="3 2" />
    <path d="M24 6 V46" stroke="#e0f2fe" stroke-width="0.6" />
    <path d="M36 6 V46" stroke="#bae6fd" stroke-width="0.8" />
    <path d="M48 6 V46" stroke="#e0f2fe" stroke-width="0.6" />
    <path d="M42 14 L50 20 L46 32 L38 32 L34 20 Z" fill="#ecfeff" stroke="#0891b2" stroke-width="0.8" />
    <rect x="38" y="36" width="14" height="2" rx="0.5" fill="#22d3ee" opacity="0.65" />
  </svg>

  <!-- 松野：仿浅樱 — 淡绿光晕 + 线描松针 -->
  <svg
    v-else-if="skinId === 'forest'"
    class="skin-preview-icon"
    viewBox="0 0 72 52"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <circle cx="36" cy="28" r="14" fill="#d1fae5" opacity="0.45" />
    <path d="M36 10 L42 22 H40 L46 34 H26 L32 22 H30 Z" fill="#ecfdf5" stroke="#059669" stroke-width="0.9" stroke-linejoin="round" />
    <path d="M36 16 L40 24 H38 L42 32 H30 L34 24 H32 Z" fill="#f0fdf4" stroke="#10b981" stroke-width="0.7" stroke-linejoin="round" />
    <line x1="36" y1="32" x2="36" y2="38" stroke="#365314" stroke-width="1.2" stroke-linecap="round" />
    <ellipse cx="18" cy="38" rx="3" ry="1.8" fill="#a7f3d0" opacity="0.55" transform="rotate(-20 18 38)" />
    <ellipse cx="54" cy="14" rx="2.5" ry="1.6" fill="#6ee7b7" opacity="0.45" transform="rotate(25 54 14)" />
    <path d="M10 44 Q36 48 62 44" stroke="#bbf7d0" stroke-width="0.8" stroke-linecap="round" opacity="0.6" />
  </svg>

  <!-- 暖纸：砂纸纹理与书写笔迹 -->
  <svg
    v-else-if="skinId === 'sand'"
    class="skin-preview-icon"
    viewBox="0 0 72 52"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect x="14" y="8" width="44" height="36" rx="2" fill="#faf6ef" stroke="#cdc0ad" stroke-width="0.8" />
    <path d="M20 18 H52" stroke="#d6d3d1" stroke-width="1" stroke-linecap="round" />
    <path d="M20 24 H48" stroke="#e7e5e4" stroke-width="1" stroke-linecap="round" />
    <path d="M20 30 H44" stroke="#e7e5e4" stroke-width="1" stroke-linecap="round" />
    <path d="M26 36 Q32 34 38 36 T50 36" stroke="#c2410c" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.7" />
    <path d="M48 12 L56 8 L54 16 Z" fill="#c2410c" opacity="0.85" />
    <line x1="54" y1="8" x2="54" y2="20" stroke="#78716c" stroke-width="1.2" stroke-linecap="round" />
    <circle cx="54" cy="20" r="1" fill="#78716c" />
  </svg>

  <!-- 素纸：蓝调网格与清晰版面 -->
  <svg
    v-else-if="skinId === 'ivory'"
    class="skin-preview-icon"
    viewBox="0 0 72 52"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect x="12" y="6" width="48" height="40" rx="2" fill="#ffffff" stroke="#c8d0da" stroke-width="0.8" />
    <path d="M12 18 H60" stroke="#dbeafe" stroke-width="0.6" />
    <path d="M12 26 H60" stroke="#dbeafe" stroke-width="0.6" />
    <path d="M12 34 H60" stroke="#dbeafe" stroke-width="0.6" />
    <path d="M24 6 V46" stroke="#dbeafe" stroke-width="0.6" />
    <path d="M36 6 V46" stroke="#bfdbfe" stroke-width="0.8" />
    <path d="M48 6 V46" stroke="#dbeafe" stroke-width="0.6" />
    <rect x="38" y="20" width="18" height="3" rx="1" fill="#2563eb" opacity="0.85" />
    <rect x="38" y="26" width="14" height="2" rx="0.5" fill="#93c5fd" opacity="0.7" />
    <rect x="38" y="30" width="16" height="2" rx="0.5" fill="#93c5fd" opacity="0.5" />
  </svg>

  <!-- 浅樱：飘落花瓣与柔和粉调 -->
  <svg
    v-else-if="skinId === 'blossom'"
    class="skin-preview-icon"
    viewBox="0 0 72 52"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <circle cx="36" cy="28" r="14" fill="#fce7f3" opacity="0.5" />
    <g transform="translate(36 22)">
      <ellipse cx="0" cy="-6" rx="3.5" ry="5" fill="#fda4af" transform="rotate(0)" />
      <ellipse cx="0" cy="-6" rx="3.5" ry="5" fill="#fb7185" transform="rotate(72)" />
      <ellipse cx="0" cy="-6" rx="3.5" ry="5" fill="#fda4af" transform="rotate(144)" />
      <ellipse cx="0" cy="-6" rx="3.5" ry="5" fill="#fb7185" transform="rotate(216)" />
      <ellipse cx="0" cy="-6" rx="3.5" ry="5" fill="#fda4af" transform="rotate(288)" />
      <circle cx="0" cy="0" r="2.5" fill="#fef08a" opacity="0.9" />
    </g>
    <ellipse cx="18" cy="38" rx="3" ry="2" fill="#fda4af" opacity="0.55" transform="rotate(-25 18 38)" />
    <ellipse cx="54" cy="14" rx="2.5" ry="1.6" fill="#fb7185" opacity="0.45" transform="rotate(30 54 14)" />
    <ellipse cx="58" cy="40" rx="2" ry="1.3" fill="#fecdd3" opacity="0.5" transform="rotate(-15 58 40)" />
    <path d="M10 44 Q36 48 62 44" stroke="#fbcfe8" stroke-width="0.8" stroke-linecap="round" opacity="0.6" />
  </svg>
</template>

<style scoped>
.skin-preview-icon {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0.35rem 0.5rem;
}
</style>
