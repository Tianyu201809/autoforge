import type { Stats } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import {
  AUTOFORGE_MANIFEST_VERSION,
  type ScriptManifest
} from '../../shared/script-contract'
import {
  inspectExecutable,
  type ExecutableFormat,
  type ExecutablePlatform
} from './executable-inspector'
import { rawFilesystem } from './raw-filesystem'

const { lstatSync, readdirSync } = rawFilesystem

export interface ExecutableCandidate {
  entry: string
  format: ExecutableFormat
  platform: ExecutablePlatform
  size: number
}

const IGNORED_DIR_NAMES = new Set([
  '.git',
  '.svn',
  '.venv',
  '.cache',
  '__pycache__',
  'node_modules',
  'release'
])
const MAX_DISCOVERY_ENTRIES = 2_000

export function discoverExecutableCandidates(
  rootPath: string,
  platform: NodeJS.Platform = process.platform
): ExecutableCandidate[] {
  const root = resolve(rootPath)
  const candidates: ExecutableCandidate[] = []
  let visited = 0

  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      visited += 1
      if (visited > MAX_DISCOVERY_ENTRIES) {
        throw new Error(`扫描文件数量超过 ${MAX_DISCOVERY_ENTRIES} 个`)
      }
      const fullPath = join(dir, entry.name)
      const stat: Stats = lstatSync(fullPath)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) walk(fullPath)
        continue
      }
      if (!stat.isFile()) continue
      const inspection = inspectExecutable(fullPath)
      if (inspection?.kind !== 'executable' || inspection.platform !== platform) continue
      candidates.push({
        entry: relative(root, fullPath).replace(/\\/g, '/'),
        format: inspection.format,
        platform: inspection.platform,
        size: stat.size
      })
    }
  }

  walk(root)
  return candidates.sort((left, right) => left.entry.localeCompare(right.entry, 'en'))
}

export function createExecutableManifest(candidate: ExecutableCandidate): ScriptManifest {
  const extension = extname(candidate.entry)
  return {
    autoforge: AUTOFORGE_MANIFEST_VERSION,
    name: basename(candidate.entry, extension),
    version: '1.0.0',
    entry: candidate.entry,
    language: 'executable',
    env: [],
    params: []
  }
}
