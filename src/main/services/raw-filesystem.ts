import * as nodeFs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const rawFilesystem: typeof nodeFs = (() => {
  try {
    return require('original-fs') as typeof nodeFs
  } catch {
    return nodeFs
  }
})()
