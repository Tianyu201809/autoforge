import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { basename, extname, join } from 'path'
import type { ParamAttachmentItem } from '../../shared/param-attachments'

function getParamInputDir(scriptId: string, paramKey: string): string {
  return join(app.getPath('userData'), 'script-inputs', scriptId, paramKey)
}

function uniqueFileName(dir: string, originalName: string): string {
  if (!existsSync(join(dir, originalName))) return originalName
  const ext = extname(originalName)
  const base = basename(originalName, ext)
  let index = 1
  let candidate = `${base} (${index})${ext}`
  while (existsSync(join(dir, candidate))) {
    index += 1
    candidate = `${base} (${index})${ext}`
  }
  return candidate
}

export function stageParamAttachments(
  scriptId: string,
  paramKey: string,
  sourcePaths: string[]
): ParamAttachmentItem[] {
  const dir = getParamInputDir(scriptId, paramKey)
  mkdirSync(dir, { recursive: true })

  const staged: ParamAttachmentItem[] = []
  for (const sourcePath of sourcePaths) {
    if (!sourcePath || !existsSync(sourcePath)) continue
    const stat = statSync(sourcePath)
    if (!stat.isFile()) continue

    const fileName = uniqueFileName(dir, basename(sourcePath))
    const destPath = join(dir, fileName)
    copyFileSync(sourcePath, destPath)
    staged.push({ name: fileName, path: destPath, size: stat.size })
  }
  return staged
}

export function removeParamAttachment(filePath: string): boolean {
  if (!filePath || !existsSync(filePath)) return true
  try {
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}
