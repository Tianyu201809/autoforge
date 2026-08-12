import { dirname, join, relative, resolve } from 'node:path'
import { rawFilesystem } from './raw-filesystem'

const { copyFileSync, lstatSync, mkdirSync, readdirSync } = rawFilesystem

export interface CopyPackageOptions {
  requiredEntry?: string
}

export interface CopyPackageResult {
  skippedPaths: string[]
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function isSafeRelativePath(filePath: string): boolean {
  const parts = toPosixPath(filePath).split('/')
  return Boolean(filePath) && !filePath.startsWith('/') && !/^[a-zA-Z]:/.test(filePath) && !parts.includes('..')
}

export function copyPackageDirectory(
  sourceDir: string,
  targetDir: string,
  options: CopyPackageOptions = {}
): CopyPackageResult {
  const sourceRoot = resolve(sourceDir)
  const targetRoot = resolve(targetDir)
  const requiredEntry = options.requiredEntry ? toPosixPath(options.requiredEntry) : undefined
  const skippedPaths: string[] = []
  const skipped = new Set<string>()

  const relativeSourcePath = (sourcePath: string): string =>
    toPosixPath(relative(sourceRoot, sourcePath))
  const recordSkipped = (sourcePath: string): void => {
    const entryPath = relativeSourcePath(sourcePath)
    if (!entryPath || skipped.has(entryPath)) return
    skipped.add(entryPath)
    skippedPaths.push(entryPath)
  }

  if (requiredEntry) {
    if (!isSafeRelativePath(requiredEntry)) throw new Error(`非法入口路径: ${requiredEntry}`)
    const sourceEntry = resolve(sourceRoot, requiredEntry)
    const targetEntry = resolve(targetRoot, requiredEntry)
    const sourceStat = lstatSync(sourceEntry)
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error(`程序入口必须是普通文件: ${requiredEntry}`)
    }
    try {
      mkdirSync(dirname(targetEntry), { recursive: true })
      copyFileSync(sourceEntry, targetEntry)
    } catch (error) {
      throw new Error(`复制程序入口失败: ${requiredEntry}`, { cause: error })
    }
  }

  const copyDirectory = (currentSource: string, currentTarget: string): void => {
    try {
      mkdirSync(currentTarget, { recursive: true })
    } catch {
      recordSkipped(currentSource)
      return
    }

    let entries
    try {
      entries = readdirSync(currentSource, { withFileTypes: true })
    } catch {
      recordSkipped(currentSource)
      return
    }

    for (const entry of entries) {
      const sourcePath = join(currentSource, entry.name)
      const targetPath = join(currentTarget, entry.name)
      const entryPath = relativeSourcePath(sourcePath)
      if (entryPath === requiredEntry) continue

      let stat
      try {
        stat = lstatSync(sourcePath)
      } catch {
        recordSkipped(sourcePath)
        continue
      }
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        copyDirectory(sourcePath, targetPath)
        continue
      }
      if (!stat.isFile()) continue
      try {
        copyFileSync(sourcePath, targetPath)
      } catch {
        recordSkipped(sourcePath)
      }
    }
  }

  copyDirectory(sourceRoot, targetRoot)
  return { skippedPaths: skippedPaths.sort((left, right) => left.localeCompare(right, 'en')) }
}
