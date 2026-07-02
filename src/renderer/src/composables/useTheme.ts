import { computed, readonly, ref } from 'vue'

export type ColorMode = 'dark' | 'light'
export type SkinId = 'forge' | 'obsidian' | 'forest' | 'sand' | 'ivory' | 'blossom'

/** @deprecated 兼容旧引用，等同于 SkinId */
export type ThemeId = SkinId

export interface SkinPreset {
  id: SkinId
  name: string
  tagline: string
  mode: ColorMode
  /** 预览卡片：带主题色调的渐变底色与强调色（非实际 UI 背景色） */
  preview: { base: string; panel: string; accent: string }
}

export const SKIN_PRESETS: SkinPreset[] = [
  {
    id: 'forge',
    name: '锻炉',
    tagline: '暖橙石炭，锻造工作台',
    mode: 'dark',
    preview: { base: '#fdf4eb', panel: '#fef7f0', accent: '#ea580c' }
  },
  {
    id: 'obsidian',
    name: '曜石',
    tagline: '冷灰青蓝，精密工坊',
    mode: 'dark',
    preview: { base: '#f0f6fa', panel: '#f8fafc', accent: '#0891b2' }
  },
  {
    id: 'forest',
    name: '松野',
    tagline: '深绿森意，自然有机',
    mode: 'dark',
    preview: { base: '#f0faf5', panel: '#f5fdf9', accent: '#059669' }
  },
  {
    id: 'sand',
    name: '暖纸',
    tagline: '砂纸米色，温和书写',
    mode: 'light',
    preview: { base: '#f5f0e8', panel: '#faf6ef', accent: '#c2410c' }
  },
  {
    id: 'ivory',
    name: '素纸',
    tagline: '白纸蓝调，清晰版面',
    mode: 'light',
    preview: { base: '#f4f6f8', panel: '#fafbfc', accent: '#2563eb' }
  },
  {
    id: 'blossom',
    name: '浅樱',
    tagline: '淡粉柔和，轻盈界面',
    mode: 'light',
    preview: { base: '#faf5f5', panel: '#fdf8f8', accent: '#e11d48' }
  }
]

const SKIN_STORAGE_KEY = 'autoforge-skin'
const LEGACY_THEME_KEYS = ['autoforge-theme', 'scriptbox-theme'] as const

/** 深浅模式切换时，同系列皮肤成对切换 */
const SKIN_PAIRS: Record<SkinId, SkinId> = {
  forge: 'sand',
  sand: 'forge',
  obsidian: 'ivory',
  ivory: 'obsidian',
  forest: 'blossom',
  blossom: 'forest'
}

const DEFAULT_SKIN: Record<ColorMode, SkinId> = {
  dark: 'forge',
  light: 'sand'
}

function isSkinId(value: string | null): value is SkinId {
  return SKIN_PRESETS.some((s) => s.id === value)
}

function readStoredSkin(): SkinId {
  if (typeof localStorage === 'undefined') return DEFAULT_SKIN.dark

  const storedSkin = localStorage.getItem(SKIN_STORAGE_KEY)
  if (isSkinId(storedSkin)) return storedSkin

  for (const key of LEGACY_THEME_KEYS) {
    const legacy = localStorage.getItem(key)
    if (legacy === 'light') return DEFAULT_SKIN.light
    if (legacy === 'dark') return DEFAULT_SKIN.dark
  }

  return DEFAULT_SKIN.dark
}

const skin = ref<SkinId>(readStoredSkin())

function getSkinMeta(id: SkinId): SkinPreset {
  return SKIN_PRESETS.find((s) => s.id === id) ?? SKIN_PRESETS[0]
}

function applySkin(id: SkinId, animate = false): void {
  skin.value = id
  const meta = getSkinMeta(id)
  const root = document.documentElement

  if (animate) {
    root.classList.add('theme-transition')
    window.setTimeout(() => root.classList.remove('theme-transition'), 400)
  }

  root.setAttribute('data-theme', meta.mode)
  root.setAttribute('data-skin', id)
  localStorage.setItem(SKIN_STORAGE_KEY, id)
  localStorage.setItem('autoforge-theme', meta.mode)
}

if (typeof document !== 'undefined') {
  applySkin(skin.value)
}

export function useTheme() {
  const mode = computed<ColorMode>(() => getSkinMeta(skin.value).mode)
  const preset = computed(() => getSkinMeta(skin.value))

  return {
    skin: readonly(skin),
    /** @deprecated 使用 skin */
    theme: readonly(skin),
    mode,
    preset,
    presets: SKIN_PRESETS,
    setSkin: (id: SkinId) => applySkin(id, true),
    /** @deprecated 使用 setSkin */
    setTheme: (id: SkinId) => applySkin(id, true),
    toggleTheme: () => applySkin(SKIN_PAIRS[skin.value], true),
    darkSkins: SKIN_PRESETS.filter((s) => s.mode === 'dark'),
    lightSkins: SKIN_PRESETS.filter((s) => s.mode === 'light')
  }
}
