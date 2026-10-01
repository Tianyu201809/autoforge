import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promoteStagedPackage, removeDirectoryCommitted } from './repo-workspace'

test('成功时用暂存目录替换旧产物，并留下新内容', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-stage-'))
  const staging = join(root, 'package-next')
  const pkg = join(root, 'package')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'old.txt'), 'old')
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, 'new.txt'), 'new')
  try {
    promoteStagedPackage(staging, pkg)
    assert.equal(readFileSync(join(pkg, 'new.txt'), 'utf8'), 'new')
    assert.equal(existsSync(join(pkg, 'old.txt')), false)
    assert.equal(existsSync(staging), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('目录仍在时删除结果为失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-rm-'))
  try {
    assert.equal(removeDirectoryCommitted(root), true)
    assert.equal(existsSync(root), false)
    assert.equal(removeDirectoryCommitted(root), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
