import type { BrowserWindow } from 'electron'

export const WINDOW_MAXIMIZED_CHANGED = 'window:maximized-changed'

let mainWindowPinned = false

export function isMainWindowPinned(): boolean {
  return mainWindowPinned
}

export function toggleMainWindowPin(win: BrowserWindow | null | undefined): boolean {
  mainWindowPinned = !mainWindowPinned
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(mainWindowPinned, 'screen-saver')
  }
  return mainWindowPinned
}

export function applyMainWindowPin(win: BrowserWindow | null | undefined): void {
  if (win && !win.isDestroyed() && mainWindowPinned) {
    win.setAlwaysOnTop(true, 'screen-saver')
  }
}

/** 向渲染进程推送窗口最大化状态变化 */
export function attachWindowMaximizeEvents(win: BrowserWindow): void {
  const notify = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send(WINDOW_MAXIMIZED_CHANGED, win.isMaximized())
  }
  win.on('maximize', notify)
  win.on('unmaximize', notify)
}
