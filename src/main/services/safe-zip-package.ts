import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hasManifest } from './script-workspace'

export const MAX_ZIP_BYTES = 500 * 1024 * 1024
export const MAX_EXTRACTED_BYTES = 500 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 2_000

export function assertSafeZipEntryName(rawEntryName: string): string {
  const entryName = rawEntryName.replace(/\\/g, '/')
  if (
    entryName.startsWith('/') ||
    /^[a-zA-Z]:/.test(entryName) ||
    entryName.split('/').some((part) => part === '..')
  ) {
    throw new Error(`ZIP 包含非法路径: ${rawEntryName}`)
  }
  return entryName
}

export function extractZipSecurely(zipPath: string, extractDir: string): void {
  mkdirSync(extractDir, { recursive: true })
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error('ZIP 文件条目过多')

  let extractedBytes = 0
  for (const entry of entries) {
    assertSafeZipEntryName(entry.entryName)
    extractedBytes += entry.header.size
    if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('ZIP 解压后超过 500 MB')
  }
  zip.extractAllTo(extractDir, true)
}

export function resolveZipPackageRoot(extractedDir: string): string {
  const root = resolve(extractedDir)
  if (hasManifest(root)) return root
  const entries = readdirSync(root, { withFileTypes: true })
  if (entries.length === 1 && entries[0].isDirectory()) {
    const soleDirectory = join(root, entries[0].name)
    if (existsSync(soleDirectory)) return soleDirectory
  }
  return root
}
