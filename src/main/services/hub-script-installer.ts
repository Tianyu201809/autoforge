import AdmZip from 'adm-zip'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MANIFEST_FILENAME } from '../../shared/script-contract'
import { scriptRegistry } from './script-registry'

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
    const buffer = Buffer.from(await response.arrayBuffer())
    writeFileSync(destPath, buffer)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new HubInstallError('download_failed', `下载失败: ${message}`)
  }
}

function extractZip(zipPath: string, extractDir: string): void {
  try {
    mkdirSync(extractDir, { recursive: true })
    const zip = new AdmZip(zipPath)
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
}): Promise<{ scriptId: string; name: string }> {
  const url = assertHttpUrl(input.zipUrl)

  if (input.scriptName || input.hubScriptId) {
    console.info('[hub-install]', {
      scriptName: input.scriptName,
      hubScriptId: input.hubScriptId,
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

    let meta
    try {
      meta = scriptRegistry.importFromPath(packageRoot)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new HubInstallError('import_failed', `导入失败: ${message}`)
    }

    return { scriptId: meta.id, name: meta.name }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
