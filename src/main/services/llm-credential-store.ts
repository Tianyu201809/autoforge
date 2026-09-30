import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getAppUserDataPath } from './app-data-root'

/**
 * 按 LLM 配置 id 保存 API Key。
 *
 * 与 hub-credential-store 一致：优先使用 Electron safeStorage 加密落盘，
 * 不可用时退化为进程内存（重启后需重填），任何情况下密钥都不进入 AppConfig / SQLite。
 */
export interface LlmCredentialStore {
  load(profileId: string): string | null
  save(profileId: string, apiKey: string): void
  clear(profileId: string): void
  has(profileId: string): boolean
  isPersistent(): boolean
}

interface Encryption {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

interface StoreFile {
  version: number
  keys: Record<string, string>
}

const STORE_VERSION = 1

export function createLlmCredentialStore(options?: {
  filePath?: string
  encryption?: Encryption
}): LlmCredentialStore {
  const filePath = options?.filePath ?? join(getAppUserDataPath(), 'llm-credentials.json')
  const encryption = options?.encryption ?? {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value)
  }
  const memory = new Map<string, string>()

  function readFile(): StoreFile {
    if (!existsSync(filePath)) return { version: STORE_VERSION, keys: {} }
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StoreFile>
      const keys = parsed?.keys
      return {
        version: STORE_VERSION,
        keys: keys && typeof keys === 'object' ? (keys as Record<string, string>) : {}
      }
    } catch {
      return { version: STORE_VERSION, keys: {} }
    }
  }

  function writeFile(store: StoreFile): void {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(store), 'utf8')
  }

  function load(profileId: string): string | null {
    if (!profileId?.trim()) return null
    if (!encryption.isAvailable()) return memory.get(profileId) ?? null

    const encoded = readFile().keys[profileId]
    if (!encoded) return null
    try {
      const value = encryption.decrypt(Buffer.from(encoded, 'base64'))
      return value || null
    } catch {
      return null
    }
  }

  return {
    load,

    save(profileId: string, apiKey: string): void {
      if (!profileId?.trim()) return
      if (!encryption.isAvailable()) {
        memory.set(profileId, apiKey)
        return
      }
      const store = readFile()
      store.keys[profileId] = encryption.encrypt(apiKey).toString('base64')
      writeFile(store)
      memory.delete(profileId)
    },

    clear(profileId: string): void {
      if (!profileId?.trim()) return
      memory.delete(profileId)
      if (!encryption.isAvailable()) return
      const store = readFile()
      if (!(profileId in store.keys)) return
      delete store.keys[profileId]
      if (Object.keys(store.keys).length === 0) {
        rmSync(filePath, { force: true })
        return
      }
      writeFile(store)
    },

    has: (profileId: string) => load(profileId) !== null,

    isPersistent: () => encryption.isAvailable()
  }
}
