import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ScriptManifest } from '../../../shared/script-contract'
import { createProjectChecks } from './project-checks'

function fixture(t: { after(callback: () => void): void }, name = 'Autoforge Demo 项目') {
  const root = mkdtempSync(join(tmpdir(), `${name}-`))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function writeManifest(root: string, entry: string, language: 'javascript' | 'python'): ScriptManifest {
  const manifest: ScriptManifest = { autoforge: '1.0', name: 'Demo', entry, language }
  writeFileSync(join(root, 'autoforge.json'), JSON.stringify(manifest))
  return manifest
}

function python3Executable(): string | null {
  try {
    if (process.platform === 'win32') {
      return execFileSync('py', ['-3', '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim()
    }
    return execFileSync('python3', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

test('validates a package manifest and entry in a Unicode path', async (t) => {
  const root = fixture(t)
  writeManifest(root, 'index.mjs', 'javascript')
  writeFileSync(join(root, 'index.mjs'), 'export function run() {}')
  const checks = createProjectChecks()

  const result = await checks.checkScriptPackage(root)
  assert.equal(result.status, 'passed')
  assert.equal(result.code, 'package_valid')
})

test('blocks script packages that contain symlinks', async (t) => {
  const root = fixture(t)
  const outsideRoot = mkdtempSync(join(tmpdir(), 'autoforge-check-outside-'))
  t.after(() => rmSync(outsideRoot, { recursive: true, force: true }))
  writeManifest(root, 'index.mjs', 'javascript')
  writeFileSync(join(root, 'index.mjs'), 'export function run() {}')
  symlinkSync(outsideRoot, join(root, 'linked-dir'), 'junction')

  const result = await createProjectChecks().checkScriptPackage(root)
  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'project_symlink')
})

test('blocks JavaScript syntax errors without executing top-level code', async (t) => {
  const root = fixture(t)
  const sentinel = join(root, 'executed.txt')
  writeManifest(root, 'index.mjs', 'javascript')
  writeFileSync(join(root, 'index.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinel)}, 'ran'); export function {`)
  const result = await createProjectChecks().checkScriptSyntax(root, writeManifest(root, 'index.mjs', 'javascript'))

  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'javascript_syntax')
  assert.equal(result.diagnostics.join(' ').includes('writeFileSync'), false)
  assert.equal(existsSync(sentinel), false)
})

test('blocks Python syntax errors using AST parsing', async (t) => {
  const python = python3Executable()
  if (!python) return t.skip('Python 3 is not installed')
  const root = fixture(t)
  writeManifest(root, 'main.py', 'python')
  writeFileSync(join(root, 'main.py'), 'def broken(:\n    pass\n')

  const result = await createProjectChecks().checkScriptSyntax(root, writeManifest(root, 'main.py', 'python'), python)
  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'python_syntax')
  assert.match(result.diagnostics[0], /line 1/i)
})

test('blocks syntax checking when the configured Python executable is missing', async (t) => {
  const root = fixture(t)
  writeManifest(root, 'main.py', 'python')
  writeFileSync(join(root, 'main.py'), 'print("safe")\n')

  const result = await createProjectChecks().checkScriptSyntax(root, writeManifest(root, 'main.py', 'python'), join(root, 'missing-python'))
  assert.equal(result.status, 'blocked')
  assert.equal(result.code, 'python_missing')
})

test('reports checker timeouts with a stable result', async (t) => {
  const root = fixture(t)
  writeManifest(root, 'index.mjs', 'javascript')
  writeFileSync(join(root, 'index.mjs'), 'export function run() {}')
  const checks = createProjectChecks({
    timeoutMs: 20,
    runCommand: async (_executable, _args, options) => {
      assert.equal(options.timeoutMs, 20)
      throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
    }
  })

  const result = await checks.checkScriptSyntax(root, writeManifest(root, 'index.mjs', 'javascript'))
  assert.equal(result.status, 'blocked')
  assert.equal(result.code, 'checker_timeout')
})

test('checks entry paths containing spaces and Unicode characters', async (t) => {
  const root = fixture(t)
  mkdirSync(join(root, '脚本目录'))
  writeManifest(root, '脚本目录/入口.mjs', 'javascript')
  writeFileSync(join(root, '脚本目录', '入口.mjs'), 'export default function run() {}')

  const result = await createProjectChecks().checkScriptSyntax(root, writeManifest(root, '脚本目录/入口.mjs', 'javascript'))
  assert.equal(result.status, 'passed')
})
