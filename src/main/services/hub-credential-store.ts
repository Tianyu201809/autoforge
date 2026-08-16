import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getAppUserDataPath } from './app-data-root'

export interface HubCredentialStore {
  load(): string | null
  save(token: string): void
  clear(): void
  isPersistent(): boolean
}

interface Encryption {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export function createHubCredentialStore(options?: {
  filePath?: string
  encryption?: Encryption
}): HubCredentialStore {
  const filePath = options?.filePath ?? join(getAppUserDataPath(), 'hub-session.json')
  const encryption = options?.encryption ?? {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value)
  }
  let memoryToken: string | null = null

  return {
    load(): string | null {
      if (!encryption.isAvailable()) return memoryToken
      if (!existsSync(filePath)) return null
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { token?: string }
        return parsed.token ? encryption.decrypt(Buffer.from(parsed.token, 'base64')) : null
      } catch {
        return null
      }
    },
    save(token: string): void {
      if (!encryption.isAvailable()) {
        memoryToken = token
        return
      }
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify({ token: encryption.encrypt(token).toString('base64') }), 'utf8')
      memoryToken = null
    },
    clear(): void {
      memoryToken = null
      rmSync(filePath, { force: true })
    },
    isPersistent: () => encryption.isAvailable()
  }
}
