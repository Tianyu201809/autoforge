export function environmentEncryptionNotice(encryptionAvailable: boolean): string | null {
  return encryptionAvailable ? null : '当前未能加密，变量以明文留在本机数据库'
}

export function environmentReadable(env: { variablesReadable?: boolean }): boolean {
  return env.variablesReadable !== false
}
