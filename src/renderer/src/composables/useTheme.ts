import { readonly, ref } from 'vue'

export type ThemeId = 'dark' | 'light'

const STORAGE_KEY = 'autoforge-theme'
const LEGACY_STORAGE_KEY = 'scriptbox-theme'

function readStoredTheme(): ThemeId {
  if (typeof localStorage === 'undefined') return 'dark'
  const stored =
    localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
  return stored === 'light' ? 'light' : 'dark'
}

const theme = ref<ThemeId>(readStoredTheme())

function applyTheme(id: ThemeId, animate = false): void {
  theme.value = id
  const root = document.documentElement
  if (animate) {
    root.classList.add('theme-transition')
    window.setTimeout(() => root.classList.remove('theme-transition'), 400)
  }
  root.setAttribute('data-theme', id)
  localStorage.setItem(STORAGE_KEY, id)
}

if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', theme.value)
}

export function useTheme() {
  return {
    theme: readonly(theme),
    setTheme: (id: ThemeId) => applyTheme(id, true),
    toggleTheme: () => applyTheme(theme.value === 'dark' ? 'light' : 'dark', true)
  }
}
