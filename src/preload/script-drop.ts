import { webUtils } from 'electron'

export type DropPathResolver = (event: DragEvent) => string[]

export function getDroppedFilePath(file: File): string {
  return webUtils.getPathForFile(file)
}

export function collectDropPaths(event: DragEvent): string[] {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return []

  const paths: string[] = []
  if (dataTransfer.files?.length) {
    for (let index = 0; index < dataTransfer.files.length; index++) {
      const path = getDroppedFilePath(dataTransfer.files[index]!)
      if (path) paths.push(path)
    }
  }

  if (!paths.length && dataTransfer.items?.length) {
    for (let index = 0; index < dataTransfer.items.length; index++) {
      const item = dataTransfer.items[index]
      if (item?.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      const path = getDroppedFilePath(file)
      if (path) paths.push(path)
    }
  }
  return paths
}

export function bindFilePathDropTarget(
  element: HTMLInputElement | HTMLTextAreaElement,
  resolvePaths: DropPathResolver = collectDropPaths
): () => void {
  const clearFeedback = (): void => element.classList.remove('is-file-path-drop-target')
  const onDragOver = (event: DragEvent): void => {
    if (element.disabled || element.readOnly) return
    if (!resolvePaths(event).length) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    element.classList.add('is-file-path-drop-target')
  }
  const onDragLeave = (): void => clearFeedback()
  const onDrop = (event: DragEvent): void => {
    const paths = resolvePaths(event)
    clearFeedback()
    if (element.disabled || element.readOnly || !paths.length) return
    event.preventDefault()
    event.stopPropagation()
    element.value = paths.join('\n')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }

  element.addEventListener('dragover', onDragOver)
  element.addEventListener('dragleave', onDragLeave)
  element.addEventListener('drop', onDrop)
  return () => {
    clearFeedback()
    element.removeEventListener('dragover', onDragOver)
    element.removeEventListener('dragleave', onDragLeave)
    element.removeEventListener('drop', onDrop)
  }
}
