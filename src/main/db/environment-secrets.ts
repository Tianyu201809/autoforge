export type EnvCipher = {
  isAvailable: () => boolean
  encrypt: (value: string) => Buffer
  decrypt: (value: Buffer) => string
}

const ENCRYPTED_PREFIX = 'enc:v1:'

type OpenedVariables = {
  variables: Record<string, string>
  readable: boolean
  needsMigration: boolean
}

function unreadable(): OpenedVariables {
  return { variables: {}, readable: false, needsMigration: false }
}

export function sealVariables(variables: Record<string, string>, cipher: EnvCipher): string {
  const json = JSON.stringify(variables ?? {})
  if (!cipher.isAvailable()) return json
  return `${ENCRYPTED_PREFIX}${cipher.encrypt(json).toString('base64')}`
}

export function openVariables(stored: string, cipher: EnvCipher): OpenedVariables {
  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    try {
      const encoded = stored.slice(ENCRYPTED_PREFIX.length)
      const json = cipher.decrypt(Buffer.from(encoded, 'base64'))
      return {
        variables: JSON.parse(json) as Record<string, string>,
        readable: true,
        needsMigration: false
      }
    } catch {
      return unreadable()
    }
  }

  if (stored.startsWith('{')) {
    try {
      return {
        variables: JSON.parse(stored) as Record<string, string>,
        readable: true,
        needsMigration: cipher.isAvailable()
      }
    } catch {
      return unreadable()
    }
  }

  return unreadable()
}
