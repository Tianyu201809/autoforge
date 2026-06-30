import { app, BrowserWindow, Menu, Tray, globalShortcut } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { DEFAULT_GLOBAL_SHORTCUT } from '../../shared/accelerator'
import type { AppWindowConfig } from '../../shared/types/script'
import { getTrayIcon } from './app-icon'
import {
  closeFloatingBallWindow,
  initFloatingBallWindow,
  syncFloatingBall
} from './floating-ball-window'

export { DEFAULT_GLOBAL_SHORTCUT }

export const DEFAULT_WINDOW_CONFIG: Required<AppWindowConfig> = {
  trayMode: false,
  floatingMode: false,
  globalShortcutEnabled: true,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT
}
export type WindowModeState = Required<AppWindowConfig> & {
  /** 主窗口对用户可见（非隐藏、非最小化） */
  visible: boolean
  /** 全局快捷键是否已成功注册（禁用时恒为 true） */
  globalShortcutRegistered: boolean
}

let tray: Tray | null = null
let registeredShortcut: string | null = null
let appQuitting = false
let getMainWindow: () => BrowserWindow | null = () => null
let readWindowConfig: () => AppWindowConfig = () => ({})
let persistWindowConfig: (patch: Partial<AppWindowConfig>) => void = () => {}

export function resolveWindowConfig(config?: AppWindowConfig): Required<AppWindowConfig> {
  return {
    trayMode: config?.trayMode ?? DEFAULT_WINDOW_CONFIG.trayMode,
    floatingMode: config?.floatingMode ?? DEFAULT_WINDOW_CONFIG.floatingMode,
    globalShortcutEnabled:
      config?.globalShortcutEnabled ?? DEFAULT_WINDOW_CONFIG.globalShortcutEnabled,
    globalShortcut: config?.globalShortcut?.trim() || DEFAULT_WINDOW_CONFIG.globalShortcut
  }
}

function isMainWindowShown(win: BrowserWindow | null): boolean {
  if (!win || win.isDestroyed()) return false
  return win.isVisible() && !win.isMinimized()
}

function buildWindowModeState(): WindowModeState {
  const resolved = resolveWindowConfig(readWindowConfig())
  const win = getMainWindow()
  return {
    ...resolved,
    visible: isMainWindowShown(win),
    globalShortcutRegistered:
      !resolved.globalShortcutEnabled || registeredShortcut === resolved.globalShortcut
  }
}

function broadcastModeChange(): void {
  const payload = buildWindowModeState()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send(IPC.EVENT_WINDOW_MODE, payload)
    }
  }
}

export function showMainWindow(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  broadcastModeChange()
}

export function hideMainWindow(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.hide()
  broadcastModeChange()
}

export function toggleMainWindow(): boolean {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return false
  if (win.isVisible() && win.isFocused()) {
    hideMainWindow()
    return false
  }
  showMainWindow()
  return true
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: '显示主界面', click: () => showMainWindow() },
    { label: '隐藏到托盘', click: () => hideMainWindow() },
    { type: 'separator' },
    {
      label: '退出 Autoforge',
      click: () => {
        quitApplication()
      }
    }
  ])
}

function syncTray(enabled: boolean): void {
  destroyTray()
  if (!enabled) return

  const icon = getTrayIcon()
  if (icon.isEmpty()) {
    console.warn('[tray] icon missing, skip tray creation')
    return
  }

  tray = new Tray(icon)
  tray.setToolTip('Autoforge')
  tray.setContextMenu(buildTrayMenu())
  tray.on('double-click', () => showMainWindow())
  if (process.platform === 'win32') {
    tray.on('click', () => showMainWindow())
  }
}

function destroyTray(): void {
  if (!tray) return
  tray.destroy()
  tray = null
}

function cleanupBackgroundMode(): void {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut)
    registeredShortcut = null
  }
  closeFloatingBallWindow()
  destroyTray()
}

export function quitApplication(): void {
  if (appQuitting) {
    app.exit(0)
    return
  }
  appQuitting = true
  cleanupBackgroundMode()

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.removeAllListeners('close')
    win.destroy()
  }

  app.exit(0)
}

function syncGlobalShortcut(config: Required<AppWindowConfig>): void {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut)
    registeredShortcut = null
  }
  if (!config.globalShortcutEnabled) return

  const accelerator = config.globalShortcut
  try {
    const ok = globalShortcut.register(accelerator, () => {
      showMainWindow()
    })
    if (ok) {
      registeredShortcut = accelerator
    } else {
      console.warn('[shortcut] failed to register:', accelerator)
    }
  } catch (err) {
    console.warn('[shortcut] register error:', err)
  }
}

export function applyWindowMode(): Required<AppWindowConfig> {
  const saved = readWindowConfig()
  const resolved = resolveWindowConfig(saved)

  syncFloatingBall(resolved.floatingMode, saved.floatingBallPosition)
  syncTray(resolved.trayMode)
  syncGlobalShortcut(resolved)
  broadcastModeChange()
  return resolved
}

export function setWindowMode(patch: Partial<AppWindowConfig>): Required<AppWindowConfig> {
  persistWindowConfig(patch)
  return applyWindowMode()
}

export function handleMainWindowClose(event: Electron.Event): void {
  const { trayMode } = resolveWindowConfig(readWindowConfig())
  if (trayMode && !appQuitting) {
    event.preventDefault()
    hideMainWindow()
  }
}

export function shouldKeepAliveOnAllWindowsClosed(): boolean {
  if (appQuitting) return false
  const cfg = resolveWindowConfig(readWindowConfig())
  return cfg.trayMode || cfg.floatingMode
}

export function initMainWindowMode(deps: {
  getWindow: () => BrowserWindow | null
  getConfig: () => AppWindowConfig | undefined
  saveConfig: (patch: Partial<AppWindowConfig>) => AppWindowConfig
}): void {
  getMainWindow = deps.getWindow
  readWindowConfig = () => deps.getConfig() ?? {}
  persistWindowConfig = (patch) => {
    deps.saveConfig(patch)
  }

  app.on('before-quit', () => {
    appQuitting = true
    cleanupBackgroundMode()
  })

  app.on('will-quit', () => {
    cleanupBackgroundMode()
  })

  initFloatingBallWindow({
    onShowMain: () => showMainWindow(),
    onDisableFloating: () => {
      setWindowMode({ floatingMode: false })
    },
    onQuit: () => quitApplication(),
    onSavePosition: (pos) => {
      persistWindowConfig({ floatingBallPosition: pos })
    },
    getSavedPosition: () => readWindowConfig().floatingBallPosition
  })
}

export function attachMainWindowModeHandlers(win: BrowserWindow): void {
  win.on('close', (event) => handleMainWindowClose(event))
  win.on('show', () => broadcastModeChange())
  win.on('hide', () => broadcastModeChange())
  win.on('minimize', () => broadcastModeChange())
  win.on('restore', () => broadcastModeChange())
}

export function getWindowModeState(): WindowModeState {
  return buildWindowModeState()
}
