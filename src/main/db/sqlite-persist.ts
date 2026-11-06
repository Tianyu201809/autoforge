import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'fs'

export function replaceFileAtomically(targetPath: string, bytes: Uint8Array): void {
  const tmpPath = `${targetPath}.tmp`
  const fd = openSync(tmpPath, 'w')
  try {
    const buffer = Buffer.from(bytes)
    let offset = 0
    while (offset < bytes.byteLength) {
      const written = writeSync(fd, buffer, offset, bytes.byteLength - offset)
      if (written === 0) {
        throw new Error('writeSync returned 0 before all bytes were written')
      }
      offset += written
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmpPath, targetPath)
}

export function removeStaleTemp(targetPath: string): void {
  rmSync(`${targetPath}.tmp`, { force: true })
}

export function createDirtyScheduler(options: {
  now: () => number
  schedule: (fn: () => void, ms: number) => { cancel: () => void }
  flush: () => void
  debounceMs?: number
  maxWaitMs?: number
}): { markDirty: () => void; flushNow: () => void } {
  const debounceMs = options.debounceMs ?? 300
  const maxWaitMs = options.maxWaitMs ?? 1000
  let timer: { cancel: () => void } | null = null
  let firstDirtyAt: number | null = null
  const clear = () => {
    timer?.cancel()
    timer = null
    firstDirtyAt = null
  }
  return {
    markDirty() {
      const now = options.now()
      if (firstDirtyAt === null) firstDirtyAt = now
      timer?.cancel()
      const wait = Math.max(0, Math.min(debounceMs, firstDirtyAt + maxWaitMs - now))
      timer = options.schedule(() => {
        timer = null
        firstDirtyAt = null
        options.flush()
      }, wait)
    },
    flushNow() {
      clear()
      options.flush()
    }
  }
}
