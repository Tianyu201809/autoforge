# 本地文件夹与文件导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仓库工作区页面把一个本地文件夹或同一次选中的多个文件复制成新工作区，再用现有对话做 LLM 转换。

**Architecture:** 纯函数先决定显示名、是否压平、相对路径。主进程按这个结果复制到 `repo-workspaces/<taskId>/repo`，跳过版本库和依赖目录，失败则删掉整个新工作区。画像标记 `provider: 'local'`，随后走现有的 `analyzeRepoDirectory`、handoff 和对话。页面只增加选择与拖拽，不自动开始转换。

**Tech Stack:** TypeScript、Vue 3、Electron IPC、Node.js test runner（`node --import tsx --test`）

## Global Constraints

- 一次导入是一个文件夹，或同一次选择 / 拖入的多个路径，成为一个工作区。
- 能算出可用的共同父目录时保留相对路径。父目录是盘符根、用户主目录、主目录的祖先，或路径位于不同盘符时，只留文件名。
- 压平后基名相撞：整次取消，提示「这些文件压平后会重名，请改成选择它们所在的文件夹。」
- 只选中一个文件夹时，其子项位于 `repo/` 根目录，不再多套一层同名目录。显示名是该文件夹名。
- 只选中一个文件时，显示名是该文件名。多个路径且保留结构时，显示名是共同父目录名。压平后的多个文件显示名为 `本地文件`。
- 导入后打开对话，不调用模型，不自动开始转换。
- 复制进工作区。原路径不改、不删。删除工作区只删副本。
- 不复制：`.git`、`.hg`、`.svn`、`node_modules`、`bower_components`、`.venv`、`venv`、`__pycache__`、`.mypy_cache`、`.pytest_cache`、`.tox`、`.ruff_cache`、`.cache`、`coverage`、`site-packages`。
- 保留：`dist`、`build`、`out`、`target`、`vendor`，以及名为 `env` 的目录。
- 不跟随符号链接。
- 跳过之后没有文件：提示「没有可复制的文件」。
- 待复制文件超过 6000 个，或总字节超过 200 MB：提示「本地导入超出上限：最多 6000 个文件、200 MB。」
- 源路径位于 `repo-workspaces` 之内，或复制目标越出本次 `repo/`：提示「不能把工作区目录再次导入」。
- 复制中途失败：提示「复制失败，工作区未创建。」并删除半成品目录。
- 已有拉取或复制在进行：提示「已有内容正在准备」。
- 入口只在仓库工作区页面。主窗口现有脚本拖拽不变。不做 zip。
- 本地画像：`ref.provider` 为 `'local'`，`ref.owner` 为 `''`，`ref.repo` 为显示名，`ref.url` 为根路径（压平时为 `''`），`ref.cloneUrl` 为 `''`，`ref.transport` 为 `'https'`，`fetchMethod` 为 `'local'`，`resolvedRef` 为 `本地目录`，`commitSha` 为 `null`。
- 列表在 `provider === 'local'` 时，`repo` 用显示名，不用 `owner/repo`。
- 本地删除确认正文写「工作区里的副本」，不写「克隆的仓库」。Git 工作区确认文案保持不变。
- 本机 shell 是 PowerShell。提交用 here-string，不用 bash HEREDOC。

## 文件职责

- `src/shared/repo-types.ts`：`local` 来源类型，以及画像上的 `localOrigin`。
- `src/main/services/local-workspace-import.ts`：布局、复制、上限与失败回滚。不分析仓库，不写画像。
- `src/main/services/local-workspace-import.test.ts`：临时目录测试。
- `src/main/services/repo-conversion-service.ts`：忙碌锁、分析、handoff、返回工作区。
- `src/main/services/repo-workspace.ts`：列表对本地工作区使用显示名。
- `src/main/ipc/handlers.ts`、`src/shared/ipc-channels.ts`、`src/preload/index.ts`、`src/renderer/src/env.d.ts`：选择框与导入 IPC。
- `src/preload/script-drop.ts`：把拖入路径派发给页面上的区域。
- `src/renderer/src/lib/repo-conversion-chat.ts`：本地删除确认文案。
- `src/renderer/src/composables/useRepoImport.ts` 与 `src/renderer/src/components/RepoConversionPage.vue`：新建表单上的选择、拖拽和打开工作区。

