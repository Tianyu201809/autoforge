import { BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { isDev } from '../../shared/app-env'
import { IPC } from '../../shared/ipc-channels'
import { getBundledIconPath } from './app-runtime'
import { attachWindowMaximizeEvents } from './window-chrome'

let terminalWindow: BrowserWindow | null = null
let pinned = false

function getAppIconPath(): string {
  return getBundledIconPath()
}

function getTerminalUrl(): string {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/terminal.html`
  }
  return join(__dirname, '../renderer/terminal.html')
}

export function isTerminalWindowOpen(): boolean {
  return terminalWindow !== null && !terminalWindow.isDestroyed()
}

export function isTerminalPinned(): boolean {
  return pinned
}

export function openTerminalWindow(): void {
  if (isTerminalWindowOpen()) {
    terminalWindow!.focus()
    return
  }

  terminalWindow = new BrowserWindow({
    width: 720,
    height: 420,
    minWidth: 400,
    minHeight: 200,
    title: 'Autoforge 终端',
    frame: false,
    icon: nativeImage.createFromPath(getAppIconPath()),
    backgroundColor: '#0c0a09',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  attachWindowMaximizeEvents(terminalWindow)

  const url = getTerminalUrl()
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void terminalWindow.loadURL(url)
  } else {
    void terminalWindow.loadFile(url)
  }

  terminalWindow.on('closed', () => {
    terminalWindow = null
    pinned = false
    broadcastTerminalClosed()
  })
}

export function closeTerminalWindow(): void {
  if (isTerminalWindowOpen()) {
    terminalWindow!.close()
  }
}

export function toggleTerminalPin(): boolean {
  pinned = !pinned
  if (isTerminalWindowOpen()) {
    terminalWindow!.setAlwaysOnTop(pinned, 'screen-saver')
  }
  return pinned
}

function broadcastTerminalClosed(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win !== terminalWindow) {
      win.webContents.send(IPC.EVENT_TERMINAL_CLOSED)
    }
  }
}

export function getTerminalWindow(): BrowserWindow | null {
  return isTerminalWindowOpen() ? terminalWindow : null
}
