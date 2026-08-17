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

test('packs the whole workspace root without needing export.include', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  mkdirSync(join(root, 'assets', 'fonts'), { recursive: true })
  writeFileSync(join(root, 'bin', 'runtime.dll'), 'dll')
  writeFileSync(join(root, 'bin', 'settings.ini'), 'key=value')
  writeFileSync(join(root, 'bin', 'notes.txt'), 'kept')
  writeFileSync(join(root, 'assets', 'fonts', 'ui.ttf'), 'font')

  const plan = buildScriptExportPlan(makeScript(root, 'executable'), makeManifest())

  assert.deepEqual(plan.files, [
    'assets/fonts/ui.ttf',
    'autoforge.json',
    'bin/notes.txt',
    'bin/runtime.dll',
    'bin/settings.ini',
    'bin/tool.exe',
    'README.md'
  ])
  assert.equal(plan.defaultFileName, 'Tool-1.0.0.zip')
})

test('packs file types that the source whitelist would reject', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  writeFileSync(join(root, 'config.json'), '{"port":8080}')
  writeFileSync(join(root, 'seed.db'), 'sqlite')
  writeFileSync(join(root, 'report.xlsx'), 'sheet')
  writeFileSync(join(root, 'bundled.zip'), 'archive')
  writeFileSync(join(root, 'run.log'), 'log')
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist', 'payload.bin'), 'payload')

  const plan = buildScriptExportPlan(makeScript(root, 'executable'), makeManifest())

  for (const file of [
    'config.json',
    'seed.db',
    'report.xlsx',
    'bundled.zip',
    'run.log',
    'dist/payload.bin'
  ]) {
    assert.equal(plan.files.includes(file), true, `缺少 ${file}`)
  }
})

test('excludes dependency directories, caches, secrets and .env from the root', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  mkdirSync(join(root, 'node_modules', 'left-pad'), { recursive: true })
  mkdirSync(join(root, '.venv'), { recursive: true })
  mkdirSync(join(root, '.git'), { recursive: true })
  mkdirSync(join(root, '__pycache__'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'left-pad', 'index.js'), 'x')
  writeFileSync(join(root, '.venv', 'pyvenv.cfg'), 'x')
  writeFileSync(join(root, '.git', 'HEAD'), 'x')
  writeFileSync(join(root, '__pycache__', 'cached.pyc'), 'x')
  writeFileSync(join(root, '.env'), 'TOKEN=1')
  writeFileSync(join(root, '.env.local'), 'TOKEN=2')
  writeFileSync(join(root, 'signing.key'), 'secret')
  writeFileSync(join(root, 'server.pem'), 'secret')
  writeFileSync(join(root, 'client.pfx'), 'secret')

  const plan = buildScriptExportPlan(makeScript(root, 'executable'), makeManifest())

  assert.deepEqual(plan.files, ['autoforge.json', 'bin/tool.exe', 'README.md'])
})

test('writes a re-importable archive with the binary entry intact', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  const binary = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x00, 0xff, 0xfe, 0x00])
  writeFileSync(join(root, 'bin', 'tool.exe'), binary)
  writeFileSync(join(root, 'bin', 'runtime.dll'), 'dll')

  const script = makeScript(root, 'executable')
  const plan = buildScriptExportPlan(script, makeManifest())
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

test('rejects a native entry that is missing from the workspace', () => {
  const root = makeRoot()
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(join(root, 'autoforge.json'), '{}')

  assert.throws(
    () => buildScriptExportPlan(makeScript(root, 'executable'), makeManifest()),
    /导出文件不存在: bin\/tool\.exe/
  )
})

test('rejects a native entry that lives in an excluded directory', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'tool.exe'), 'MZ')

  const manifest = { ...makeManifest(), entry: 'node_modules/tool.exe' }
  assert.throws(
    () => buildScriptExportPlan(makeScript(root, 'executable'), manifest),
    /导出规则禁止包含文件/
  )
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

test('ignores export.include for native packages instead of failing on it', () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  writeFileSync(join(root, 'bin', 'signing.key'), 'secret')

  const plan = buildScriptExportPlan(
    makeScript(root, 'executable'),
    makeManifest(['bin/*.key', 'nothing/matches/here/*.dll', '../outside.dll'])
  )

  assert.deepEqual(plan.files, ['autoforge.json', 'bin/tool.exe', 'README.md'])
})

test('rejects a symlink anywhere under a native package', { skip: process.platform === 'win32' }, () => {
  const root = makeRoot()
  seedExecutablePackage(root)
  writeFileSync(join(root, 'bin', 'real.dll'), 'dll')
  symlinkSync(join(root, 'bin', 'real.dll'), join(root, 'bin', 'linked.dll'))

  assert.throws(
    () => buildScriptExportPlan(makeScript(root, 'executable'), makeManifest()),
    /导出不允许符号链接/
  )
})

test('still rejects an escaping export.include pattern for source packages', () => {
  const root = makeRoot()
  writeFileSync(join(root, 'autoforge.json'), '{}')
  writeFileSync(join(root, 'index.mjs'), 'export function run() {}\n')

  assert.throws(
    () => buildScriptExportPlan(
      { language: 'javascript', workspacePath: root, entry: 'index.mjs', version: '1.0.0' } as ScriptMeta,
      {
        autoforge: '1.0',
        name: 'Tool',
        version: '1.0.0',
        entry: 'index.mjs',
        language: 'javascript',
        export: { include: ['../outside.mjs'] }
      }
    ),
    /非法导出路径/
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
