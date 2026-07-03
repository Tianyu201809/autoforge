import { computed, ref } from 'vue'
import type { ScratchpadEntry } from '../../../shared/types/script'
import { insertIntoFocusedField } from '../utils/insert-focused-field'

const POSITION_KEY = 'autoforge-scratchpad-pos'

const active = ref(false)
const entries = ref<ScratchpadEntry[]>([])
const searchQuery = ref('')
const position = ref({ x: 0, y: 52 })
const initialized = ref(false)
const editorOpen = ref(false)
const editorId = ref<string | null>(null)
const editorLabel = ref('')
const editorValue = ref('')
const saving = ref(false)

function loadSavedPosition(): { x: number; y: number } | null {
  try {
    const raw = sessionStorage.getItem(POSITION_KEY)
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
  sessionStorage.setItem(POSITION_KEY, JSON.stringify(position.value))
}

function defaultPosition(): { x: number; y: number } {
  const width = 280
  const padding = 16
  return {
    x: Math.max(padding, window.innerWidth - width - padding),
    y: 52
  }
}

async function loadEntries(): Promise<void> {
  const config = await window.autoforge.config.get()
  entries.value = config.scratchpad ?? []
}

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const sorted = [...entries.value].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  if (!q) return sorted
  return sorted.filter(
    (entry) => entry.label.toLowerCase().includes(q) || entry.value.toLowerCase().includes(q)
  )
})

function hasValue(entry: ScratchpadEntry): boolean {
  return entry.value.trim().length > 0
}

function toPlainEntries(items: ScratchpadEntry[]): ScratchpadEntry[] {
  return items.map(({ id, label, value }) => ({ id, label, value }))
}

async function persistEntries(next: ScratchpadEntry[]): Promise<boolean> {
  saving.value = true
  try {
    const plain = toPlainEntries(next)
    const config = await window.autoforge.config.set({ scratchpad: plain })
    entries.value = config.scratchpad ?? plain
    return true
  } finally {
    saving.value = false
  }
}

async function upsertEntry(label: string, value: string, id?: string | null): Promise<boolean> {
  const trimmedLabel = label.trim()
  if (!trimmedLabel) return false
  const nextId = id ?? crypto.randomUUID()
  const nextEntry: ScratchpadEntry = { id: nextId, label: trimmedLabel, value }
  const index = entries.value.findIndex((entry) => entry.id === nextId)
  const next =
    index >= 0
      ? entries.value.map((entry, i) => (i === index ? nextEntry : entry))
      : [...entries.value, nextEntry]
  return persistEntries(next)
}

async function removeEntry(id: string): Promise<boolean> {
  return persistEntries(entries.value.filter((entry) => entry.id !== id))
}

async function clearEntryValue(id: string): Promise<boolean> {
  const entry = entries.value.find((item) => item.id === id)
  if (!entry) return false
  return upsertEntry(entry.label, '', id)
}

async function open(): Promise<void> {
  await loadEntries()
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
  editorId.value = null
  editorLabel.value = ''
  editorValue.value = ''
  saving.value = false
}

function openEditor(entry?: ScratchpadEntry): void {
  editorOpen.value = true
  editorId.value = entry?.id ?? null
  editorLabel.value = entry?.label ?? ''
  editorValue.value = entry?.value ?? ''
}

function closeEditor(): void {
  editorOpen.value = false
  editorId.value = null
  editorLabel.value = ''
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

function dismiss(): void {
  if (!active.value) return
  close()
}

function setPosition(next: { x: number; y: number }): void {
  position.value = next
  savePosition()
}

function insertEntry(entry: ScratchpadEntry): boolean {
  if (!hasValue(entry)) return false
  return insertIntoFocusedField(entry.value)
}

export function useScratchpad() {
  return {
    active,
    entries,
    searchQuery,
    position,
    filteredEntries,
    editorOpen,
    editorId,
    editorLabel,
    editorValue,
    saving,
    open,
    close,
    toggle,
    dismiss,
    setPosition,
    insertEntry,
    hasValue,
    reloadEntries: loadEntries,
    upsertEntry,
    removeEntry,
    clearEntryValue,
    openEditor,
    closeEditor,
    toggleEditor
  }
}
