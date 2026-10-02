import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { analyzeRepoDirectory } from './repo-analyzer'
import { copyLocalImport, createLocalWorkspace, describeLocalSelection, LocalImportError } from './local-workspace-import'

const home = 'C:\\Users\\me'

test('单个文件夹用文件夹名，不给出子路径', () => {
  const selection = describeLocalSelection([{ path: 'C:\\work\\demo', kind: 'directory' }], home)
  assert.equal(selection.displayName, 'demo')
  assert.equal(selection.rootPath, 'C:\\work\\demo')
  assert.equal(selection.flattened, false)
  assert.deepEqual(selection.relativePaths, [])
})

test('单个文件用文件名', () => {
  const selection = describeLocalSelection([{ path: 'C:\\work\\demo\\index.mjs', kind: 'file' }], home)
  assert.equal(selection.displayName, 'index.mjs')
  assert.equal(selection.rootPath, 'C:\\work\\demo\\index.mjs')
  assert.equal(selection.flattened, false)
  assert.deepEqual(selection.relativePaths, ['index.mjs'])
})

test('同一项目下的多个文件保留相对路径', () => {
  const selection = describeLocalSelection(
    [
      { path: 'C:\\Users\\me\\proj\\a.ts', kind: 'file' },
      { path: 'C:\\Users\\me\\proj\\src\\b.ts', kind: 'file' }
    ],
    home
  )
  assert.equal(selection.displayName, 'proj')
  assert.equal(selection.rootPath, 'C:\\Users\\me\\proj')
  assert.equal(selection.flattened, false)
  assert.deepEqual(selection.relativePaths, ['a.ts', 'src/b.ts'])
})

test('共同父目录是用户主目录时只留文件名', () => {
  const selection = describeLocalSelection(
    [
      { path: 'C:\\Users\\me\\a.ts', kind: 'file' },
      { path: 'C:\\Users\\me\\docs\\b.ts', kind: 'file' }
    ],
    home
  )
  assert.equal(selection.flattened, true)
  assert.equal(selection.rootPath, undefined)
  assert.equal(selection.displayName, '本地文件')
  assert.deepEqual(selection.relativePaths, ['a.ts', 'b.ts'])
})

test('共同父目录高于用户主目录，或位于盘符根、不同盘符时压平', () => {
  const aboveHome = describeLocalSelection(
    [
      { path: 'C:\\Users\\a.ts', kind: 'file' },
      { path: 'C:\\Users\\me\\b.ts', kind: 'file' }
    ],
    home
  )
  assert.equal(aboveHome.flattened, true)

  const driveRoot = describeLocalSelection(
    [
      { path: 'C:\\a.ts', kind: 'file' },
      { path: 'C:\\nested\\b.ts', kind: 'file' }
    ],
    home
  )
  assert.equal(driveRoot.flattened, true)

  const otherDrive = describeLocalSelection(
    [
      { path: 'C:\\work\\a.ts', kind: 'file' },
      { path: 'D:\\work\\b.ts', kind: 'file' }
    ],
    home
  )
  assert.equal(otherDrive.flattened, true)
  assert.deepEqual(otherDrive.relativePaths, ['a.ts', 'b.ts'])
})

test('压平后文件名相撞则拒绝', () => {
  assert.throws(
    () =>
      describeLocalSelection(
        [
          { path: 'C:\\Users\\me\\one\\index.ts', kind: 'file' },
          { path: 'C:\\Users\\me\\two\\index.ts', kind: 'file' }
        ],
        home
      ),
    (error: unknown) => {
      assert.ok(error instanceof LocalImportError)
      assert.equal(error.message, '这些文件压平后会重名，请改成选择它们所在的文件夹。')
      return true
    }
  )
})