---

### Task 1: 决定本地导入的显示名和相对路径

**Files:**
- Create: `src/main/services/local-workspace-import.ts`
- Create: `src/main/services/local-workspace-import.test.ts`
- Modify: `src/shared/repo-types.ts`
- Modify: `package.json`（`test:unit` 在 `src/main/services/repo-analyzer.test.ts` 后面加上这个新测试文件）
- Test: `src/main/services/local-workspace-import.test.ts`

**Interfaces:**
- Produces: `LocalImportError`
- Produces: `LOCAL_IMPORT_MESSAGES`
- Produces: `describeLocalSelection(entries: Array<{ path: string; kind: 'file' | 'directory' }>, homeDir: string): LocalSelection`
- Produces: `LocalSelection`，字段 `displayName: string`、`rootPath?: string`、`flattened: boolean`、`relativePaths: string[]`（与 `entries` 一一对应；唯一文件夹时为空数组）

- [ ] **Step 1: Write the failing test**

把下面的测试写进 `src/main/services/local-workspace-import.test.ts`。

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeLocalSelection, LocalImportError } from './local-workspace-import'

const home = 'C:\\Users\\me'

test('单个文件夹用文件夹名，不给出子路径', () => {
  const selection = describeLocalSelection(
    [{ path: 'C:\\work\\demo', kind: 'directory' }],
    home
  )
  assert.equal(selection.displayName, 'demo')
  assert.equal(selection.rootPath, 'C:\\work\\demo')
  assert.equal(selection.flattened, false)
  assert.deepEqual(selection.relativePaths, [])
})

