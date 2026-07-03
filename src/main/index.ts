import { bootstrapUtf8 } from '../shared/encoding'
import { IPC } from '../shared/ipc-channels'
import { appEnv, isDev } from '../shared/app-env'

bootstrapUtf8()

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { closeDatabase, initDatabase } from './db/database'
import { configureAppUserDataPath, ensureAppDataSeeded, getAppUserDataPath } from './services/app-data-root'
import { getAppIconImage } from './services/app-icon'
import { registerIpcHandlers } from './ipc/handlers'
import {
  applyMainWindowPin,
  attachWindowMaximizeEvents,
  isMainWindowPinned,
  toggleMainWindowPin
} from './services/window-chrome'
import {
  applyWindowMode,
  attachMainWindowModeHandlers,
  initMainWindowMode,
  shouldKeepAliveOnAllWindowsClosed
} from './services/main-window-mode'
import { scriptStore } from './services/script-store'

configureAppUserDataPath()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: false,
    icon: getAppIconImage(),
    backgroundColor: '#0c0a09',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  attachWindowMaximizeEvents(mainWindow)
  applyMainWindowPin(mainWindow)
  attachMainWindowModeHandlers(mainWindow)

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[renderer] did-fail-load', { code, desc, url })
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return
    // 开发模式下 Electron / DevTools 的已知无害提示，避免污染终端
    if (message.includes('Electron Security Warning')) return
    if (message.includes('Autofill.enable') || message.includes('Autofill.setAddresses')) return
    console.error('[renderer console]', message, sourceId, line)
  })

  mainWindow.on('ready-to-show', () => {
    applyWindowMode()
    mainWindow?.show()
    if (isDev && process.env['AUTOFORGE_DEVTOOLS'] === '1') {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  console.info(`[app] env=${appEnv} packaged=${app.isPackaged}`)
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.autoforge.app')
  }

  await ensureAppDataSeeded()
  await initDatabase(getAppUserDataPath())

  registerIpcHandlers(() => mainWindow)

  initMainWindowMode({
    getWindow: () => mainWindow,
    getConfig: () => scriptStore.getConfig().window,
    saveConfig: (patch) => {
      const current = scriptStore.getConfig().window ?? {}
      const config = scriptStore.setConfig({ window: { ...current, ...patch } })
      return config.window ?? {}
    }
  })

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle(IPC.WINDOW_TOGGLE_PIN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return toggleMainWindowPin(win)
  })

  ipcMain.handle(IPC.WINDOW_IS_PINNED, () => {
    return isMainWindowPinned()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (shouldKeepAliveOnAllWindowsClosed()) return
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
