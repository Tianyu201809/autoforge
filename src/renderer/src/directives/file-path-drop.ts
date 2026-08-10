import type { Directive } from 'vue'

type TextControl = HTMLInputElement | HTMLTextAreaElement

const unbinders = new WeakMap<TextControl, () => void>()
const observers = new WeakMap<HTMLElement, MutationObserver>()
const supportedInputTypes = new Set(['text', 'url', 'email', 'tel'])

export function isFilePathDropTarget(element: Element): element is TextControl {
  if (element.tagName === 'TEXTAREA') {
    const textarea = element as HTMLTextAreaElement
    return !textarea.disabled && !textarea.readOnly
  }
  if (element.tagName !== 'INPUT') return false
  const input = element as HTMLInputElement
  return !input.disabled && !input.readOnly && supportedInputTypes.has(input.type)
}

function unbind(element: Element): void {
  if (!isTextControl(element)) return
  unbinders.get(element)?.()
  unbinders.delete(element)
}

function isTextControl(element: Element): element is TextControl {
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'
}

export const filePathDropDirective: Directive<HTMLElement> = {
  mounted(root) {
    const bind = (element: Element): void => {
      if (!isFilePathDropTarget(element) || unbinders.has(element)) return
      unbinders.set(element, window.autoforge.files.setupPathDropTarget(element))
    }
    const refresh = (element: Element): void => {
      unbind(element)
      bind(element)
    }
    const scan = (node: Node): void => {
      if (!(node instanceof Element)) return
      bind(node)
      node.querySelectorAll('input, textarea').forEach(bind)
    }

    document.body.querySelectorAll('input, textarea').forEach(bind)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') refresh(record.target as Element)
        record.addedNodes.forEach(scan)
        record.removedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          unbind(node)
          node.querySelectorAll('input, textarea').forEach(unbind)
        })
      }
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['disabled', 'readonly', 'type'],
      childList: true,
      subtree: true
    })
    observers.set(root, observer)
  },
  unmounted(root) {
    observers.get(root)?.disconnect()
    observers.delete(root)
    document.body.querySelectorAll('input, textarea').forEach(unbind)
  }
}
