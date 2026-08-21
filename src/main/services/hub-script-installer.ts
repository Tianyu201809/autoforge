import AdmZip from 'adm-zip'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import { MANIFEST_FILENAME } from '../../shared/script-contract'
import type { HubInstallProgress } from '../../shared/hub-types'
import { scriptRegistry } from './script-registry'
import { scriptWorkspace } from './script-workspace'
import { MAX_EXTRACTED_BYTES, MAX_ZIP_BYTES } from './safe-zip-package'

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

export const DOWNLOAD_STALL_TIMEOUT_MS = 60_000
const MAX_ZIP_ENTRIES = 2_000
const DOWNLOAD_PROGRESS_STEP_BYTES = 1024 * 1024

export type HubInstallProgressCallback = (progress: HubInstallProgress) => void

export function createDownloadTimeout(timeoutMs = DOWNLOAD_STALL_TIMEOUT_MS): {
  signal: AbortSignal
  refresh: () => void
  clear: () => void
} {
  const controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    refresh() {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), timeoutMs)
    },
    clear() {
      clearTimeout(timer)
    }
  }
}

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

async function downloadZip(
  url: string,
  destPath: string,
  reportProgress: (progress: Omit<HubInstallProgress, 'hubScriptId'>) => void
): Promise<void> {
  const downloadTimeout = createDownloadTimeout()
  let response: Response
  try {
    try {
      response = await fetch(url, { signal: downloadTimeout.signal })
      downloadTimeout.refresh()
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

    const contentLength = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_ZIP_BYTES) {
      throw new HubInstallError('invalid_package', 'ZIP 文件超过 500 MB')
    }
    if (!response.body) throw new HubInstallError('download_failed', '下载失败: 响应为空')
    let downloadedBytes = 0
    let lastReportedBytes = 0
    let lastReportedPercent = -1
    const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined
    const reportDownloadProgress = (): void => {
      const percent = totalBytes ? Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100)) : undefined
      if (
        downloadedBytes !== 0 &&
        percent === lastReportedPercent &&
        downloadedBytes - lastReportedBytes < DOWNLOAD_PROGRESS_STEP_BYTES
      ) return
      lastReportedBytes = downloadedBytes
      lastReportedPercent = percent ?? -1
      reportProgress({
        phase: 'downloading',
        message: '正在下载脚本包',
        percent,
        downloadedBytes,
        totalBytes
      })
    }
    reportDownloadProgress()
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloadTimeout.refresh()
        downloadedBytes += chunk.length
        if (downloadedBytes > MAX_ZIP_BYTES) {
          callback(new HubInstallError('invalid_package', 'ZIP 文件超过 500 MB'))
          return
        }
        reportDownloadProgress()
        callback(null, chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(response.body as any),
      counter,
      createWriteStream(destPath, { flags: 'wx' }),
      { signal: downloadTimeout.signal }
    )
    if (downloadedBytes === 0) {
      throw new HubInstallError('invalid_package', 'ZIP 文件为空')
    }
  } catch (err) {
    if (err instanceof HubInstallError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new HubInstallError('download_failed', `下载失败: ${message}`)
  } finally {
    downloadTimeout.clear()
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
        throw new HubInstallError('invalid_package', 'ZIP 解压后超过 500 MB')
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
  onProgress?: HubInstallProgressCallback
}): Promise<{ scriptId: string; name: string; status: 'installed' | 'updated' | 'duplicate_cancelled' }> {
  const url = assertHttpUrl(input.zipUrl)
  const hubScriptId = assertHubScriptId(input.hubScriptId)
  const reportProgress = (progress: Omit<HubInstallProgress, 'hubScriptId'>): void => {
    input.onProgress?.({ hubScriptId, ...progress })
  }

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

    reportProgress({ phase: 'preparing', message: '正在准备下载' })
    await downloadZip(url, zipPath, reportProgress)
    reportProgress({ phase: 'extracting', message: '正在解压脚本包' })
    extractZip(zipPath, extractedDir)
    reportProgress({ phase: 'extracting', message: '脚本包解压完成', percent: 100 })
    reportProgress({ phase: 'validating', message: '正在校验脚本包' })
    const packageRoot = resolvePackageRoot(extractedDir)
    const packageManifest = scriptWorkspace.validatePackageDirectory(packageRoot)
    reportProgress({ phase: 'validating', message: '脚本包校验完成', percent: 100 })
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
        const result = { scriptId: existing.id, name: existing.name, status: 'duplicate_cancelled' as const }
        reportProgress({ phase: 'complete', message: '已取消更新', percent: 100 })
        return result
      }
      try {
        reportProgress({ phase: 'importing', message: '正在更新本地脚本' })
        const updated = scriptRegistry.updateFromHubPackage(existing.id, packageRoot)
        const result = { scriptId: updated.id, name: updated.name, status: 'updated' as const }
        reportProgress({ phase: 'complete', message: '脚本已更新', percent: 100 })
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new HubInstallError('import_failed', `更新失败: ${message}`)
      }
    }

    let meta
    try {
      reportProgress({ phase: 'importing', message: '正在导入本地脚本' })
      meta = scriptRegistry.importFromPath(packageRoot, { hubScriptId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new HubInstallError('import_failed', `导入失败: ${message}`)
    }

    const result = { scriptId: meta.id, name: meta.name, status: 'installed' as const }
    reportProgress({ phase: 'complete', message: '脚本已安装', percent: 100 })
    return result
  } catch (err) {
    reportProgress({
      phase: 'error',
      message: '安装失败',
      error: err instanceof Error ? err.message : String(err)
    })
    throw err
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
