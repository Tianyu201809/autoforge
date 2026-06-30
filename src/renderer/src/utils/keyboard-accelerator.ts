const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

const KEY_NAME_MAP: Record<string, string> = {
  ' ': 'Space',
  '+': 'Plus',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Tab: 'Tab'
}

/** 将键盘事件转为 Electron Accelerator 字符串 */
export function keyboardEventToAccelerator(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null

  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const key = normalizeKey(event.key)
  if (!key || parts.length === 0) return null

  parts.push(key)
  return parts.join('+')
}

function normalizeKey(key: string): string | null {
  if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
    return key.toUpperCase()
  }

  if (/^F\d{1,2}$/.test(key)) {
    return key
  }

  return KEY_NAME_MAP[key] ?? null
}
