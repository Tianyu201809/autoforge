import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { HubInstallError } from './hub-install-error'

export function sha256FileHex(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function assertPackageHash(actualHex: string, headerHex: string | null, tokenHex?: string): void {
  const header = headerHex?.trim().toLowerCase() ?? ''
  if (!/^[0-9a-f]{64}$/.test(header) || header !== actualHex.toLowerCase()) {
    throw new HubInstallError('invalid_package', '脚本包校验失败')
  }
  if (tokenHex !== undefined && tokenHex.trim().toLowerCase() !== header) {
    throw new HubInstallError('invalid_package', '脚本包校验失败')
  }
}
