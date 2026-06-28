import type { BrowserWindow } from 'electron'

export const WINDOW_MAXIMIZED_CHANGED = 'window:maximized-changed'

/** 向渲染进程推送窗口最大化状态变化 */
export function attachWindowMaximizeEvents(win: BrowserWindow): void {
  const notify = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send(WINDOW_MAXIMIZED_CHANGED, win.isMaximized())
  }
  win.on('maximize', notify)
  win.on('unmaximize', notify)
}
