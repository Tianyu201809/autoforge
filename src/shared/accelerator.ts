/** Electron 全局快捷键默认值 */
export const DEFAULT_GLOBAL_SHORTCUT = 'CommandOrControl+Shift+A'

const MODIFIER_PARTS = new Set(['CommandOrControl', 'Command', 'Control', 'Alt', 'Shift', 'Super'])

/** 将 Electron Accelerator 格式化为可读文本 */
export function formatAcceleratorForDisplay(accelerator: string, isMac = false): string {
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'CommandOrControl':
          return isMac ? '⌘' : 'Ctrl'
        case 'Command':
          return '⌘'
        case 'Control':
          return 'Ctrl'
        case 'Alt':
          return isMac ? '⌥' : 'Alt'
        case 'Shift':
          return isMac ? '⇧' : 'Shift'
        case 'Plus':
          return '+'
        case 'Space':
          return 'Space'
        default:
          return part
      }
    })
    .join(' + ')
}

/** 校验 Accelerator 是否包含修饰键与非修饰键 */
export function isValidAccelerator(accelerator: string): boolean {
  const trimmed = accelerator.trim()
  if (!trimmed) return false

  const parts = trimmed.split('+')
  if (parts.length < 2) return false

  const hasModifier = parts.some((part) => MODIFIER_PARTS.has(part))
  const hasKey = parts.some((part) => !MODIFIER_PARTS.has(part))
  return hasModifier && hasKey
}
