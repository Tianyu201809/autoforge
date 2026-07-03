/** 全局协调脚本卡片右键/更多菜单，确保同一时间仅有一个菜单打开 */
let activeClose: (() => void) | null = null
let listenerBound = false

function bindGlobalCloseListener(): void {
  if (listenerBound || typeof document === 'undefined') return
  listenerBound = true
  document.addEventListener(
    'contextmenu',
    () => {
      closeActiveScriptCardMenu()
    },
    true
  )
}

export function registerScriptCardMenuClose(close: () => void): void {
  bindGlobalCloseListener()
  activeClose = close
}

export function unregisterScriptCardMenuClose(close: () => void): void {
  if (activeClose === close) activeClose = null
}

export function closeActiveScriptCardMenu(): void {
  activeClose?.()
}
