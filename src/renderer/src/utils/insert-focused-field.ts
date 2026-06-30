export type InsertableField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

const NOTEBOOK_SELECTOR = '[data-global-env-notebook]'

let lastFocused: InsertableField | null = null

function isInsideNotebook(el: Element | null): boolean {
  return !!el?.closest(NOTEBOOK_SELECTOR)
}

export function isInsertableField(el: unknown): el is InsertableField {
  if (!(el instanceof HTMLElement)) return false
  if (isInsideNotebook(el)) return false
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled) return false
    const type = el.type.toLowerCase()
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'range', 'color'].includes(type)
  }
  if (el instanceof HTMLSelectElement) return !el.disabled
  return false
}

export function startInsertFocusTracking(): () => void {
  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target
    if (isInsertableField(target)) {
      lastFocused = target
    }
  }
  document.addEventListener('focusin', onFocusIn, true)
  return () => document.removeEventListener('focusin', onFocusIn, true)
}

export function getLastFocusedField(): InsertableField | null {
  if (lastFocused && isInsertableField(lastFocused) && document.contains(lastFocused)) {
    return lastFocused
  }
  return null
}

function dispatchInputEvents(el: InsertableField): void {
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** 将值写入上次聚焦的输入框；成功返回 true */
export function insertIntoFocusedField(value: string): boolean {
  const el = getLastFocusedField()
  if (!el) return false

  if (el instanceof HTMLSelectElement) {
    const option = Array.from(el.options).find((opt) => opt.value === value)
    if (option) {
      el.value = value
    } else {
      el.value = value
    }
    dispatchInputEvents(el)
    el.focus()
    return true
  }

  el.value = value
  dispatchInputEvents(el)
  el.focus()
  return true
}
