import { createRequire } from 'node:module'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getAppUserDataPath } from '../app-data-root'
import type { ModelCredentials } from './provider-contract'

export interface ModelCredentialEncryption {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

interface CredentialFile {
  version: 1
  entries: Record<string, string>
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

const require = createRequire(import.meta.url)
const CREDENTIAL_FILE_VERSION = 1
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function defaultEncryption(): ModelCredentialEncryption {
  let safeStorage: SafeStorageLike | null = null
  try {
    const electron = require('electron') as { safeStorage?: Partial<SafeStorageLike> } | string
    if (
      electron &&
      typeof electron !== 'string' &&
      typeof electron.safeStorage?.isEncryptionAvailable === 'function' &&
      typeof electron.safeStorage.encryptString === 'function' &&
      typeof electron.safeStorage.decryptString === 'function'
    ) {
      safeStorage = electron.safeStorage as SafeStorageLike
    }
  } catch {
    safeStorage = null
  }

  return {
    isAvailable: () => {
      try {
        return safeStorage?.isEncryptionAvailable() ?? false
      } catch {
        return false
      }
    },
    encrypt: (value) => {
      if (!safeStorage) throw new Error('模型凭据加密不可用')
      return safeStorage.encryptString(value)
    },
    decrypt: (value) => {
      if (!safeStorage) throw new Error('模型凭据解密不可用')
      return safeStorage.decryptString(value)
    }
  }
}

function normalizeCredentials(value: unknown): ModelCredentials | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') return null
  if (!input.extraHeaders || typeof input.extraHeaders !== 'object' || Array.isArray(input.extraHeaders)) return null

  const extraHeaders: Record<string, string> = {}
  for (const [name, rawValue] of Object.entries(input.extraHeaders)) {
    const normalizedName = name.trim()
    if (!HEADER_NAME.test(normalizedName) || typeof rawValue !== 'string' || /[\r\n]/.test(rawValue)) {
      return null
    }
    extraHeaders[normalizedName] = rawValue
  }

  return {
    apiKey: typeof input.apiKey === 'string' && input.apiKey.length > 0 ? input.apiKey : undefined,
    extraHeaders
  }
}

function encryptionIsAvailable(encryption: ModelCredentialEncryption): boolean {
  try {
    return encryption.isAvailable()
  } catch {
    return false
  }
}

export function createModelCredentialStore(options?: {
  filePath?: string
  encryption?: ModelCredentialEncryption
}): {
  get(profileId: string): ModelCredentials | null
  set(profileId: string, credentials: ModelCredentials): void
  delete(profileId: string): void
  isPersistent(): boolean
} {
  const filePath = options?.filePath ?? join(getAppUserDataPath(), 'ai-model-credentials.json')
  const encryption = options?.encryption ?? defaultEncryption()
  const memory = new Map<string, ModelCredentials>()

  function readFile(): CredentialFile {
    if (!existsSync(filePath)) return { version: CREDENTIAL_FILE_VERSION, entries: {} }
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<CredentialFile>
    if (
      parsed.version !== CREDENTIAL_FILE_VERSION ||
      !parsed.entries ||
      typeof parsed.entries !== 'object' ||
      Array.isArray(parsed.entries) ||
      Object.values(parsed.entries).some((entry) => typeof entry !== 'string')
    ) {
      throw new Error('模型凭据文件格式无效')
    }
    return { version: CREDENTIAL_FILE_VERSION, entries: parsed.entries as Record<string, string> }
  }

  function writeFile(contents: CredentialFile): void {
    mkdirSync(dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.tmp`
    const fd = openSync(tempPath, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(contents), 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tempPath, filePath)
  }

  function removePersisted(profileId: string): void {
    if (!existsSync(filePath)) return
    const contents = readFile()
    if (!(profileId in contents.entries)) return
    delete contents.entries[profileId]
    if (Object.keys(contents.entries).length === 0) {
      rmSync(filePath, { force: true })
      return
    }
    writeFile(contents)
  }

  return {
    get(profileId) {
      const id = profileId?.trim()
      if (!id || !PROFILE_ID.test(id)) return null
      if (!encryptionIsAvailable(encryption)) return memory.get(id) ?? null
      const inMemory = memory.get(id)
      if (inMemory) return inMemory

      try {
        const encoded = readFile().entries[id]
        if (!encoded) return null
        const decrypted = encryption.decrypt(Buffer.from(encoded, 'base64'))
        return normalizeCredentials(JSON.parse(decrypted))
      } catch {
        return null
      }
    },

    set(profileId, credentials) {
      const id = profileId?.trim()
      const normalized = normalizeCredentials(credentials)
      if (!id || !PROFILE_ID.test(id)) throw new Error('模型配置 ID 无效')
      if (!normalized) throw new Error('模型凭据格式无效')

      if (!encryptionIsAvailable(encryption)) {
        removePersisted(id)
        memory.set(id, normalized)
        return
      }

      const contents = readFile()
      const serialized = JSON.stringify(normalized)
      contents.entries[id] = encryption.encrypt(serialized).toString('base64')
      writeFile(contents)
      memory.delete(id)
    },

    delete(profileId) {
      const id = profileId?.trim()
      if (!id || !PROFILE_ID.test(id)) return
      memory.delete(id)
      removePersisted(id)
    },

    isPersistent() {
      return encryptionIsAvailable(encryption)
    }
  }
}
