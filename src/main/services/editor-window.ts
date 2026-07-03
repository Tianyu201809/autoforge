import { BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { isDev } from '../../shared/app-env'
import { IPC } from '../../shared/ipc-channels'
import { getBundledIconPath } from './app-runtime'
import { broadcastToRenderers } from './window-broadcast'
import { attachWindowMaximizeEvents } from './window-chrome'

export interface EditorFileState {
  content: string
  savedContent: string
  binary: boolean
  loaded: boolean
}

export interface EditorSession {
  scriptId: string
  scriptName: string
  entryPath: string
  manifestPath: string
  activeFilePath: string
  files: string[]
  fileStates: Record<string, EditorFileState>
}

let editorWindow: BrowserWindow | null = null
let pinned = false
let session: EditorSession | null = null

function getAppIconPath(): string {
  return getBundledIconPath()
}

function getEditorUrl(scriptId: string): string {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/editor.html?scriptId=${encodeURIComponent(scriptId)}`
  }
  return join(__dirname, '../renderer/editor.html')
}

export function isEditorWindowOpen(): boolean {
  return editorWindow !== null && !editorWindow.isDestroyed()
}

export function isEditorPinned(): boolean {
  return pinned
}

export function getEditorSession(): EditorSession | null {
  return session
}

export function openEditorWindow(next: EditorSession): void {
  session = next

  if (isEditorWindowOpen()) {
    editorWindow!.webContents.send(IPC.EVENT_EDITOR_INIT, session)
    editorWindow!.focus()
    return
  }

  editorWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 560,
    minHeight: 360,
    title: `编辑 · ${next.scriptName}`,
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

  attachWindowMaximizeEvents(editorWindow)

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void editorWindow.loadURL(getEditorUrl(next.scriptId))
  } else {
    void editorWindow.loadFile(getEditorUrl(next.scriptId), {
      query: { scriptId: next.scriptId }
    })
  }

  editorWindow.on('closed', () => {
    editorWindow = null
    pinned = false
    session = null
    broadcastToRenderers(IPC.EVENT_EDITOR_CLOSED, null)
  })
}

export function closeEditorWindow(): void {
  if (isEditorWindowOpen()) {
    editorWindow!.close()
  }
}

export function toggleEditorPin(): boolean {
  pinned = !pinned
  if (isEditorWindowOpen()) {
    editorWindow!.setAlwaysOnTop(pinned, 'screen-saver')
  }
  return pinned
}

export function broadcastEditorSync(payload: {
  scriptId: string
  activeFilePath: string
  filePath: string
  content: string
}): void {
  if (session && session.scriptId === payload.scriptId) {
    const prev = session.fileStates[payload.filePath]
    if (prev) {
      session = {
        ...session,
        activeFilePath: payload.activeFilePath,
        fileStates: {
          ...session.fileStates,
          [payload.filePath]: { ...prev, content: payload.content, loaded: true }
        }
      }
    }
  }
  broadcastToRenderers(IPC.EVENT_EDITOR_SYNC, payload)
}

export function broadcastEditorSaved(scriptId: string, filePath?: string): void {
  broadcastToRenderers(IPC.EVENT_EDITOR_SAVED, { scriptId, filePath })
}
