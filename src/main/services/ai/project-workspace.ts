import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  ProjectChange,
  ProjectChangeResult,
  ProjectFile,
  ProjectFileContent,
  ProjectRootInfo
} from '../../../shared/ai-workspace-types'

const MAX_TEXT_FILE_BYTES = 512 * 1024
const MAX_BATCH_BYTES = 5 * 1024 * 1024
const IGNORED_DIRECTORIES = new Set(['.git', '.svn', 'node_modules', '.venv', '__pycache__', 'dist', 'build', 'release', 'out'])
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

interface Snapshot {
  path: string
  target: string
  previous: Buffer | null
  previousMode: number
  appliedHash: string
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function canonicalRoot(rootPath: string): string {
  let stat
  try {
    stat = lstatSync(rootPath)
  } catch {
    throw new Error('项目目录不存在')
  }
  if (stat.isSymbolicLink()) throw new Error('项目目录不能是符号链接')
  if (!stat.isDirectory()) throw new Error('项目路径必须是文件夹')
  return realpathSync.native(rootPath)
}

export function validateProjectRoot(rootPath: string): ProjectRootInfo {
  const canonicalPath = canonicalRoot(rootPath)
  if (readdirSync(canonicalPath).length > 0) throw new Error('项目目录必须为空')
  const probePath = join(canonicalPath, `.autoforge-write-${randomUUID()}.tmp`)
  let descriptor: number | undefined
  let probeFailed = false
  try {
    descriptor = openSync(probePath, 'wx', 0o600)
    writeFileSync(descriptor, 'probe')
  } catch {
    probeFailed = true
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        probeFailed = true
      }
    }
    try {
      rmSync(probePath, { force: true })
    } catch {
      probeFailed = true
    }
  }
  if (probeFailed) throw new Error('项目目录不可写或无法完成写入检查')
  return { canonicalPath, writable: true, empty: true }
}

function normalizeRelativePath(input: string): string {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw new Error('项目文件路径无效')
  const normalized = input.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || isAbsolute(input)) {
    throw new Error('项目文件路径无效')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || WINDOWS_DEVICE_NAME.test(part))) {
    throw new Error('项目文件路径无效')
  }
  return parts.join('/')
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function safeTarget(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  const candidate = resolve(root, ...normalized.split('/'))
  if (!isWithinRoot(root, candidate)) throw new Error('项目文件路径无效')
  const parts = normalized.split('/')
  let current = root
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index])
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error('项目路径不能经过符号链接')
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('项目路径父级不是文件夹')
      if (index === parts.length - 1 && !stat.isFile()) throw new Error('项目目标必须是普通文件')
    } catch (error) {
      if (!isNotFound(error)) throw error
      break
    }
  }
  return candidate
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

async function inspectFile(path: string): Promise<{ sha256: string; kind: ProjectFile['kind'] }> {
  const hash = createHash('sha256')
  const sample: Buffer[] = []
  let sampleBytes = 0
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.from(chunk)
    hash.update(buffer)
    if (sampleBytes < 4096) {
      const part = buffer.subarray(0, 4096 - sampleBytes)
      sample.push(part)
      sampleBytes += part.length
    }
  }
  return { sha256: hash.digest('hex'), kind: isText(Buffer.concat(sample)) ? 'text' : 'binary' }
}

function isText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

function assertTextSize(buffer: Buffer): void {
  if (buffer.length > MAX_TEXT_FILE_BYTES) throw new Error('项目文件超过 512 KiB')
  if (!isText(buffer)) throw new Error('不支持读取二进制文件')
}

function ensureRoot(getProjectRoot: (projectId: string) => string | null, projectId: string): string {
  const rootPath = getProjectRoot(projectId)
  if (!rootPath) throw new Error('AI 项目不存在')
  return canonicalRoot(rootPath)
}