test('单个文件用文件名', () => {
  const selection = describeLocalSelection(
    [{ path: 'C:\\work\\demo\\index.mjs', kind: 'file' }],
    home
  )
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/local-workspace-import.test.ts`

Expected: FAIL，`describeLocalSelection` 未定义。

- [ ] **Step 3: Write minimal implementation**

在 `src/shared/repo-types.ts` 把两处联合类型改成：

```ts
export type RepoProvider = 'github' | 'gitee' | 'local'
export type RepoFetchMethod = 'archive' | 'git' | 'local'
```

在 `RepoProfile` 末尾增加：

```ts
/** 本地导入的来源。Git 拉取的画像没有这个字段。 */
localOrigin?: {
  selectedPaths: string[]
  /** 未压平时的根路径。压平时省略。 */
  rootPath?: string
  flattened: boolean
}
```

新建 `src/main/services/local-workspace-import.ts`：

```ts
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
  const commonParent = common.length === 0 ? '' : common.length === 1 && /^[A-Za-z]:$/.test(common[0]) ? `${common[0]}\\` : common.join(sep)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/local-workspace-import.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/shared/repo-types.ts src/main/services/local-workspace-import.ts src/main/services/local-workspace-import.test.ts package.json
git commit -m @"
feat: 计算本地导入的相对路径和显示名

"@
```

---

### Task 2: 把选中的路径复制进工作区

**Files:**
- Modify: `src/main/services/local-workspace-import.ts`
- Modify: `src/main/services/local-workspace-import.test.ts`
- Test: `src/main/services/local-workspace-import.test.ts`

**Interfaces:**
- Consumes: `describeLocalSelection`、`LocalImportError`、`LOCAL_IMPORT_MESSAGES`、`LOCAL_IMPORT_SKIP_DIRS`、`LOCAL_IMPORT_MAX_FILES`、`LOCAL_IMPORT_MAX_BYTES`
- Produces: `copyLocalImport(input: { selectedPaths: string[]; repoDir: string; workspacesRoot: string; homeDir: string; limits?: { maxFiles: number; maxBytes: number } }): LocalSelection`

复制成功返回布局。任何失败抛出 `LocalImportError`，并且不负责删除 `repoDir` 的父目录；调用方删除整个 `<taskId>/`。

- [ ] **Step 1: Write the failing test**

在同一个测试文件追加。使用 `node:fs` 的 `mkdtempSync`、`mkdirSync`、`writeFileSync`、`symlinkSync`、`readFileSync`、`existsSync`、`statSync`，以及 `node:os` 的 `tmpdir`。符号链接用 `'junction'`，与 `safe-package-copy.test.ts` 相同。

```ts
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
```

`copyLocalImport` 增加可选参数 `limits?: { maxFiles: number; maxBytes: number }`。省略时使用 6000 与 `200 * 1024 * 1024`。再追加这些测试，每个用自己的临时目录，并在 `finally` 里 `rmSync`：

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/local-workspace-import.test.ts`

Expected: FAIL，`copyLocalImport` 未定义。Task 1 的测试仍然 PASS。

- [ ] **Step 3: Write minimal implementation**

`copyLocalImport` 用 `lstatSync` 判断每一个选中路径。符号链接直接跳过，不调用 `statSync`。唯一一个真实目录时，遍历其子项；子项的目标相对路径从该目录算起。多个路径时先 `describeLocalSelection`。未压平时，目录项要继续往下走，目标路径是 `relative(rootPath, file)`。压平时，每个实际文件只用 `basename`。

遍历时：

- `lstat` 为符号链接则跳过。
- 目录名在 `LOCAL_IMPORT_SKIP_DIRS` 里则不进入。
- 累加文件数和 `size`。超过 `limits` 抛出 `LOCAL_IMPORT_MESSAGES.limit`。
- 用 `mkdirSync` 和 `copyFileSync` 写入 `repoDir`。写入前用 `resolve` 确认目标仍在 `repoDir` 内，否则抛出 `LOCAL_IMPORT_MESSAGES.insideWorkspace`。
- 结束后文件数为 0，抛出 `LOCAL_IMPORT_MESSAGES.empty`。
- 任何非 `LocalImportError` 包成 `LOCAL_IMPORT_MESSAGES.copyFailed`。

选中路径 `resolve` 之后等于 `workspacesRoot`，或位于它下面，抛出 `LOCAL_IMPORT_MESSAGES.insideWorkspace`。

压平遍历时用一个 `Set` 记录已经使用的基名，小写比较。重复则抛出 `LOCAL_IMPORT_MESSAGES.collision`，并在抛出前不要留下这个重名文件；已经写入的其他文件由调用方整目录删除。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/local-workspace-import.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/main/services/local-workspace-import.ts src/main/services/local-workspace-import.test.ts
git commit -m @"
feat: 把本地文件夹复制进转换工作区

"@
```

---

### Task 3: 写成 local 工作区并提供 IPC

**Files:**
- Modify: `src/main/services/repo-conversion-service.ts`
- Modify: `src/main/services/repo-workspace.ts`（`listRepoWorkspaces` 里组装 `repo` 的那一行）
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Test: `src/main/services/local-workspace-import.test.ts`（补一条「复制后再分析」的测试，不启动 Electron）

**Interfaces:**
- Consumes: `copyLocalImport`、`LOCAL_IMPORT_MESSAGES`、`analyzeRepoDirectory`、`prepareRepoWorkspace`、`createRepoTaskId`、`writeWorkspaceProfile`、`writeWorkspaceHandoff`、`buildHandoffDocument`、`toWorkspaceInfo`
- Produces: `RepoConversionService.importLocal(paths: string[], onProgress?: RepoConvertProgressReporter): Promise<RepoWorkspaceInfo>`
- Produces: IPC `repo:import-local`，参数 `string[]`，返回 `RepoWorkspaceInfo`
- Produces: IPC `repo:pick-local`，参数 `'directory' | 'files'`，取消时返回 `null`，否则返回 `string[]`
- Produces: `window.autoforge.repo.importLocal` 与 `window.autoforge.repo.pickLocal`

- [ ] **Step 1: Write the failing test**

在 `local-workspace-import.test.ts` 增加一个测试：临时目录里放 `demo/index.mjs`，内容为 `export {}`。调用即将导出的 `createLocalWorkspace`：

```ts
export function createLocalWorkspace(input: {
  selectedPaths: string[]
  workspacesRoot: string
  homeDir: string
}): { taskId: string; repoDir: string; selection: LocalSelection }
```

测试断言返回的 `repoDir` 在 `workspacesRoot/<taskId>/repo`，文件已复制。然后调用现有 `analyzeRepoDirectory(repoDir, ref, '本地目录', { fetchMethod: 'local', commitSha: null })`，其中 `ref` 为：

```ts
{
  provider: 'local',
  owner: '',
  repo: selection.displayName,
  url: selection.rootPath ?? '',
  transport: 'https',
  cloneUrl: ''
}
```

断言 `profile.fetchMethod === 'local'`、`profile.ref.provider === 'local'`、`profile.resolvedRef === '本地目录'`、`profile.commitSha === null`。再故意让 `copyLocalImport` 抛错的路径走 `createLocalWorkspace`（源路径就在 `workspacesRoot` 内），断言该 `taskId` 目录不存在。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/services/local-workspace-import.test.ts`

Expected: FAIL，`createLocalWorkspace` 未定义。

- [ ] **Step 3: Write minimal implementation**

`createLocalWorkspace`：

1. 对每个路径 `lstatSync`。符号链接跳过。得到 `describeLocalSelection` 需要的 `kind`。真实目录为 `directory`，其余文件为 `file`。全部都不是文件或目录时抛出「没有可复制的文件」。
2. `selection = describeLocalSelection(...)`。
3. `taskId = createRepoTaskId`，传入 Task 1 里那种 `provider: 'local'` 的 `RepoRef`，`repo` 用 `selection.displayName`。
4. `repoDir = join(workspacesRoot, taskId, 'repo')`，`mkdirSync`。
5. `try { copyLocalImport(...) } catch { rmSync(join(workspacesRoot, taskId), { recursive: true, force: true }); throw }`
6. 返回 `{ taskId, repoDir, selection }`。

`listRepoWorkspaces` 里把 `repo:` 改成：

```ts
repo:
  profile.ref.provider === 'local'
    ? profile.ref.repo
    : `${profile.ref.owner}/${profile.ref.repo}`,
```

`RepoConversionService` 增加 `importLocal`。与 `convert` 共用 `busy`。`busy` 已为 true 时抛出 `new LocalImportError(LOCAL_IMPORT_MESSAGES.busy)`。流程：

1. `report`，`phase: 'extracting'`，`message: '正在复制到工作区'`。
2. `createLocalWorkspace({ selectedPaths, workspacesRoot: getRepoWorkspacesRoot(), homeDir: homedir() })`。
3. `prepareRepoWorkspace(taskId)`，补上 `.autoforge` 和空的 `package/`。
4. `analyzeRepoDirectory`，参数与本任务测试相同。
5. `profile.localOrigin = { selectedPaths, rootPath: selection.rootPath, flattened: selection.flattened }`。
6. `profile.resolvedRef = '本地目录'`。
7. 写 profile 和 handoff，与 `convert` 成功路径相同。
8. `report`，`phase: 'workspace-ready'`，`message: '转换工作区已就绪'`。
9. 返回 `toWorkspaceInfo`。
10. 分析或写文件失败时，`rmSync` 整个 `<taskId>` 目录，再把非 `LocalImportError` 包成「复制失败，工作区未创建。」
11. `finally` 里 `busy = false`。

`src/shared/ipc-channels.ts` 在 `REPO_FETCH` 旁增加：

```ts
REPO_PICK_LOCAL: 'repo:pick-local',
REPO_IMPORT_LOCAL: 'repo:import-local',
```

`handlers.ts`：

```ts
ipcMain.handle(IPC.REPO_PICK_LOCAL, async (_event, kind: unknown) => {
  const win = getWindow()
  const directory = kind === 'directory'
  const result = await dialog.showOpenDialog(win ?? undefined, {
    properties: directory ? ['openDirectory'] : ['openFile', 'multiSelections']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths
})

ipcMain.handle(IPC.REPO_IMPORT_LOCAL, async (event, paths: unknown) => {
  if (!Array.isArray(paths) || paths.some((item) => typeof item !== 'string')) {
    throw new Error('invalid_params: 缺少路径')
  }
  return getRepoConversionService().importLocal(paths, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC.EVENT_REPO_CONVERT_PROGRESS, progress)
  })
})
```

preload 的 `repo` 与 `env.d.ts` 的 `repo` 各加：

```ts
pickLocal: (kind: 'directory' | 'files') => Promise<string[] | null>
importLocal: (paths: string[]) => Promise<RepoWorkspaceInfo>
```

preload 实现为 `ipcRenderer.invoke(IPC.REPO_PICK_LOCAL, kind)` 与 `ipcRenderer.invoke(IPC.REPO_IMPORT_LOCAL, paths)`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/services/local-workspace-import.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/main/services/local-workspace-import.ts src/main/services/local-workspace-import.test.ts src/main/services/repo-conversion-service.ts src/main/services/repo-workspace.ts src/main/ipc/handlers.ts src/shared/ipc-channels.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m @"
feat: 从本地路径创建可转换的工作区

"@
```

---

### Task 4: 在仓库工作区页面选择或拖入本地内容

**Files:**
- Modify: `src/preload/script-drop.ts`
- Modify: `src/preload/index.ts`（`files.bindPathDropZone`）
- Modify: `src/renderer/src/env.d.ts`（`files.bindPathDropZone`）
- Modify: `src/renderer/src/lib/repo-conversion-chat.ts`
- Modify: `src/renderer/src/lib/repo-conversion-chat.test.ts`
- Modify: `src/renderer/src/composables/useRepoImport.ts`
- Modify: `src/renderer/src/components/RepoConversionPage.vue`
- Test: `src/renderer/src/lib/repo-conversion-chat.test.ts`

**Interfaces:**
- Consumes: `repo.pickLocal`、`repo.importLocal`、`workspaceDeleteConfirm`、`collectDropPaths`
- Produces: `files.bindPathDropZone(element: HTMLElement): () => void`。放下文件时在元素上派发 `CustomEvent`，事件名 `autoforge-local-import`，`detail` 为 `string[]`。
- Produces: `workspaceDeleteConfirm(repoLabel: string, workspacePath: string, source?: 'git' | 'local')`

- [ ] **Step 1: Write the failing test**

在 `repo-conversion-chat.test.ts` 追加：

```ts
test('本地工作区的删除确认写副本，不写克隆', () => {
  const confirm = workspaceDeleteConfirm('demo', 'C:/data/repo-workspaces/demo', 'local')
  assert.match(confirm.message, /工作区里的副本/)
  assert.equal(confirm.message.includes('克隆'), false)
  assert.match(confirm.message, /已导入/)
})
```

现有 Git 测试不传第三个参数，必须仍然匹配「克隆」。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/renderer/src/lib/repo-conversion-chat.test.ts`

Expected: FAIL，本地文案仍包含「克隆」，或第三个参数被忽略。

- [ ] **Step 3: Write minimal implementation**

`workspaceDeleteConfirm` 增加第三个参数，默认 `'git'`。Git 分支保持「克隆的仓库和转换产物会一起删除。」。`'local'` 时这一行改为「工作区里的副本和转换产物会一起删除。原来的文件夹不会动。」

`useRepoImport.deleteWorkspace` 从历史项或当前画像读取 `provider`。`provider === 'local'` 时把 `'local'` 传给 `workspaceDeleteConfirm`。

`script-drop.ts` 导出：

```ts
export function bindPathDropZone(element: HTMLElement): () => void {
  const onDragOver = (event: DragEvent): void => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    element.classList.add('is-local-import-target')
  }
  const onDragLeave = (): void => element.classList.remove('is-local-import-target')
  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    element.classList.remove('is-local-import-target')
    const paths = collectDropPaths(event)
    element.dispatchEvent(new CustomEvent('autoforge-local-import', { detail: paths }))
  }
  element.addEventListener('dragover', onDragOver)
  element.addEventListener('dragleave', onDragLeave)
  element.addEventListener('drop', onDrop)
  return () => {
    element.removeEventListener('dragover', onDragOver)
    element.removeEventListener('dragleave', onDragLeave)
    element.removeEventListener('drop', onDrop)
  }
}
```

preload 的 `files` 增加 `bindPathDropZone`，直接返回 `bindPathDropZone(element)`。`env.d.ts` 的 `files` 增加同样的签名。

`useRepoImport` 增加 `importLocalPaths(paths: string[])`：

- `paths` 为空、`busy` 或 `converting` 时直接返回。
- `pulling` 保持 true，`busy = true`，清空 `error`。
- `progress` 设为 `{ taskId: '', phase: 'extracting', message: '正在复制到工作区' }`。
- `await window.autoforge.repo.importLocal(paths)`。
- 成功后写入 `workspace`，清空 `instruction` 和 `allowBuildThisRun`，toast 标题「工作区已就绪」，正文用 `profile.ref.repo`。然后 `loadHistory()`。
- 失败时恢复进入函数前的 `workspace`，`error` 用现有 `describeError`。
- `finally` 里 `busy = false`。

再增加 `pickLocal(kind: 'directory' | 'files')`：调用 `repo.pickLocal`。返回 `null` 或空数组时什么都不做。否则调用 `importLocalPaths`。

`RepoConversionPage.vue`：

- 侧栏按钮文字由「拉取」改为「新建」。禁用条件保持 `busy || converting`。
- 空列表由「还没有拉取过的仓库。」改为「还没有工作区。」
- 侧栏说明改为：「删除工作区时，这里的副本会一起删除，原来的文件夹不会动。已经导入的脚本会留在列表里。」
- 在拉取按钮行下面、表单的「拉取」按钮上面，加一块 `div.forge-local`，`ref="localDropRef"`。里面是一句「或从本机放入」，一个拖拽提示「把文件夹或文件拖到这里」，以及两个 `type="button"`：「选择文件夹」调用 `pickLocal('directory')`，「选择文件」调用 `pickLocal('files')`。`busy` 时两个按钮禁用，区域加上 `aria-disabled`。
- `watch(localDropRef)`：元素出现时 `bindPathDropZone`，回调里 `importLocalPaths(event.detail)`。`onCleanup` 解开监听。
- `importLocalPaths` 成功且没有 `error` 时，把 `pulling` 设为 false。与 `submitPull` 相同。
- 对话副标题：`profile.ref.provider === 'local'` 时，以「本地目录」开头；`profile.ref.url` 非空则接上该路径，否则接上「多个位置」；后面仍可接 `convertibilityReason`。Git 工作区保持现在的 `resolvedRef` 行。
- 列表副标题已经使用 `resolvedRef`。本地画像的 `resolvedRef` 是「本地目录」，不要再拼 `owner/repo`。

拖拽区域的样式沿用现有 `sb-*` 变量：虚线边框、圆角 10px、内边距 12px。`.is-local-import-target` 用 `sb-accent-solid` 做边框色。不要新增字体或配色。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/renderer/src/lib/repo-conversion-chat.test.ts src/main/services/local-workspace-import.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/preload/script-drop.ts src/preload/index.ts src/renderer/src/env.d.ts src/renderer/src/lib/repo-conversion-chat.ts src/renderer/src/lib/repo-conversion-chat.test.ts src/renderer/src/composables/useRepoImport.ts src/renderer/src/components/RepoConversionPage.vue
git commit -m @"
feat: 在工作区页面拖入或选择本地文件

"@
```
