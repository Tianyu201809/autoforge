import { app, BrowserWindow, Menu, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { getAppIconImage } from './app-icon'

const isDev = !app.isPackaged

export const BALL_WIDTH = 72
export const BALL_HEIGHT = 72
const EDGE_PADDING = 10

let ballWindow: BrowserWindow | null = null
let dragOrigin: { winX: number; winY: number; screenX: number; screenY: number } | null = null

let showMainWindow: () => void = () => {}
let disableFloatingMode: () => void = () => {}
let quitApplication: () => void = () => app.quit()
let saveBallPosition: (pos: { x: number; y: number }) => void = () => {}
let getBallPosition: () => { x: number; y: number } | undefined = () => undefined

function toPosition(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0)
}

function setWindowPosition(win: BrowserWindow, x: number, y: number): void {
  win.setPosition(toPosition(x), toPosition(y))
}

function getBallUrl(): string {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/floating-ball.html`
  }
  return join(__dirname, '../renderer/floating-ball.html')
}

function resolveBallPosition(position?: { x: number; y: number }): { x: number; y: number } {
  const candidate = position ?? getBallPosition() ?? getDefaultBallPosition()
  const x = toPosition(candidate.x)
  const y = toPosition(candidate.y)
  const center = { x: x + BALL_WIDTH / 2, y: y + BALL_HEIGHT / 2 }
  const onDisplay = screen.getAllDisplays().some((display) => {
    const { workArea } = display
    return (
      center.x >= workArea.x &&
      center.x <= workArea.x + workArea.width &&
      center.y >= workArea.y &&
      center.y <= workArea.y + workArea.height
    )
  })
  return onDisplay ? { x, y } : getDefaultBallPosition()
}

function revealFloatingBallWindow(win: BrowserWindow, x: number, y: number): void {
  if (win.isDestroyed()) return
  clampBallToWorkArea(win, x, y)
  if (process.platform === 'win32') {
    win.setBackgroundColor('#00000000')
  }
  if (!win.isVisible()) {
    win.showInactive()
    win.show()
  }
  win.moveTop()
  win.setAlwaysOnTop(true, 'screen-saver')
}

function scheduleFloatingBallReveal(win: BrowserWindow, x: number, y: number): void {
  const reveal = (): void => {
    if (!ballWindow || ballWindow !== win || win.isDestroyed()) return
    revealFloatingBallWindow(win, x, y)
  }

  win.once('ready-to-show', reveal)
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return
    reveal()
  })

  // Windows 上动态创建的透明窗偶发收不到 ready-to-show，兜底显示
  setTimeout(reveal, 300)
}
export function getDefaultBallPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - BALL_WIDTH - 24,
    y: workArea.y + workArea.height - BALL_HEIGHT - 96
  }
}

export function clampBallToWorkArea(win: BrowserWindow, x: number, y: number): { x: number; y: number } {
  const bounds = win.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: x + bounds.width / 2,
    y: y + bounds.height / 2
  })
  const { workArea } = display
  const pos = {
    x: toPosition(
      Math.min(
        Math.max(x, workArea.x + EDGE_PADDING),
        workArea.x + workArea.width - bounds.width - EDGE_PADDING
      )
    ),
    y: toPosition(
      Math.min(
        Math.max(y, workArea.y + EDGE_PADDING),
        workArea.y + workArea.height - bounds.height - EDGE_PADDING
      )
    )
  }
  setWindowPosition(win, pos.x, pos.y)
  return pos
}

export function isFloatingBallOpen(): boolean {
  return ballWindow !== null && !ballWindow.isDestroyed()
}

export function closeFloatingBallWindow(): void {
  if (!isFloatingBallOpen()) return
  const win = ballWindow!
  ballWindow = null
  dragOrigin = null
  if (!win.isDestroyed()) {
    win.destroy()
  }
}

export function openFloatingBallWindow(position?: { x: number; y: number }): void {
  const pos = resolveBallPosition(position)

  if (isFloatingBallOpen()) {
    revealFloatingBallWindow(ballWindow!, pos.x, pos.y)
    return
  }

  ballWindow = new BrowserWindow({
    width: BALL_WIDTH,
    height: BALL_HEIGHT,
    minWidth: BALL_WIDTH,
    minHeight: BALL_HEIGHT,
    maxWidth: BALL_WIDTH,
    maxHeight: BALL_HEIGHT,
    useContentSize: true,
    x: toPosition(pos.x),
    y: toPosition(pos.y),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    show: false,
    icon: getAppIconImage(),
    backgroundColor: '#00000000',
    ...(process.platform === 'win32' ? { backgroundMaterial: 'none' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      zoomFactor: 1
    }
  })

  ballWindow.setAlwaysOnTop(true, 'screen-saver')
  ballWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  ballWindow.webContents.setZoomFactor(1)
  ballWindow.webContents.setVisualZoomLevelLimits(1, 1)

  ballWindow.on('will-resize', (event) => {
    event.preventDefault()
  })

  ballWindow.on('resize', () => {
    if (!ballWindow || ballWindow.isDestroyed()) return
    const [width, height] = ballWindow.getContentSize()
    if (width !== BALL_WIDTH || height !== BALL_HEIGHT) {
      ballWindow.setContentSize(BALL_WIDTH, BALL_HEIGHT)
    }
  })

  ballWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'mouseWheel') {
      event.preventDefault()
    }
  })

  ballWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[floating-ball] did-fail-load', { code, desc, url })
  })

  const url = getBallUrl()
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void ballWindow.loadURL(url)
  } else {
    void ballWindow.loadFile(url)
  }

  scheduleFloatingBallReveal(ballWindow, pos.x, pos.y)

  ballWindow.on('closed', () => {
    ballWindow = null
    dragOrigin = null
  })
}

export function syncFloatingBall(enabled: boolean, position?: { x: number; y: number }): void {
  if (!enabled) {
    closeFloatingBallWindow()
    return
  }

  if (!isFloatingBallOpen()) {
    openFloatingBallWindow(position)
    return
  }

  const pos = resolveBallPosition(position)
  revealFloatingBallWindow(ballWindow!, pos.x, pos.y)
}

function showBallContextMenu(win: BrowserWindow): void {
  Menu.buildFromTemplate([
    { label: '打开主界面', click: () => showMainWindow() },
    { label: '隐藏悬浮球', click: () => disableFloatingMode() },
    { type: 'separator' },
    {
      label: '退出 Autoforge',
      click: () => {
        quitApplication()
      }
    }
  ]).popup({ window: win })
}

export function initFloatingBallWindow(deps: {
  onShowMain: () => void
  onDisableFloating: () => void
  onQuit: () => void
  onSavePosition: (pos: { x: number; y: number }) => void
  getSavedPosition: () => { x: number; y: number } | undefined
}): void {
  showMainWindow = deps.onShowMain
  disableFloatingMode = deps.onDisableFloating
  quitApplication = deps.onQuit
  saveBallPosition = deps.onSavePosition
  getBallPosition = deps.getSavedPosition

  ipcMain.on('floating-ball:drag-start', (event, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const [winX, winY] = win.getPosition()
    dragOrigin = {
      winX: toPosition(winX),
      winY: toPosition(winY),
      screenX: toPosition(screenX),
      screenY: toPosition(screenY)
    }
  })

  ipcMain.on('floating-ball:drag-move', (event, screenX: number, screenY: number) => {
    if (!dragOrigin) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const dx = toPosition(screenX) - dragOrigin.screenX
    const dy = toPosition(screenY) - dragOrigin.screenY
    if (dx === 0 && dy === 0) return
    clampBallToWorkArea(win, dragOrigin.winX + dx, dragOrigin.winY + dy)
  })

  ipcMain.handle(
    'floating-ball:drag-end',
    (event, _screenX: number, _screenY: number, moved: boolean) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      dragOrigin = null

      if (!moved) {
        showMainWindow()
        return
      }

      const [x, y] = win.getPosition()
      const pos = clampBallToWorkArea(win, x, y)
      saveBallPosition(pos)
    }
  )

  ipcMain.on('floating-ball:context-menu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    showBallContextMenu(win)
  })
}

export function getFloatingBallWindow(): BrowserWindow | null {
  return isFloatingBallOpen() ? ballWindow : null
}
