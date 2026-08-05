import { randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { MANIFEST_FILENAME, validateManifest } from '../../shared/script-contract'
import type { CreateScriptInput } from '../../shared/mcp-types'
import type { ScriptFileContent, ScriptMeta } from '../../shared/types/script'
import { UTF8 } from '../../shared/encoding'
import { MCP_LIMITS } from '../../shared/mcp-control-protocol'
import { scriptWorkspace } from './script-workspace'

const LEGACY_MANIFEST_FILENAME = 'scriptbox.json'

function assertWithinRoot(root: string, candidate: string, input: string): string {
  const relativePath = relative(root, candidate)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`path_forbidden: ${input}`)
  }
  return candidate
}

function normalizeRelativePath(relativePath: string): string {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('path_forbidden: empty path')
  }
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.includes('\0') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`path_forbidden: ${relativePath}`)
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '..')) {
    throw new Error(`path_forbidden: ${relativePath}`)
  }
  return parts.join('/')
}

export function assertSafeWorkspacePath(workspacePath: string, relativePath: string): string {
  const root = realpathSync(workspacePath)
  const normalized = normalizeRelativePath(relativePath)
  const candidate = assertWithinRoot(root, resolve(root, normalized), relativePath)
  if (existsSync(candidate)) {
    return assertWithinRoot(root, realpathSync(candidate), relativePath)
  }
  let existingParent = dirname(candidate)
  while (!existsSync(existingParent) && existingParent !== dirname(existingParent)) {
    existingParent = dirname(existingParent)
  }
  assertWithinRoot(root, realpathSync(existingParent), relativePath)
  return join(existingParent, basename(candidate))
}

function decodeContent(content: string, encoding?: 'utf8' | 'base64'): Buffer {
  if (typeof content !== 'string') throw new Error('invalid_params: content must be a string')
  const buffer = Buffer.from(content, encoding === 'base64' ? 'base64' : UTF8)
  if (buffer.length > MCP_LIMITS.maxFileBytes) {
    throw new Error(`invalid_params: file exceeds ${MCP_LIMITS.maxFileBytes} bytes`)
  }
  return buffer
}

function writeAtomic(targetPath: string, buffer: Buffer): void {
  const directory = dirname(targetPath)
  mkdirSync(directory, { recursive: true })
  const tempPath = join(directory, `.mcp-write-${randomUUID()}.tmp`)
  try {
    writeFileSync(tempPath, buffer, { mode: 0o600 })
    renameSync(tempPath, targetPath)
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true })
  }
}

export function readWorkspaceFileWithLimit(
  script: ScriptMeta,
  relativePath: string,
  limit = MCP_LIMITS.maxFileBytes
): ScriptFileContent {
  const fullPath = assertSafeWorkspacePath(script.workspacePath, relativePath)
  const stat = statSync(fullPath)
  if (!stat.isFile()) throw new Error(`not_found: file ${relativePath}`)
  if (stat.size > Math.min(limit, MCP_LIMITS.maxFileBytes)) {
    throw new Error(`invalid_params: file exceeds ${Math.min(limit, MCP_LIMITS.maxFileBytes)} bytes`)
  }
  return scriptWorkspace.readWorkspaceFile(script, relativePath)
}

export function writeWorkspaceFileAtomic(
  script: ScriptMeta,
  relativePath: string,
  content: string,
  encoding?: 'utf8' | 'base64'
): void {
  const normalized = normalizeRelativePath(relativePath)
  const targetRelative = normalized === LEGACY_MANIFEST_FILENAME ? MANIFEST_FILENAME : normalized
  const targetPath = assertSafeWorkspacePath(script.workspacePath, targetRelative)
  const buffer = decodeContent(content, encoding)

  if (targetRelative === MANIFEST_FILENAME) {
    const previous = existsSync(targetPath) ? readFileSync(targetPath) : null
    let parsed: unknown
    try {
      parsed = JSON.parse(buffer.toString(UTF8))
    } catch {
      throw new Error('validation_failed: manifest is not valid JSON')
    }
    const result = validateManifest(parsed)
    if (!result.ok) throw new Error(`validation_failed: ${result.error}`)

    writeAtomic(targetPath, buffer)
    try {
      scriptWorkspace.validatePackageDirectory(script.workspacePath)
    } catch (error) {
      if (previous) writeAtomic(targetPath, previous)
      else rmSync(targetPath, { force: true })
      throw new Error(`validation_failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    return
  }

  writeAtomic(targetPath, buffer)
}

export function createScriptFromPayload(input: CreateScriptInput): ScriptMeta {
  const manifestResult = validateManifest(input.manifest)
  if (!manifestResult.ok) throw new Error(`validation_failed: ${manifestResult.error}`)
  const manifest = manifestResult.manifest
  const scriptId = randomUUID()
  const targetDir = scriptWorkspace.getScriptDir(scriptId)
  const stagingDir = `${targetDir}.mcp-incoming-${randomUUID()}`
  let totalBytes = Buffer.byteLength(JSON.stringify(manifest), UTF8)

  try {
    mkdirSync(stagingDir, { recursive: true })
    writeFileSync(join(stagingDir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), UTF8)

    const seen = new Set<string>([MANIFEST_FILENAME])
    for (const file of input.files) {
      const normalized = normalizeRelativePath(file.path)
      if (normalized === MANIFEST_FILENAME || normalized === LEGACY_MANIFEST_FILENAME || seen.has(normalized)) {
        throw new Error(`invalid_params: duplicate or reserved file ${file.path}`)
      }
      const buffer = decodeContent(file.content, file.encoding)
      totalBytes += buffer.length
      if (totalBytes > MCP_LIMITS.maxCreatePayloadBytes) {
        throw new Error(`invalid_params: create payload exceeds ${MCP_LIMITS.maxCreatePayloadBytes} bytes`)
      }
      seen.add(normalized)
      const target = assertSafeWorkspacePath(stagingDir, normalized)
      writeAtomic(target, buffer)
    }

    scriptWorkspace.validatePackageDirectory(stagingDir)
    renameSync(stagingDir, targetDir)
    return scriptWorkspace.manifestToMeta(scriptId, manifest) as ScriptMeta
  } catch (error) {
    if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
    throw error
  } finally {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true })
  }
}
