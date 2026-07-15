import AdmZip from 'adm-zip'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import { MANIFEST_FILENAME } from '../../shared/script-contract'
import { scriptRegistry } from './script-registry'
import { scriptWorkspace } from './script-workspace'

export type HubInstallErrorCode =
  | 'invalid_request'
  | 'download_failed'
  | 'invalid_package'
  | 'import_failed'

export class HubInstallError extends Error {
  constructor(
    public code: HubInstallErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HubInstallError'
  }
}

const DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_ZIP_BYTES = 50 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024
const MAX_ZIP_ENTRIES = 2_000

function assertHttpUrl(zipUrl: unknown): string {
  if (typeof zipUrl !== 'string' || !zipUrl.trim()) {
    throw new HubInstallError('invalid_request', '缺少 zipUrl')
  }
  let u: URL
  try {
    u = new URL(zipUrl)
  } catch {
    throw new HubInstallError('invalid_request', 'zipUrl 不是合法 URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new HubInstallError('invalid_request', 'zipUrl 仅支持 http/https')
  }
  return u.toString()
}

function assertHubScriptId(hubScriptId: unknown): string {
  if (typeof hubScriptId !== 'string' || !hubScriptId.trim()) {
    throw new HubInstallError('invalid_request', '缺少 hubScriptId')
  }
  if (hubScriptId.trim().length > 200) {
    throw new HubInstallError('invalid_request', 'hubScriptId 过长')
  }
  return hubScriptId.trim()
}

function hasManifest(dir: string): boolean {
  return existsSync(join(dir, MANIFEST_FILENAME))
}

function resolvePackageRoot(extractedDir: string): string {
  if (hasManifest(extractedDir)) {
    return extractedDir
  }

  const entries = readdirSync(extractedDir, { withFileTypes: true })
  const subdirs = entries.filter((e) => e.isDirectory())
  if (subdirs.length === 1) {
    const candidate = join(extractedDir, subdirs[0].name)
    if (hasManifest(candidate)) {
      return candidate
    }
  }

  throw new HubInstallError('invalid_package', '不是有效的 Autoforge 脚本包')
}

async function downloadZip(url: string, destPath: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new HubInstallError('download_failed', `下载失败: ${message}`)
  }

  if (!response.ok) {
    throw new HubInstallError(
      'download_failed',
      `下载失败: HTTP ${response.status} ${response.statusText}`
    )
  }

  try {
    const contentLength = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_ZIP_BYTES) {
      throw new HubInstallError('invalid_package', 'ZIP 文件超过 50 MB')
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_ZIP_BYTES) {
      throw new HubInstallError('invalid_package', 'ZIP 文件超过 50 MB')
    }
    writeFileSync(destPath, buffer)
  } catch (err) {
    if (err instanceof HubInstallError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new HubInstallError('download_failed', `下载失败: ${message}`)
  }
}

function extractZip(zipPath: string, extractDir: string): void {
  try {
    mkdirSync(extractDir, { recursive: true })
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()
    if (entries.length > MAX_ZIP_ENTRIES) {
      throw new HubInstallError('invalid_package', 'ZIP 文件条目过多')
    }
    let extractedBytes = 0
    for (const entry of entries) {
      const entryName = entry.entryName.replace(/\\/g, '/')
      if (
        entryName.startsWith('/') ||
        /^[a-zA-Z]:/.test(entryName) ||
        entryName.split('/').some((part) => part === '..')
      ) {
        throw new HubInstallError('invalid_package', `ZIP 包含非法路径: ${entry.entryName}`)
      }
      extractedBytes += entry.header.size
      if (extractedBytes > MAX_EXTRACTED_BYTES) {
        throw new HubInstallError('invalid_package', 'ZIP 解压后超过 100 MB')
      }
    }
    zip.extractAllTo(extractDir, true)
  } catch (err) {
    if (err instanceof HubInstallError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new HubInstallError('invalid_package', `解压失败: ${message}`)
  }
}

export async function installScriptFromHubZip(input: {
  zipUrl: string
  scriptName?: string
  hubScriptId?: string
}): Promise<{ scriptId: string; name: string; status: 'installed' | 'updated' | 'duplicate_cancelled' }> {
  const url = assertHttpUrl(input.zipUrl)
  const hubScriptId = assertHubScriptId(input.hubScriptId)

  if (input.scriptName || input.hubScriptId) {
    console.info('[hub-install]', {
      scriptName: input.scriptName,
      hubScriptId,
      zipUrl: url
    })
  }

  const tempDir = mkdtempSync(join(tmpdir(), `autoforge-hub-install-${randomUUID()}-`))

  try {
    const zipPath = join(tempDir, 'package.zip')
    const extractedDir = join(tempDir, 'extracted')

    await downloadZip(url, zipPath)
    extractZip(zipPath, extractedDir)
    const packageRoot = resolvePackageRoot(extractedDir)
    const packageManifest = scriptWorkspace.validatePackageDirectory(packageRoot)
    const existing = scriptRegistry.getByHubScriptId(hubScriptId)

    if (existing) {
      const response = await dialog.showMessageBox({
        type: 'question',
        title: '脚本已安装',
        message: `“${existing.name}”已经存在，是否更新？`,
        detail: `当前版本：${existing.version || '未知'}\n待安装版本：${packageManifest.version || '未知'}\n更新会保留收藏、定时任务和本地配置。`,
        buttons: ['更新', '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      if (response.response !== 0) {
        return { scriptId: existing.id, name: existing.name, status: 'duplicate_cancelled' }
      }
      try {
        const updated = scriptRegistry.updateFromHubPackage(existing.id, packageRoot)
        return { scriptId: updated.id, name: updated.name, status: 'updated' }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new HubInstallError('import_failed', `更新失败: ${message}`)
      }
    }

    let meta
    try {
      meta = scriptRegistry.importFromPath(packageRoot, { hubScriptId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new HubInstallError('import_failed', `导入失败: ${message}`)
    }

    return { scriptId: meta.id, name: meta.name, status: 'installed' }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
