import { ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { ScriptItem } from '../shared/types/script'

export const DROP_IMPORT_DONE = 'autoforge-drop-import-done'
export const DROP_IMPORT_ERROR = 'autoforge-drop-import-error'

export interface DropImportHandlers {
  onDone?: (script: ScriptItem) => void
  onError?: (message: string) => void
}

const SCRIPT_FILE_RE = /\.(js|mjs|cjs)$/i

function isScriptFilePath(filePath: string): boolean {
  return SCRIPT_FILE_RE.test(filePath)
}

function looksLikeDirectoryDrop(filePath: string): boolean {
  const base = filePath.replace(/^.*[/\\]/, '')
  return !/\.[^./\\]+$/.test(base)
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return filePath
  return filePath.slice(0, filePath.length - (normalized.length - idx))
}

function commonParentDir(paths: string[]): string | null {
  if (!paths.length) return null
  if (paths.length === 1) return paths[0]

  const dirs = paths.map((p) => (isScriptFilePath(p) ? dirname(p) : p))
  const split = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean)
  const segments = split(dirs[0]!)
  for (const dir of dirs.slice(1)) {
    const other = split(dir)
    let i = 0
    while (i < segments.length && i < other.length && segments[i] === other[i]) i++
    segments.length = i
    if (!segments.length) return null
  }
  if (!segments.length) return null
  const joined = segments.join('/')
  return /^[a-zA-Z]:/.test(joined) ? joined.replace(/\//g, '\\') : `/${joined}`
}

function collectDropPaths(event: DragEvent): string[] {
  const dt = event.dataTransfer
  if (!dt) return []

  const paths: string[] = []

  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const path = webUtils.getPathForFile(dt.files[i]!)
      if (path) paths.push(path)
    }
  }

  if (!paths.length && dt.items?.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i]
      if (item?.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      const path = webUtils.getPathForFile(file)
      if (path) paths.push(path)
    }
  }

  return paths
}

function resolveDropImportPath(event: DragEvent): string | null {
  const paths = collectDropPaths(event)
  if (!paths.length) return null
  return paths.length === 1 ? paths[0]! : commonParentDir(paths)
}

export function bindScriptDropImportZone(element: HTMLElement, handlers?: DropImportHandlers): () => void {
  const onDragOver = (event: DragEvent): void => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()

    const filePath = resolveDropImportPath(event)
    if (!filePath) return
    if (!isScriptFilePath(filePath) && !looksLikeDirectoryDrop(filePath)) return

    void ipcRenderer
      .invoke(IPC.SCRIPTS_IMPORT, filePath)
      .then((script: ScriptItem) => {
        element.dispatchEvent(new CustomEvent(DROP_IMPORT_DONE, { detail: script }))
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        element.dispatchEvent(new CustomEvent(DROP_IMPORT_ERROR, { detail: message }))
      })
  }

  element.addEventListener('dragover', onDragOver)
  element.addEventListener('drop', onDrop)

  const onDone = (event: Event): void => {
    handlers?.onDone?.((event as CustomEvent<ScriptItem>).detail)
  }
  const onError = (event: Event): void => {
    handlers?.onError?.((event as CustomEvent<string>).detail ?? '导入失败')
  }
  element.addEventListener(DROP_IMPORT_DONE, onDone)
  element.addEventListener(DROP_IMPORT_ERROR, onError)

  return () => {
    element.removeEventListener('dragover', onDragOver)
    element.removeEventListener('drop', onDrop)
    element.removeEventListener(DROP_IMPORT_DONE, onDone)
    element.removeEventListener(DROP_IMPORT_ERROR, onError)
  }
}