function writeAtomic(target: string, buffer: Buffer, mode: number): void {
  const temp = join(dirname(target), `.autoforge-ai-${randomUUID()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = openSync(temp, 'wx', mode)
    writeFileSync(descriptor, buffer)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temp, target)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temp, { force: true })
  }
}

function ensureParentDirectories(root: string, target: string): void {
  const parentRelative = relative(root, dirname(target))
  if (!parentRelative) return
  let current = root
  for (const part of parentRelative.split(/[\\/]/)) {
    current = join(current, part)
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('项目路径父级无效')
    } catch (error) {
      if (!isNotFound(error)) throw error
      mkdirSync(current)
    }
  }
}

export function createProjectWorkspace(getProjectRoot: (projectId: string) => string | null) {
  async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
    const root = ensureRoot(getProjectRoot, projectId)
    const files: ProjectFile[] = []
    const pending = [root]
    while (pending.length > 0) {
      const directory = pending.pop()!
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(join(directory, entry.name))
          continue
        }
        if (!entry.isFile()) continue
        const fullPath = join(directory, entry.name)
        const stat = lstatSync(fullPath)
        if (!stat.isFile()) continue
        const relativePath = relative(root, fullPath).replace(/\\/g, '/')
        const inspected = await inspectFile(fullPath)
        files.push({
          path: relativePath,
          sha256: inspected.sha256,
          size: stat.size,
          kind: inspected.kind
        })
      }
    }
    return files.sort((left, right) => left.path.localeCompare(right.path))
  }

  function readProjectFile(projectId: string, relativePath: string): ProjectFileContent {
    const root = ensureRoot(getProjectRoot, projectId)
    const normalized = normalizeRelativePath(relativePath)
    const target = safeTarget(root, normalized)
    const buffer = readFileSync(target)
    assertTextSize(buffer)
    return {
      path: normalized,
      content: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      sha256: hashBuffer(buffer),
      size: buffer.length,
      kind: 'text'
    }
  }

  async function applyProjectChanges(
    projectId: string,
    changes: ProjectChange[],
    expectedHashes: Record<string, string | null>
  ): Promise<ProjectChangeResult> {
    const root = ensureRoot(getProjectRoot, projectId)
    const normalizedChanges = changes.map((change) => {
      if (typeof change.content !== 'string') throw new Error('项目文件内容必须是文本')
      const path = normalizeRelativePath(change.path)
      const buffer = Buffer.from(change.content, 'utf8')
      assertTextSize(buffer)
      return { path, content: change.content, buffer }
    })
    if (new Set(normalizedChanges.map((change) => change.path)).size !== normalizedChanges.length) {
      throw new Error('项目变更中包含重复路径')
    }
    const normalizedHashes = new Map<string, string | null>()
    for (const [path, hash] of Object.entries(expectedHashes)) {
      const normalizedPath = normalizeRelativePath(path)
      if (normalizedHashes.has(normalizedPath)) throw new Error('文件版本映射中包含重复路径')
      normalizedHashes.set(normalizedPath, hash)
    }
    if (normalizedChanges.reduce((total, change) => total + change.buffer.length, 0) > MAX_BATCH_BYTES) {
      throw new Error('单次项目变更不能超过 5 MiB')
    }

    const prepared = normalizedChanges.map((change) => {
      if (!normalizedHashes.has(change.path)) throw new Error(`缺少文件版本: ${change.path}`)
      const target = safeTarget(root, change.path)
      let previous: Buffer | null = null
      let previousMode = 0o600
      try {
        const stat = lstatSync(target)
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('项目目标必须是普通文件')
        previous = readFileSync(target)
        assertTextSize(previous)
        previousMode = stat.mode & 0o777
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      const expected = normalizedHashes.get(change.path)!
      const actual = previous ? hashBuffer(previous) : null
      return { ...change, target, previous, previousMode, expected, actual }
    })
    const conflicts = prepared.filter((change) => change.expected !== change.actual).map((change) => change.path)
    if (conflicts.length > 0) return { applied: [], conflicts, rollbackFailed: [] }

    const written: Snapshot[] = []
    let activePath = ''
    try {
      for (const change of prepared) {
        activePath = change.path
        ensureRoot(getProjectRoot, projectId)
        ensureParentDirectories(root, change.target)
        safeTarget(root, change.path)
        let current: Buffer | null = null
        try {
          current = readFileSync(change.target)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
        if ((current ? hashBuffer(current) : null) !== change.expected) throw new Error('项目文件已被外部修改')
        writeAtomic(change.target, change.buffer, change.previousMode)
        written.push({
          path: change.path,
          target: change.target,
          previous: change.previous,
          previousMode: change.previousMode,
          appliedHash: hashBuffer(change.buffer)
        })
        await new Promise<void>((resolveBatch) => setImmediate(resolveBatch))
        ensureRoot(getProjectRoot, projectId)
        const currentAfterYield = readFileSync(change.target)
        if (hashBuffer(currentAfterYield) !== hashBuffer(change.buffer)) {
          throw new Error('项目文件已被外部修改')
        }
      }
      return { applied: written.map((entry) => entry.path), conflicts: [], rollbackFailed: [] }
    } catch {
      const rollbackFailed: string[] = []
      const rollbackConflicts: string[] = activePath ? [activePath] : []
      for (const snapshot of written.reverse()) {
        try {
          safeTarget(root, snapshot.path)
          const current = readFileSync(snapshot.target)
          if (hashBuffer(current) !== snapshot.appliedHash) {
            rollbackFailed.push(snapshot.path)
            rollbackConflicts.push(snapshot.path)
            continue
          }
          if (snapshot.previous) writeAtomic(snapshot.target, snapshot.previous, snapshot.previousMode)
          else unlinkSync(snapshot.target)
        } catch {
          rollbackFailed.push(snapshot.path)
          rollbackConflicts.push(snapshot.path)
        }
      }
      const applied = rollbackFailed.filter((path) => {
        const snapshot = written.find((entry) => entry.path === path)
        if (!snapshot || !existsSync(snapshot.target)) return false
        try {
          return hashBuffer(readFileSync(snapshot.target)) === snapshot.appliedHash
        } catch {
          return false
        }
      })
      return {
        applied,
        conflicts: [...new Set(rollbackConflicts)],
        rollbackFailed: [...new Set(rollbackFailed)]
      }
    }
  }

  return { listProjectFiles, readProjectFile, applyProjectChanges }
}