test('单个文件夹的内容落在 repo 根目录，并跳过依赖与版本库', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-local-import-'))
  const source = join(root, 'demo')
  const repoDir = join(root, 'repo')
  const workspaces = join(root, 'repo-workspaces')
  mkdirSync(join(source, 'src'), { recursive: true })
  mkdirSync(join(source, 'node_modules', 'left-pad'), { recursive: true })
  mkdirSync(join(source, '.git'), { recursive: true })
  mkdirSync(join(source, 'dist'), { recursive: true })
  mkdirSync(repoDir, { recursive: true })
  writeFileSync(join(source, 'src', 'index.mjs'), 'export {}')
  writeFileSync(join(source, 'node_modules', 'left-pad', 'index.js'), 'x')
  writeFileSync(join(source, '.git', 'HEAD'), 'ref')
  writeFileSync(join(source, 'dist', 'app.js'), 'built')
  symlinkSync(join(source, 'src'), join(source, 'linked'), 'junction')
  try {
    const selection = copyLocalImport({
      selectedPaths: [source],
      repoDir,
      workspacesRoot: workspaces,
      homeDir: root
    })
    assert.equal(selection.displayName, 'demo')
    assert.equal(readFileSync(join(repoDir, 'src', 'index.mjs'), 'utf8'), 'export {}')
    assert.equal(readFileSync(join(repoDir, 'dist', 'app.js'), 'utf8'), 'built')
    assert.equal(existsSync(join(repoDir, 'node_modules')), false)
    assert.equal(existsSync(join(repoDir, '.git')), false)
    assert.equal(existsSync(join(repoDir, 'linked')), false)
    assert.equal(existsSync(join(source, 'src', 'index.mjs')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('跳过之后没有文件则失败，源文件仍在', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-local-empty-'))
  const source = join(root, 'demo')
  const repoDir = join(root, 'repo')
  mkdirSync(join(source, 'node_modules'), { recursive: true })
  mkdirSync(repoDir, { recursive: true })
  writeFileSync(join(source, 'node_modules', 'index.js'), 'x')
  try {
    assert.throws(
      () => copyLocalImport({ selectedPaths: [source], repoDir, workspacesRoot: join(root, 'ws'), homeDir: root }),
      (error: unknown) => error instanceof LocalImportError && error.message === '没有可复制的文件'
    )
    assert.equal(existsSync(join(source, 'node_modules', 'index.js')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('压平后目录里的同名文件会拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-local-clash-'))
  const repoDir = join(root, 'repo')
  mkdirSync(join(root, 'one'), { recursive: true })
  mkdirSync(join(root, 'two'), { recursive: true })
  mkdirSync(repoDir, { recursive: true })
  writeFileSync(join(root, 'one', 'index.ts'), 'a')
  writeFileSync(join(root, 'two', 'index.ts'), 'b')
  try {
    assert.throws(
      () =>
        copyLocalImport({
          selectedPaths: [join(root, 'one', 'index.ts'), join(root, 'two', 'index.ts')],
          repoDir,
          workspacesRoot: join(root, 'ws'),
          homeDir: root
        }),
      (error: unknown) =>
        error instanceof LocalImportError &&
        error.message === '这些文件压平后会重名，请改成选择它们所在的文件夹。'
    )
    assert.equal(existsSync(join(repoDir, 'index.ts')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('不能导入工作区目录内部的路径', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-local-inside-'))
  const workspaces = join(root, 'repo-workspaces')
  const source = join(workspaces, 'old', 'repo', 'index.mjs')
  mkdirSync(join(workspaces, 'old', 'repo'), { recursive: true })
  mkdirSync(join(root, 'dest'), { recursive: true })
  writeFileSync(source, 'export {}')
  try {
    assert.throws(
      () =>
        copyLocalImport({
          selectedPaths: [source],
          repoDir: join(root, 'dest'),
          workspacesRoot: workspaces,
          homeDir: root
        }),
      (error: unknown) => error instanceof LocalImportError && error.message === '不能把工作区目录再次导入'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('超过文件数上限时失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-local-count-'))
  const source = join(root, 'demo')
  mkdirSync(source, { recursive: true })
  mkdirSync(join(root, 'repo'), { recursive: true })
  writeFileSync(join(source, 'a.txt'), 'a')
  writeFileSync(join(source, 'b.txt'), 'b')
  try {
    assert.throws(
      () =>
        copyLocalImport({
          selectedPaths: [source],
          repoDir: join(root, 'repo'),
          workspacesRoot: join(root, 'ws'),
          homeDir: root,
          limits: { maxFiles: 1, maxBytes: 200 * 1024 * 1024 }
        }),
      (error: unknown) => error instanceof LocalImportError && error.message === '本地导入超出上限：最多 6000 个文件、200 MB。'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('超过字节上限时失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-local-bytes-'))
  const source = join(root, 'demo')
  mkdirSync(source, { recursive: true })
  mkdirSync(join(root, 'repo'), { recursive: true })
  writeFileSync(join(source, 'big.txt'), '12345')
  try {
    assert.throws(
      () =>
        copyLocalImport({
          selectedPaths: [source],
          repoDir: join(root, 'repo'),
          workspacesRoot: join(root, 'ws'),
          homeDir: root,
          limits: { maxFiles: 6000, maxBytes: 4 }
        }),
      (error: unknown) => error instanceof LocalImportError && error.message === '本地导入超出上限：最多 6000 个文件、200 MB。'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('目标不是目录时提示复制失败，源文件仍在', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-local-fail-'))
  const source = join(root, 'demo')
  const repoDir = join(root, 'not-a-dir')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'index.mjs'), 'export {}')
  writeFileSync(repoDir, 'blocked')
  try {
    assert.throws(
      () =>
        copyLocalImport({
          selectedPaths: [source],
          repoDir,
          workspacesRoot: join(root, 'ws'),
          homeDir: root
        }),
      (error: unknown) => error instanceof LocalImportError && error.message === '复制失败，工作区未创建。'
    )
    assert.equal(readFileSync(join(source, 'index.mjs'), 'utf8'), 'export {}')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('复制后的目录可以分析成 local 画像，失败时不留下工作区', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-local-profile-'))
  const source = join(root, 'demo')
  const workspaces = join(root, 'repo-workspaces')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'index.mjs'), 'export {}')
  try {
    const created = createLocalWorkspace({
      selectedPaths: [source],
      workspacesRoot: workspaces,
      homeDir: root
    })
    assert.equal(created.repoDir, join(workspaces, created.taskId, 'repo'))
    assert.equal(readFileSync(join(created.repoDir, 'index.mjs'), 'utf8'), 'export {}')
    const profile = analyzeRepoDirectory(
      created.repoDir,
      {
        provider: 'local',
        owner: '',
        repo: created.selection.displayName,
        url: created.selection.rootPath ?? '',
        transport: 'https',
        cloneUrl: ''
      },
      '本地目录',
      { fetchMethod: 'local', commitSha: null }
    )
    assert.equal(profile.fetchMethod, 'local')
    assert.equal(profile.ref.provider, 'local')
    assert.equal(profile.resolvedRef, '本地目录')
    assert.equal(profile.commitSha, null)

    const inside = join(workspaces, 'nested', 'index.mjs')
    mkdirSync(join(workspaces, 'nested'), { recursive: true })
    writeFileSync(inside, 'export {}')
    const before = readdirSync(workspaces)
    assert.throws(
      () =>
        createLocalWorkspace({
          selectedPaths: [inside],
          workspacesRoot: workspaces,
          homeDir: root
        }),
      (error: unknown) => error instanceof LocalImportError && error.message === '不能把工作区目录再次导入'
    )
    assert.deepEqual(readdirSync(workspaces).sort(), before.sort())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
