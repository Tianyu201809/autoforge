import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeLocalSelection, LocalImportError } from './local-workspace-import'

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
