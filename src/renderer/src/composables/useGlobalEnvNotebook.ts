import { computed, ref } from 'vue'
import type { EnvironmentProfile } from '../../../shared/types/script'
import { isExplicitEnvConfigValue } from '../../../shared/env-resolution'
import { insertIntoFocusedField } from '../utils/insert-focused-field'

const NOTEBOOK_POSITION_KEY = 'autoforge-env-notebook-pos'

const active = ref(false)
const environments = ref<EnvironmentProfile[]>([])
const selectedEnvId = ref('')
const searchQuery = ref('')
const position = ref({ x: 0, y: 52 })
const initialized = ref(false)
const editorOpen = ref(false)
const editorKey = ref('')
const editorValue = ref('')
const saving = ref(false)

function loadSavedPosition(): { x: number; y: number } | null {
  try {
    const raw = sessionStorage.getItem(NOTEBOOK_POSITION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { x?: number; y?: number }
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {
    /* ignore */
  }
  return null
}

function savePosition(): void {
  sessionStorage.setItem(NOTEBOOK_POSITION_KEY, JSON.stringify(position.value))
}

function defaultPosition(): { x: number; y: number } {
  const width = 280
  const padding = 16
  return {
    x: Math.max(padding, window.innerWidth - width - padding),
    y: 52
  }
}

async function loadEnvironments(): Promise<void> {
  environments.value = await window.autoforge.env.list()
  if (!selectedEnvId.value) {
    selectedEnvId.value =
      environments.value.find((env) => env.isDefault)?.id ?? environments.value[0]?.id ?? ''
  } else if (!environments.value.some((env) => env.id === selectedEnvId.value)) {
    selectedEnvId.value =
      environments.value.find((env) => env.isDefault)?.id ?? environments.value[0]?.id ?? ''
  }
}

const selectedProfile = computed(
  () => environments.value.find((env) => env.id === selectedEnvId.value) ?? null
)

const envKeys = computed(() => {
  const variables = selectedProfile.value?.variables ?? {}
  return Object.keys(variables).sort((a, b) => a.localeCompare(b, 'en'))
})

const filteredKeys = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return envKeys.value
  return envKeys.value.filter((key) => key.toLowerCase().includes(q))
})

function valueForKey(key: string): string {
  return selectedProfile.value?.variables[key] ?? ''
}

function hasValueForKey(key: string): boolean {
  return isExplicitEnvConfigValue(valueForKey(key))
}

async function open(): Promise<void> {
  await loadEnvironments()
  if (!initialized.value) {
    position.value = loadSavedPosition() ?? defaultPosition()
    initialized.value = true
  }
  active.value = true
}

function close(): void {
  active.value = false
  searchQuery.value = ''
  editorOpen.value = false
  editorKey.value = ''
  editorValue.value = ''
  saving.value = false
}

async function persistVariables(variables: Record<string, string>): Promise<boolean> {
  const profile = selectedProfile.value
  if (!profile) return false
  saving.value = true
  try {
    const updated = await window.autoforge.env.update(profile.id, {
      name: profile.name,
      description: profile.description,
      variables: Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, v ?? ''])),
      isDefault: profile.isDefault
    })
    if (!updated) return false
    await loadEnvironments()
    return true
  } finally {
    saving.value = false
  }
}

async function upsertVariable(key: string, value: string): Promise<boolean> {
  const trimmed = key.trim()
  if (!trimmed) return false
  const profile = selectedProfile.value
  if (!profile) return false
  return persistVariables({ ...profile.variables, [trimmed]: value })
}

async function removeVariable(key: string): Promise<boolean> {
  const profile = selectedProfile.value
  if (!profile) return false
  const variables = { ...profile.variables }
  delete variables[key]
  return persistVariables(variables)
}

function openEditor(key = '', value = ''): void {
  editorOpen.value = true
  editorKey.value = key
  editorValue.value = value
}

function closeEditor(): void {
  editorOpen.value = false
  editorKey.value = ''
  editorValue.value = ''
}

function toggleEditor(): void {
  if (editorOpen.value) {
    closeEditor()
    return
  }
  openEditor()
}

function toggle(): void {
  if (active.value) {
    close()
    return
  }
  void open()
}

/** 主窗口隐藏 / 最小化时强制关闭，再次显示需重新点击标题栏图标 */
function dismiss(): void {
  if (!active.value) return
  close()
}

function setPosition(next: { x: number; y: number }): void {
  position.value = next
  savePosition()
}

function insertKey(key: string): boolean {
  const value = valueForKey(key)
  if (!isExplicitEnvConfigValue(value)) return false
  return insertIntoFocusedField(value)
}

export function useGlobalEnvNotebook() {
  return {
    active,
    environments,
    selectedEnvId,
    searchQuery,
    position,
    selectedProfile,
    envKeys,
    filteredKeys,
    editorOpen,
    editorKey,
    editorValue,
    saving,
    open,
    close,
    toggle,
    dismiss,
    setPosition,
    insertKey,
    hasValueForKey,
    valueForKey,
    reloadEnvironments: loadEnvironments,
    upsertVariable,
    removeVariable,
    openEditor,
    closeEditor,
    toggleEditor
  }
}
