import { basename, dirname, parse, relative, resolve, sep } from 'node:path'

export const LOCAL_IMPORT_MESSAGES = {
  empty: '没有可复制的文件',
  collision: '这些文件压平后会重名，请改成选择它们所在的文件夹。',
  limit: '本地导入超出上限：最多 6000 个文件、200 MB。',
  insideWorkspace: '不能把工作区目录再次导入',
  copyFailed: '复制失败，工作区未创建。',
  busy: '已有内容正在准备'
} as const

export const LOCAL_IMPORT_SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  '.ruff_cache',
  '.cache',
  'coverage',
  'site-packages'
])

export const LOCAL_IMPORT_MAX_FILES = 6_000
export const LOCAL_IMPORT_MAX_BYTES = 200 * 1024 * 1024

export class LocalImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalImportError'
  }
}

export interface LocalSelection {
  displayName: string
  rootPath?: string
  flattened: boolean
  /** 唯一文件夹时为空。其余情况与输入顺序一致，使用正斜杠。 */
  relativePaths: string[]
}

function toPosix(value: string): string {
  return value.split(sep).join('/')
}

function isTooHigh(parent: string, homeDir: string): boolean {
  const current = resolve(parent)
  const home = resolve(homeDir)
  const root = parse(current).root
  if (resolve(root) === current) return true
  if (current === home) return true
  const homePrefix = home.endsWith(sep) ? home : home + sep
  const parentPrefix = current.endsWith(sep) ? current : current + sep
  return homePrefix.startsWith(parentPrefix)
}

function anchorOf(entry: { path: string; kind: 'file' | 'directory' }): string {
  const resolved = resolve(entry.path)
  return entry.kind === 'directory' ? resolved : dirname(resolved)
}

export function describeLocalSelection(
  entries: Array<{ path: string; kind: 'file' | 'directory' }>,
  homeDir: string
): LocalSelection {
  if (entries.length === 0) throw new LocalImportError(LOCAL_IMPORT_MESSAGES.empty)
  if (entries.length === 1 && entries[0].kind === 'directory') {
    return {
      displayName: basename(entries[0].path),
      rootPath: entries[0].path,
      flattened: false,
      relativePaths: []
    }
  }
  if (entries.length === 1 && entries[0].kind === 'file') {
    return {
      displayName: basename(entries[0].path),
      rootPath: entries[0].path,
      flattened: false,
      relativePaths: [basename(entries[0].path)]
    }
  }

  const anchors = entries.map(anchorOf)
  const roots = new Set(anchors.map((anchor) => parse(anchor).root.toLowerCase()))
  const pieces = anchors.map((anchor) => anchor.split(sep))
  const common: string[] = []
  if (roots.size === 1) {
    for (let index = 0; index < pieces[0].length; index += 1) {
      const piece = pieces[0][index]
      if (pieces.every((parts) => parts[index]?.toLowerCase() === piece.toLowerCase())) common.push(piece)
      else break
    }
  }
  const commonParent =
    common.length === 0
      ? ''
      : common.length === 1 && /^[A-Za-z]:$/.test(common[0])
        ? `${common[0]}${sep}`
        : common.join(sep)
  const flattened = roots.size > 1 || commonParent === '' || isTooHigh(commonParent, homeDir)
  if (!flattened) {
    return {
      displayName: basename(commonParent),
      rootPath: commonParent,
      flattened: false,
      relativePaths: entries.map((entry) => toPosix(relative(commonParent, resolve(entry.path))))
    }
  }
  const relativePaths = entries.map((entry) => basename(entry.path))
  if (new Set(relativePaths.map((name) => name.toLowerCase())).size !== relativePaths.length) {
    throw new LocalImportError(LOCAL_IMPORT_MESSAGES.collision)
  }
  return { displayName: '本地文件', flattened: true, relativePaths }
}
