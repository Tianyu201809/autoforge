import type { rmSync } from 'node:fs'
import { rawFilesystem } from './raw-filesystem'

type RemovePath = typeof rmSync

export function removePathBestEffort(
  targetPath: string,
  remove: RemovePath = rawFilesystem.rmSync
): void {
  try {
    if (!rawFilesystem.existsSync(targetPath)) return
    remove(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch {
    // Windows scanners can race Node's rimraf implementation after chmod/stat.
  }
}
