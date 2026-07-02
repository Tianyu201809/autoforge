import { spawn } from 'child_process'
import { existsSync } from 'fs'
import type { AppConfig } from '../../shared/types/script'

export type ExternalEditorFailureReason =
  | 'cancelled'
  | 'invalid-path'
  | 'invalid-editor'
  | 'spawn-failed'

export interface OpenExternalEditorResult {
  ok: boolean
  reason?: ExternalEditorFailureReason
  editorPath?: string
}

/** 从配置中读取已保存且存在的编辑器路径 */
export function resolveExternalEditorPath(config: AppConfig): string | undefined {
  const path = config.externalEditor?.executablePath?.trim()
  if (path && existsSync(path)) return path
  return undefined
}

/** 使用指定编辑器打开工作区目录 */
export function openInExternalEditor(
  workspacePath: string,
  editorPath: string
): OpenExternalEditorResult {
  const trimmedEditor = editorPath.trim()
  if (!trimmedEditor || !existsSync(trimmedEditor)) {
    return { ok: false, reason: 'invalid-editor' }
  }
  if (!workspacePath || !existsSync(workspacePath)) {
    return { ok: false, reason: 'invalid-path' }
  }
  try {
    spawn(trimmedEditor, [workspacePath], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true, editorPath: trimmedEditor }
  } catch {
    return { ok: false, reason: 'spawn-failed' }
  }
}
