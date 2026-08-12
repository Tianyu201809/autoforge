export type DroppedFilePathResolver = (file: File) => string

export interface ScriptDropImportHandlers {
  onPath: (sourcePath: string) => void
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return filePath
  return filePath.slice(0, filePath.length - (normalized.length - index))
}

function commonParentDir(paths: string[]): string | null {
  if (!paths.length) return null
  if (paths.length === 1) return paths[0]

  const directories = paths.map(dirname)
  const split = (value: string): string[] => value.replace(/\\/g, '/').split('/').filter(Boolean)
  const segments = split(directories[0]!)
  for (const directory of directories.slice(1)) {
    const other = split(directory)
    let index = 0
    while (index < segments.length && index < other.length && segments[index] === other[index]) index++
    segments.length = index
    if (!segments.length) return null
  }
  const joined = segments.join('/')
  return /^[a-zA-Z]:/.test(joined) ? joined.replace(/\//g, '\\') : `/${joined}`
}

export function resolveDropImportPath(paths: string[]): string | null {
  const uniquePaths = [...new Set(paths.filter(Boolean))]
  return uniquePaths.length === 1 ? uniquePaths[0]! : commonParentDir(uniquePaths)
}

export function bindScriptDropImportZone(
  element: HTMLElement,
  resolveFilePath: DroppedFilePathResolver,
  handlers: ScriptDropImportHandlers
): () => void {
  const onDragOver = (event: DragEvent): void => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(event.dataTransfer?.files ?? [])
    const sourcePath = resolveDropImportPath(files.map(resolveFilePath))
    if (sourcePath) handlers.onPath(sourcePath)
  }

  element.addEventListener('dragover', onDragOver)
  element.addEventListener('drop', onDrop)
  return () => {
    element.removeEventListener('dragover', onDragOver)
    element.removeEventListener('drop', onDrop)
  }
}
