import AdmZip from 'adm-zip'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import type { ScriptManifest } from '../../shared/script-contract'
import type { ScriptMeta } from '../../shared/types/script'
import { buildScriptExportPlan, writeScriptExportZip } from './script-package-exporter'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-export-executable-'))
  roots.push(root)
  return root
}

function makeScript(root: string, language: ScriptMeta['language']): ScriptMeta {
  return { language, workspacePath: root, entry: 'bin/tool.exe', version: '1.0.0' } as ScriptMeta
}

function makeManifest(include?: string[]): ScriptManifest {
  return {
    autoforge: '1.0',
    name: 'Tool',
    version: '1.0.0',
    entry: 'bin/tool.exe',
    language: 'executable',
    ...(include ? { export: { include } } : {})
  }
}

function seedExecutablePackage(root: string): void {
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(join(root, 'autoforge.json'), '{}')
  writeFileSync(join(root, 'README.md'), '# Tool')
  writeFileSync(join(root, 'bin', 'tool.exe'), 'MZ-binary')
}

test('collects manifest, entry, readme and explicit resources for a native package', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  writeFileSync(join(root, 'bin', 'runtime.dll'), 'dll')
  writeFileSync(join(root, 'bin', 'settings.ini'), 'key=value')
  writeFileSync(join(root, 'bin', 'notes.txt'), 'ignored')

  const plan = buildScriptExportPlan(
    makeScript(root, 'executable'),
    makeManifest(['bin/runtime.dll', 'bin/settings.ini'])
  )

  assert.deepEqual(plan.files, [
    'autoforge.json',
    'bin/runtime.dll',
    'bin/settings.ini',
    'bin/tool.exe',
    'README.md'
  ])
  assert.equal(plan.defaultFileName, 'Tool-1.0.0.zip')
})

test('writes a re-importable archive with the binary entry intact', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  const binary = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x00, 0xff, 0xfe, 0x00])
  writeFileSync(join(root, 'bin', 'tool.exe'), binary)
  writeFileSync(join(root, 'bin', 'runtime.dll'), 'dll')

  const script = makeScript(root, 'executable')
  const plan = buildScriptExportPlan(script, makeManifest(['bin/runtime.dll']))
  const destination = join(makeRoot(), 'tool.zip')
  writeScriptExportZip(script, plan, destination)

  const entries = new AdmZip(destination).getEntries()
  assert.deepEqual(
    entries.map((entry) => entry.entryName).sort(),
    ['README.md', 'autoforge.json', 'bin/runtime.dll', 'bin/tool.exe']
  )
  const extracted = entries.find((entry) => entry.entryName === 'bin/tool.exe')?.getData()
  assert.deepEqual(extracted, binary)
})

test('does not parse the binary entry for dependencies', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  writeFileSync(join(root, 'bin', 'tool.exe'), Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0xff, 0xfe]))

  const plan = buildScriptExportPlan(makeScript(root, 'executable'), makeManifest())

  assert.deepEqual(plan.files, ['autoforge.json', 'bin/tool.exe', 'README.md'])
})

test('accepts a native binary far above the former 10 MB file limit', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  truncateSync(join(root, 'bin', 'tool.exe'), 64 * 1024 * 1024)

  const plan = buildScriptExportPlan(makeScript(root, 'executable'), makeManifest())

  assert.equal(plan.totalBytes > 64 * 1024 * 1024, true)
})

test('rejects a native file larger than 500 MB', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  truncateSync(join(root, 'bin', 'tool.exe'), 500 * 1024 * 1024 + 1)

  assert.throws(
    () => buildScriptExportPlan(makeScript(root, 'executable'), makeManifest()),
    /单个导出文件超过 500 MB/
  )
})

test('rejects restricted native resources matched by export.include', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  writeFileSync(join(root, 'bin', 'signing.key'), 'secret')

  assert.throws(
    () => buildScriptExportPlan(makeScript(root, 'executable'), makeManifest(['bin/*.key'])),
    /export\.include 未匹配任何文件/
  )
})

test('rejects an export.include pattern that escapes the workspace', () => {
  const root = makeRoot()
  seedExecutablePackage(root)

  assert.throws(
    () => buildScriptExportPlan(makeScript(root, 'executable'), makeManifest(['../outside.dll'])),
    /非法导出路径/
  )
})

test('rejects a symlinked native entry', { skip: process.platform === 'win32' }, () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  writeFileSync(join(root, 'bin', 'real.dll'), 'dll')
  symlinkSync(join(root, 'bin', 'real.dll'), join(root, 'bin', 'linked.dll'))

  assert.throws(
    () => buildScriptExportPlan(makeScript(root, 'executable'), makeManifest(['bin/linked.dll'])),
    /导出不允许符号链接/
  )
})

test('keeps static dependency collection for JavaScript packages', () => {
  const root = makeRoot()
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'autoforge.json'), '{}')
  writeFileSync(join(root, 'index.mjs'), "import './lib/helper.mjs'\nexport function run() {}\n")
  writeFileSync(join(root, 'lib', 'helper.mjs'), 'export const helper = 1\n')
  writeFileSync(join(root, 'lib', 'unused.mjs'), 'export const unused = 1\n')

  const plan = buildScriptExportPlan(
    { language: 'javascript', workspacePath: root, entry: 'index.mjs', version: '1.0.0' } as ScriptMeta,
    { autoforge: '1.0', name: 'Tool', version: '1.0.0', entry: 'index.mjs', language: 'javascript' }
  )

  assert.deepEqual(plan.files, ['autoforge.json', 'index.mjs', 'lib/helper.mjs'])
})

test('rejects a binary entry for JavaScript packages', () => {
  const root = makeRoot()
  seedExecutablePackage(root)

  assert.throws(
    () => buildScriptExportPlan(
      { language: 'javascript', workspacePath: root, entry: 'bin/tool.exe', version: '1.0.0' } as ScriptMeta,
      { autoforge: '1.0', name: 'Tool', version: '1.0.0', entry: 'bin/tool.exe', language: 'javascript' }
    ),
    /文件类型不在导出白名单中/
  )
})
