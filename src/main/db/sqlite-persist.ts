import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'fs'

export function replaceFileAtomically(targetPath: string, bytes: Uint8Array): void {
  const tmpPath = `${targetPath}.tmp`
  const fd = openSync(tmpPath, 'w')
  try {
    writeSync(fd, Buffer.from(bytes))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmpPath, targetPath)
}

export function removeStaleTemp(targetPath: string): void {
  rmSync(`${targetPath}.tmp`, { force: true })
}
