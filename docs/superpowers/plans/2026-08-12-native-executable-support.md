# Native Executable Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Autoforge discover, import, authorize, launch, monitor, and stop Windows PE, macOS Mach-O, and Linux ELF programs while retaining the existing `autoforge.json` package model.

**Architecture:** Add `executable` as a persisted script language, with pure binary inspection and package discovery modules feeding the workspace import layer. A main-process trust service gates a dedicated child-process runner; existing `ScriptRunnerService` owns the shared session lifecycle, while local import uses a two-phase inspect/select/import IPC contract and Hub installation remains non-interactive.

**Tech Stack:** Electron 34, Node.js child processes and crypto, TypeScript 5.8, Vue 3, sql.js SQLite migrations, AdmZip, Node test runner with `tsx`.

## Global Constraints

- Keep `autoforge` manifest version at exactly `"1.0"` and keep `entry` a single relative string.
- Support file-form PE, Mach-O (including fat/universal), and ELF executables; do not support macOS `.app` directories.
- Never identify native executables by extension alone; verify binary headers during import and every run.
- One package targets one operating system; reject an entry whose detected OS differs from `process.platform`.
- Do not preflight CPU architecture compatibility; preserve the operating system launch error.
- Exclude PE DLL, Mach-O dylib, ELF shared-library-only files, symlinks, devices, and non-regular files from discovery.
- Native manifests must not declare `dependencies`; do not install native libraries or runtimes.
- Pass values through environment variables only; do not synthesize command-line arguments.
- Launch with `shell: false`, `cwd` equal to the script workspace, and no detached user process.
- Require SHA-256 authorization on first run and whenever entry bytes change; Hub installation never grants trust.
- Only a main-window single manual run is interactive. Batch, schedule, and MCP starts are non-interactive.
- On Unix, add only the current-user execute bit after authorization and before launch.
- Native packages may be imported from files, directories, local ZIP, and Hub ZIP, but cannot be exported by Autoforge.
- Preserve JavaScript and Python manifest parsing, dependency installation, execution, editing, and ZIP export behavior.

---

### Task 1: Executable Language Contract and Database Persistence

**Files:**
- Modify: `src/shared/script-language.ts`
- Modify: `src/shared/script-contract.ts`
- Modify: `src/shared/types/script.ts`
- Create: `src/main/db/migrations/006-script-language-executable-trust.ts`
- Modify: `src/main/db/database.ts`
- Modify: `src/main/db/row-mappers.ts`
- Modify: `src/main/db/repositories/script-repository.ts`
- Create: `src/main/db/script-language-persistence.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ScriptLanguage = 'javascript' | 'python' | 'executable'`.
- Produces: `inferScriptLanguageFromExtension(entry): 'javascript' | 'python' | undefined` and `resolveScriptLanguage(manifestLanguage, entry): ScriptLanguage` with the legacy JavaScript fallback.
- Produces: lifecycle phase `'awaiting-confirmation'`.
- Produces: SQLite v6 columns/table: `scripts.language` and `executable_trust`.
- Consumes: existing `ScriptManifest`, `ScriptMeta`, and sql.js migration conventions.

- [ ] **Step 1: Write failing language and persistence tests**

Create `src/main/db/script-language-persistence.test.ts` and extend shared language coverage in the same file:

```ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { closeDatabase, getDb, initDatabase } from './database'
import { createRepositories } from './repositories'
import { resolveScriptLanguage, scriptLanguageBadge } from '../../shared/script-language'

const roots: string[] = []
afterEach(() => {
  closeDatabase()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('executable is a first-class language with an EXE badge', () => {
  assert.equal(resolveScriptLanguage('executable', 'tool'), 'executable')
  assert.deepEqual(scriptLanguageBadge('executable'), {
    label: 'EXE',
    className: 'text-emerald-400/90 border-emerald-500/25 bg-emerald-500/10'
  })
})

test('database persists executable language for extensionless entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-language-'))
  roots.push(root)
  await initDatabase(root)
  const repos = createRepositories(getDb())
  repos.scripts.insert({
    id: 'native-1', name: 'Tool', description: '', workspacePath: join(root, 'tool'),
    category: 'local', categoryLabel: '本地', categoryColor: '', icon: 'terminal',
    iconColor: '', iconBg: '', iconBorder: '', version: '1.0.0', entry: 'bin/tool',
    language: 'executable', envSchema: [], paramSchema: []
  })
  assert.equal(repos.scripts.getById('native-1')?.language, 'executable')
})
```

Add `src/main/db/script-language-persistence.test.ts` to `test:unit` in `package.json`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --import tsx --test src/main/db/script-language-persistence.test.ts
```

Expected: FAIL because `executable` is not assignable to `ScriptLanguage` and the database has no `language` column.

- [ ] **Step 3: Extend shared contracts without performing filesystem I/O**

In `src/shared/script-language.ts`, use explicit type resolution and add the badge:

```ts
export type ScriptLanguage = 'javascript' | 'python' | 'executable'

export function resolveScriptLanguage(
  manifestLanguage?: ScriptLanguage | string,
  entry?: string
): ScriptLanguage {
  if (manifestLanguage === 'javascript' || manifestLanguage === 'python' || manifestLanguage === 'executable') {
    return manifestLanguage
  }
  const extension = entry?.slice(entry.lastIndexOf('.')).toLowerCase()
  if (extension && PY_EXTENSIONS.has(extension)) return 'python'
  return 'javascript'
}

export function scriptLanguageBadge(language: ScriptLanguage): ScriptLanguageBadge {
  if (language === 'python') return { label: 'Py', className: 'text-sky-400/90 border-sky-500/25 bg-sky-500/10' }
  if (language === 'executable') return { label: 'EXE', className: 'text-emerald-400/90 border-emerald-500/25 bg-emerald-500/10' }
  return { label: 'JS', className: 'text-amber-400/90 border-amber-500/25 bg-amber-500/10' }
}
```

In `validateManifest`, accept `obj.language === 'executable'`. Change `ScriptManifest.language` to `ScriptLanguage | undefined`, and preserve `undefined` when JSON omitted `language`; do not call the JavaScript-defaulting resolver inside this pure JSON function. Do not read entry bytes here. Reject native dependencies after normalization:

```ts
if (manifest.language === 'executable' && Object.keys(manifest.dependencies ?? {}).length > 0) {
  return { ok: false, error: '可执行程序不能声明 dependencies' }
}
```

Add `'awaiting-confirmation'` to `ScriptLifecyclePhase`, and update comments in `src/shared/types/script.ts` from “JS / Python” to “JavaScript / Python / executable”.

- [ ] **Step 4: Add migration v6 and persist language**

Create `src/main/db/migrations/006-script-language-executable-trust.ts`:

```ts
export const MIGRATION_006 = `
ALTER TABLE scripts ADD COLUMN language TEXT NOT NULL DEFAULT 'javascript';
CREATE TABLE IF NOT EXISTS executable_trust (
  script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  entry TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  trusted_at TEXT NOT NULL,
  PRIMARY KEY (script_id, entry, sha256)
);
CREATE INDEX IF NOT EXISTS idx_executable_trust_script ON executable_trust(script_id);
`
```

Register it in `database.ts`, guard the `language` column as existing migrations do, backfill `.py` entries to `python` only when the v6 column is first added, and record schema version 6:

```ts
function ensureScriptLanguageSchema(database: SqliteDatabase): void {
  if (!tableHasColumn(database, 'scripts', 'language')) {
    database.exec(MIGRATION_006)
    database.prepare("UPDATE scripts SET language = 'python' WHERE lower(entry) LIKE '%.py'").run()
  } else database.exec(`CREATE TABLE IF NOT EXISTS executable_trust (
    script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
    entry TEXT NOT NULL, sha256 TEXT NOT NULL, trusted_at TEXT NOT NULL,
    PRIMARY KEY (script_id, entry, sha256)
  ); CREATE INDEX IF NOT EXISTS idx_executable_trust_script ON executable_trust(script_id);`)
}
```

Add `language` and `executable_trust` to `MIGRATION_001` too, so fresh and upgraded databases converge without repeated ALTER statements.

Add `language` to `ScriptRow`, `SCRIPT_JOIN`, all insert/update column lists, `rowToScriptBase`, and `scriptMetaToScriptRow`. Read only the three accepted values and fall back through `resolveScriptLanguage(undefined, row.entry)` for legacy/corrupt rows.

- [ ] **Step 5: Run focused tests, typecheck build, and unit suite**

Run:

```powershell
node --import tsx --test src/main/db/script-language-persistence.test.ts
npm run build
npm run test:unit
```

Expected: focused tests PASS; Electron Vite build completes; all existing unit tests PASS.

- [ ] **Step 6: Commit the language and schema foundation**

```powershell
git add -- src/shared/script-language.ts src/shared/script-contract.ts src/shared/types/script.ts src/main/db/migrations/006-script-language-executable-trust.ts src/main/db/database.ts src/main/db/row-mappers.ts src/main/db/repositories/script-repository.ts src/main/db/script-language-persistence.test.ts package.json
git commit -m "feat: persist executable script language"
```

### Task 2: PE, Mach-O, and ELF Inspection

**Files:**
- Create: `src/main/services/executable-inspector.ts`
- Create: `src/main/services/executable-inspector.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ExecutableFormat = 'pe' | 'mach-o' | 'elf'`.
- Produces: `ExecutablePlatform = 'win32' | 'darwin' | 'linux'`.
- Produces: `inspectExecutable(path): ExecutableInspection | null`.
- Produces: `assertRunnableExecutable(path, platform?): ExecutableInspection`.
- `ExecutableInspection` is `{ format, platform, kind: 'executable' | 'library', architectures: string[] }`.
- Consumes: regular-file paths only; callers remain responsible for workspace-boundary checks.

- [ ] **Step 1: Write failing binary fixture tests**

Create compact in-test fixture builders in `src/main/services/executable-inspector.test.ts`:

```ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { inspectExecutable } from './executable-inspector'

const root = mkdtempSync(join(tmpdir(), 'autoforge-inspector-'))
after(() => rmSync(root, { recursive: true, force: true }))
const fixture = (name: string, bytes: Buffer): string => { const path = join(root, name); writeFileSync(path, bytes); return path }

function pe(characteristics = 0x0002): Buffer {
  const value = Buffer.alloc(512)
  value.write('MZ'); value.writeUInt32LE(0x80, 0x3c); value.write('PE\0\0', 0x80, 'binary')
  value.writeUInt16LE(0x8664, 0x84); value.writeUInt16LE(characteristics, 0x96)
  return value
}
function elf(type = 2): Buffer {
  const value = Buffer.alloc(64)
  value.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); value.writeUInt16LE(type, 16)
  return value
}
function macho(fileType = 2): Buffer {
  const value = Buffer.alloc(32)
  value.writeUInt32LE(0xfeedfacf, 0); value.writeInt32LE(0x01000007, 4); value.writeUInt32LE(fileType, 12)
  return value
}

test('recognizes PE executable and excludes DLL', () => {
  assert.deepEqual(inspectExecutable(fixture('tool.exe', pe()))?.kind, 'executable')
  assert.deepEqual(inspectExecutable(fixture('tool.dll', pe(0x2002)))?.kind, 'library')
})
test('recognizes ELF executable and excludes plain shared object', () => {
  assert.equal(inspectExecutable(fixture('tool', elf(2)))?.kind, 'executable')
  assert.equal(inspectExecutable(fixture('lib.so', elf(3)))?.kind, 'library')
})
test('recognizes Mach-O executable and dylib', () => {
  assert.equal(inspectExecutable(fixture('tool-mac', macho(2)))?.kind, 'executable')
  assert.equal(inspectExecutable(fixture('lib.dylib', macho(6)))?.kind, 'library')
})
test('returns null for text and truncated files', () => {
  assert.equal(inspectExecutable(fixture('note.txt', Buffer.from('hello'))), null)
  assert.equal(inspectExecutable(fixture('mz', Buffer.from('MZ'))), null)
})
```

Add focused tests for a big-endian Mach-O header and a fat header containing one executable slice. Add the test file to `test:unit`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --import tsx --test src/main/services/executable-inspector.test.ts
```

Expected: FAIL with `Cannot find module './executable-inspector'`.

- [ ] **Step 3: Implement bounded parsers**

Create `executable-inspector.ts` with these public types and entry points:

```ts
export type ExecutableFormat = 'pe' | 'mach-o' | 'elf'
export type ExecutablePlatform = 'win32' | 'darwin' | 'linux'
export interface ExecutableInspection {
  format: ExecutableFormat
  platform: ExecutablePlatform
  kind: 'executable' | 'library'
  architectures: string[]
}

export function inspectExecutable(filePath: string): ExecutableInspection | null {
  const stat = lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) return null
  const fd = openSync(filePath, 'r')
  try {
    const header = Buffer.alloc(Math.min(stat.size, 64 * 1024))
    readSync(fd, header, 0, header.length, 0)
    return inspectPe(header) ?? inspectMachO(header) ?? inspectElf(header)
  } finally { closeSync(fd) }
}

export function assertRunnableExecutable(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): ExecutableInspection {
  const inspection = inspectExecutable(filePath)
  if (!inspection || inspection.kind !== 'executable') throw new Error('入口不是有效的 PE、Mach-O 或 ELF 可执行程序')
  if (inspection.platform !== platform) throw new Error(`入口目标平台为 ${inspection.platform}，当前平台为 ${platform}`)
  return inspection
}
```

Implement PE by validating DOS offset, `PE\0\0`, machine, and `IMAGE_FILE_DLL`; Mach-O by endian-aware magic/filetype parsing plus fat-slice bounds checks; ELF by magic/class/endian and `e_type`. Treat `ET_EXEC` as executable and `ET_DYN` as executable only when a bounded program-header scan finds `PT_INTERP`; otherwise classify it as a library.

- [ ] **Step 4: Run focused tests and malformed-input cases**

Run:

```powershell
node --import tsx --test src/main/services/executable-inspector.test.ts
npm run test:unit
```

Expected: all PE/Mach-O/ELF, library exclusion, fat header, endian, and truncation tests PASS; existing suite PASS.

- [ ] **Step 5: Commit binary inspection**

```powershell
git add -- src/main/services/executable-inspector.ts src/main/services/executable-inspector.test.ts package.json
git commit -m "feat: inspect native executable formats"
```

### Task 3: Manifest Resolution and Executable Package Discovery

**Files:**
- Create: `src/shared/executable-environment.ts`
- Create: `src/shared/executable-environment.test.ts`
- Create: `src/main/services/executable-package-discovery.ts`
- Create: `src/main/services/executable-package-discovery.test.ts`
- Modify: `src/main/services/script-workspace.ts`
- Create: `src/main/services/script-workspace-executable.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `inspectExecutable` and `assertRunnableExecutable` from Task 2.
- Produces: `ExecutableCandidate = { entry, format, platform, size }`.
- Produces: `discoverExecutableCandidates(root, platform?): ExecutableCandidate[]`.
- Produces: `createExecutableManifest(candidate): ScriptManifest`.
- Produces: `scriptWorkspace.resolveManifestLanguage(scriptDir, manifest): ScriptManifest`.
- Produces: `normalizeExecutableParamKey(key): string` and `assertExecutableParamKeys(params): void`.

- [ ] **Step 1: Write failing discovery and manifest-resolution tests**

Create tests that use Task 2 fixture builders or local copies of their minimal byte builders:

```ts
test('discovers only current-platform executables in stable relative-path order', () => {
  writeFileSync(join(root, 'b.exe'), pe())
  mkdirSync(join(root, 'bin')); writeFileSync(join(root, 'bin', 'a.exe'), pe())
  writeFileSync(join(root, 'helper.dll'), pe(0x2002))
  assert.deepEqual(discoverExecutableCandidates(root, 'win32').map((item) => item.entry), ['b.exe', 'bin/a.exe'])
})

test('generates a minimal parameterless manifest', () => {
  assert.deepEqual(createExecutableManifest({ entry: 'bin/tool.exe', format: 'pe', platform: 'win32', size: 512 }), {
    autoforge: '1.0', name: 'tool', version: '1.0.0', entry: 'bin/tool.exe',
    language: 'executable', env: [], params: []
  })
})

test('resolves an extensionless manifest entry to executable', () => {
  writeFileSync(join(root, 'tool'), elfExecutable())
  const resolved = scriptWorkspace.resolveManifestLanguage(root, {
    autoforge: '1.0', name: 'Tool', entry: 'tool'
  })
  assert.equal(resolved.language, 'executable')
})
```

Also test ignored directories, symlinks where supported, platform mismatch, `dependencies` rejection, explicit language/header conflict, and two parameters whose normalized executable environment keys collide. Put key-normalization tests in `src/shared/executable-environment.test.ts`. Add all three test files to `test:unit`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```powershell
node --import tsx --test src/shared/executable-environment.test.ts src/main/services/executable-package-discovery.test.ts src/main/services/script-workspace-executable.test.ts
```

Expected: FAIL because discovery and filesystem-backed language resolution do not exist.

- [ ] **Step 3: Implement deterministic discovery**

Create `executable-package-discovery.ts`:

```ts
export interface ExecutableCandidate {
  entry: string
  format: ExecutableFormat
  platform: ExecutablePlatform
  size: number
}

const IGNORED = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.cache'])

export function discoverExecutableCandidates(
  root: string,
  platform: NodeJS.Platform = process.platform
): ExecutableCandidate[] {
  const candidates: ExecutableCandidate[] = []
  walkRegularFiles(root, IGNORED, (absolutePath, relativePath, stat) => {
    const inspection = inspectExecutable(absolutePath)
    if (inspection?.kind === 'executable' && inspection.platform === platform) {
      candidates.push({ entry: relativePath.replace(/\\/g, '/'), format: inspection.format, platform: inspection.platform, size: stat.size })
    }
  })
  return candidates.sort((left, right) => left.entry.localeCompare(right.entry, 'en'))
}

export function createExecutableManifest(candidate: ExecutableCandidate): ScriptManifest {
  const extension = extname(candidate.entry)
  return {
    autoforge: AUTOFORGE_MANIFEST_VERSION,
    name: basename(candidate.entry, extension),
    version: '1.0.0', entry: candidate.entry, language: 'executable', env: [], params: []
  }
}
```

Use `lstatSync`, never follow symlinks, and enforce a discovery ceiling of the existing 2,000 ZIP-entry limit for predictable work. In tests, skip only the symlink assertion when Windows privileges prevent creating a symlink; never weaken production rejection.

Create the shared parameter-key contract before workspace validation:

```ts
export function normalizeExecutableParamKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

export function assertExecutableParamKeys(params: Array<{ key: string }>): void {
  const seen = new Map<string, string>()
  for (const item of params) {
    const normalized = normalizeExecutableParamKey(item.key)
    const previous = seen.get(normalized)
    if (previous) throw new Error(`参数环境变量冲突: ${previous} 与 ${item.key}`)
    seen.set(normalized, item.key)
  }
}
```

- [ ] **Step 4: Resolve manifest language in the workspace layer**

Add `resolveManifestLanguage` to `ScriptWorkspace`. It must resolve the safe entry path, validate explicit `executable`, inspect unknown/no-extension entries before JS fallback, and return a new manifest object:

```ts
resolveManifestLanguage(scriptDir: string, manifest: ScriptManifest): ScriptManifest {
  const entry = manifest.entry ?? 'index.mjs'
  const entryPath = resolveSafeWorkspaceFile(scriptDir, entry)
  if (manifest.language === 'executable') {
    assertRunnableExecutable(entryPath)
    return { ...manifest, language: 'executable' }
  }
  if (manifest.language === 'python' || manifest.language === 'javascript') {
    if (inspectExecutable(entryPath)?.kind === 'executable') throw new Error(`入口文件与 language: ${manifest.language} 冲突`)
    return manifest
  }
  const extensionLanguage = inferScriptLanguageFromExtension(entry)
  if (extensionLanguage) return { ...manifest, language: extensionLanguage }
  const inspection = inspectExecutable(entryPath)
  const language = inspection?.kind === 'executable' ? 'executable' : 'javascript'
  if (language === 'executable' && Object.keys(manifest.dependencies ?? {}).length > 0) {
    throw new Error('可执行程序不能声明 dependencies')
  }
  return { ...manifest, language }
}
```

Call this from `readManifest`, relaxed reads, package validation, manifest writes, and workspace refresh before producing `ScriptMeta`. For native manifests call `assertExecutableParamKeys(manifest.params ?? [])`.

- [ ] **Step 5: Run focused and regression tests**

Run:

```powershell
node --import tsx --test src/shared/executable-environment.test.ts src/main/services/executable-package-discovery.test.ts src/main/services/script-workspace-executable.test.ts
npm run build
npm run test:unit
```

Expected: discovery and manifest tests PASS; build and existing suite PASS.

- [ ] **Step 6: Commit discovery and resolution**

```powershell
git add -- src/shared/executable-environment.ts src/shared/executable-environment.test.ts src/main/services/executable-package-discovery.ts src/main/services/executable-package-discovery.test.ts src/main/services/script-workspace.ts src/main/services/script-workspace-executable.test.ts package.json
git commit -m "feat: discover executable package entries"
```

### Task 4: Safe ZIP Sources and Two-Phase Local Import

**Files:**
- Create: `src/main/services/safe-zip-package.ts`
- Create: `src/main/services/safe-zip-package.test.ts`
- Create: `src/main/services/script-import-source.ts`
- Create: `src/main/services/script-import-source.test.ts`
- Modify: `src/main/services/script-workspace.ts`
- Modify: `src/main/services/script-registry.ts`
- Modify: `src/shared/types/script.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ScriptImportInspection = { kind: 'ready'; candidate?: ExecutableCandidate } | { kind: 'select-executable'; candidates: ExecutableCandidate[] }`.
- Produces: `inspectScriptImport(sourcePath): ScriptImportInspection`.
- Produces: `scriptRegistry.importFromPath(sourcePath, { selectedEntry?, hubScriptId? }): ScriptMeta`.
- Produces IPC: `scripts.inspectImport(sourcePath)` and `scripts.import(sourcePath, selectedEntry?)`.
- Consumes: discovery from Task 3 and existing package-size limits: 50 MB ZIP, 100 MB extracted, 2,000 entries.

- [ ] **Step 1: Write failing ZIP/source tests**

Test the exact root and revalidation rules:

```ts
test('uses the only top-level directory as an unmanifested ZIP package root', () => {
  const zip = makeZip({ 'release/bin/tool.exe': pe() })
  const result = inspectScriptImport(zip, 'win32')
  assert.deepEqual(result, { kind: 'ready', candidate: { entry: 'bin/tool.exe', format: 'pe', platform: 'win32', size: 512 } })
})

test('returns choices without importing when multiple executables exist', () => {
  const result = inspectScriptImport(makeZip({ 'a.exe': pe(), 'b.exe': pe() }), 'win32')
  assert.equal(result.kind, 'select-executable')
  assert.deepEqual(result.candidates.map((item) => item.entry), ['a.exe', 'b.exe'])
})

test('rejects a selected entry that is absent on the second pass', () => {
  assert.throws(() => prepareSelectedImport(root, 'missing.exe', 'win32'), /候选入口已变化/)
})
```

Also test ZIP `..`, absolute/drive paths, expanded-size and entry-count limits, manifest-at-root, manifest-in-single-directory, no candidate, and source-file replacement between inspect/import. Add test files to `test:unit`.

Add regression cases asserting that standalone `.js`, `.mjs`, `.cjs`, and `.py` files still return `{ kind: 'ready' }` and use the existing quick-package import path rather than native discovery.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```powershell
node --import tsx --test src/main/services/safe-zip-package.test.ts src/main/services/script-import-source.test.ts
```

Expected: FAIL because the safe ZIP and import-source services do not exist.

- [ ] **Step 3: Extract reusable safe ZIP preparation**

Move Hub ZIP path and size validation into `safe-zip-package.ts` without changing constants:

```ts
export function extractZipSecurely(zipPath: string, extractDir: string): void
export function resolveZipPackageRoot(extractedDir: string): string
export function withExtractedZip<T>(zipPath: string, fn: (packageRoot: string) => T): T
```

`resolveZipPackageRoot` uses these exact rules: manifest at extraction root wins; otherwise a sole top-level directory is the root; otherwise extraction root is the no-manifest root. Do not accept a nested manifest when multiple top-level entries exist.

- [ ] **Step 4: Implement source inspection and selected-entry revalidation**

In `script-import-source.ts`, normalize directories, ZIP files, and single files behind one callback-scoped prepared source:

```ts
export function inspectScriptImport(sourcePath: string): ScriptImportInspection {
  return withPreparedImportSource(sourcePath, (source) => {
    if (source.hasManifest) return { kind: 'ready' }
    if (source.singleScriptLanguage === 'javascript' || source.singleScriptLanguage === 'python') {
      return { kind: 'ready' }
    }
    const candidates = source.singleFileCandidate
      ? [source.singleFileCandidate]
      : discoverExecutableCandidates(source.packageRoot)
    if (candidates.length === 0) throw new Error('未找到当前系统可运行的 PE、Mach-O 或 ELF 程序')
    return candidates.length === 1
      ? { kind: 'ready', candidate: candidates[0] }
      : { kind: 'select-executable', candidates }
  })
}
```

On import, rerun preparation and discovery. Preserve the existing standalone JavaScript/Python `importFromFile` behavior. For native sources, require `selectedEntry` to exactly match a current candidate when multiple exist. Copy into a staging workspace, generate the minimal manifest only inside staging, validate staging, then atomically activate it. Ensure every failure removes staging/temp directories.

- [ ] **Step 5: Add the two-phase IPC contract**

Add `SCRIPTS_INSPECT_IMPORT`. Expose:

```ts
inspectImport: (sourcePath: string): Promise<ScriptImportInspection> =>
  ipcRenderer.invoke(IPC.SCRIPTS_INSPECT_IMPORT, sourcePath),
import: (sourcePath: string, selectedEntry?: string): Promise<ScriptItem> =>
  ipcRenderer.invoke(IPC.SCRIPTS_IMPORT, sourcePath, selectedEntry),
```

The main handler calls inspection without mutation and passes the selected entry into the registry. Expand the open-file dialog to allow all files plus ZIP (`filters` may offer “支持的包” and “所有文件”), because extensionless Unix binaries cannot be represented by a filter whitelist.

- [ ] **Step 6: Run focused tests, build, and full unit suite**

Run:

```powershell
node --import tsx --test src/main/services/safe-zip-package.test.ts src/main/services/script-import-source.test.ts
npm run build
npm run test:unit
```

Expected: all import, ZIP security, cleanup, and second-pass validation tests PASS; build and regression suite PASS.

- [ ] **Step 7: Commit the import pipeline**

```powershell
git add -- src/main/services/safe-zip-package.ts src/main/services/safe-zip-package.test.ts src/main/services/script-import-source.ts src/main/services/script-import-source.test.ts src/main/services/script-workspace.ts src/main/services/script-registry.ts src/shared/types/script.ts src/shared/ipc-channels.ts src/main/ipc/handlers.ts src/preload/index.ts src/renderer/src/env.d.ts package.json
git commit -m "feat: import executable packages without manifests"
```

### Task 5: SHA-256 Trust Repository and Main-Process Authorization

**Files:**
- Create: `src/main/db/repositories/executable-trust-repository.ts`
- Modify: `src/main/db/repositories/index.ts`
- Create: `src/main/services/executable-trust.ts`
- Create: `src/main/services/executable-trust.test.ts`
- Modify: `src/main/services/script-registry.ts`
- Modify: `src/main/services/script-store.ts`
- Modify: `package.json`

**Interfaces:**
- Produces repository methods `has(scriptId, entry, sha256)`, `grant(...)`, and `deleteForScript(scriptId)`.
- Produces: `sha256File(filePath): string`.
- Produces: `assertExecutableAuthorizationCurrent(authorization): void`.
- Produces: `authorizeExecutableRun(input): Promise<ExecutableAuthorization>` and `ExecutableAuthorizationCancelledError`.
- Produces: `requireTrustedExecutable(script): ExecutableAuthorization` for synchronous/non-interactive preflight with no prompt or mutation.
- `ExecutableAuthorization` is `{ entryPath, entry, sha256, inspection }`.
- Consumes: injected `confirm(input): Promise<boolean>`, `interactive`, Task 2 inspection, and Task 1 v6 table.

- [ ] **Step 1: Write failing trust tests**

Create tests with an in-memory/fake repository and injected confirmation:

```ts
test('prompts once and reuses trust for unchanged bytes', async () => {
  let prompts = 0
  const service = createTrustService(fakeRepo(), async () => { prompts += 1; return true })
  await service.authorize({ script, interactive: true })
  await service.authorize({ script, interactive: true })
  assert.equal(prompts, 1)
})

test('requires a new confirmation after bytes change', async () => {
  await service.authorize({ script, interactive: true })
  appendFileSync(entryPath, Buffer.from([0]))
  await service.authorize({ script, interactive: true })
  assert.equal(prompts, 2)
})

test('rejects untrusted non-interactive runs', async () => {
  await assert.rejects(() => service.authorize({ script, interactive: false }), /需要先在 Autoforge 中手动确认运行/)
})

test('non-interactive preflight returns an existing authorization synchronously', () => {
  repo.grant(script.id, script.entry, sha256File(entryPath))
  assert.equal(service.requireTrusted(script).sha256, sha256File(entryPath))
})

test('does not grant when bytes change during confirmation', async () => {
  const service = createTrustService(repo, async () => { appendFileSync(entryPath, Buffer.from([1])); return true })
  await assert.rejects(() => service.authorize({ script, interactive: true }), /入口文件已变化/)
  assert.equal(repo.rows.length, 0)
})

test('uses a distinct cancellation error without granting trust', async () => {
  const service = createTrustService(repo, async () => false)
  await assert.rejects(() => service.authorize({ script, interactive: true }), ExecutableAuthorizationCancelledError)
  assert.equal(repo.rows.length, 0)
})
```

Add cancellation and deletion cleanup tests. Add the file to `test:unit`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```powershell
node --import tsx --test src/main/services/executable-trust.test.ts
```

Expected: FAIL because trust repository/service modules do not exist.

- [ ] **Step 3: Implement repository and hashing service**

Implement exact repository behavior:

```ts
has(scriptId: string, entry: string, sha256: string): boolean {
  return Boolean(this.db.prepare('SELECT 1 FROM executable_trust WHERE script_id = ? AND entry = ? AND sha256 = ?').get(scriptId, entry, sha256))
}
grant(scriptId: string, entry: string, sha256: string, trustedAt = new Date().toISOString()): void {
  this.db.prepare(`INSERT OR REPLACE INTO executable_trust (script_id, entry, sha256, trusted_at) VALUES (?, ?, ?, ?)`).run(scriptId, entry, sha256, trustedAt)
}
deleteForScript(scriptId: string): void {
  this.db.prepare('DELETE FROM executable_trust WHERE script_id = ?').run(scriptId)
}
```

Use bounded synchronous chunks with `createHash('sha256')` so `requireTrustedExecutable` can reject a start before a session is created. Both trust paths validate the safe, non-symlink workspace entry and format before hash lookup. The interactive path invokes confirmation, throws `ExecutableAuthorizationCancelledError` on cancellation, recomputes and compares the hash after confirmation, then grants. `assertExecutableAuthorizationCurrent` revalidates path/header/platform and compares the current hash to `authorization.sha256` immediately before spawn.

- [ ] **Step 4: Wire deletion cleanup**

Add the repository to `Repositories`. In `ScriptRegistry.delete`, call `scriptStore.deleteExecutableTrust(scriptId)` before deleting the script/workspace; keep this explicit even if SQLite foreign keys cascade.

- [ ] **Step 5: Run focused and database tests**

Run:

```powershell
node --import tsx --test src/main/services/executable-trust.test.ts src/main/db/script-language-persistence.test.ts
npm run test:unit
```

Expected: trust reuse/change/race/cancel/delete tests PASS; all unit tests PASS.

- [ ] **Step 6: Commit trust persistence**

```powershell
git add -- src/main/db/repositories/executable-trust-repository.ts src/main/db/repositories/index.ts src/main/services/executable-trust.ts src/main/services/executable-trust.test.ts src/main/services/script-registry.ts src/main/services/script-store.ts package.json
git commit -m "feat: authorize executable entry hashes"
```

### Task 6: Native Process Runner, Environment Contract, and Process-Tree Stop

**Files:**
- Modify: `src/shared/executable-environment.ts`
- Modify: `src/shared/executable-environment.test.ts`
- Create: `src/main/services/executable-script-runner.ts`
- Create: `src/main/services/executable-process.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildExecutableEnvironment(input): NodeJS.ProcessEnv`.
- Produces: `runExecutableScript(input, callbacks): Promise<ExecutableRunOutcome>`.
- Produces: `killExecutableProcess(child): void`.
- Consumes: `ExecutableAuthorization` from Task 5 and existing `LogLine` levels.

- [ ] **Step 1: Write failing environment tests**

```ts
test('injects env, normalized params, JSON, and reserved metadata', () => {
  const result = buildExecutableEnvironment({
    baseEnv: { PATH: 'keep' }, env: { API_URL: 'https://example.test' },
    params: { 'order-id': '42' }, sessionId: 's1', scriptId: 'x1', scriptDir: 'C:\\scripts\\x1'
  })
  assert.equal(result.PATH, 'keep')
  assert.equal(result.API_URL, 'https://example.test')
  assert.equal(result.AUTOFORGE_PARAM_ORDER_ID, '42')
  assert.equal(result.AUTOFORGE_PARAMS_JSON, '{"order-id":"42"}')
  assert.equal(result.AUTOFORGE_SESSION_ID, 's1')
})

test('rejects normalized parameter collisions', () => {
  assert.throws(() => buildExecutableEnvironment({ ...base, params: { 'a-b': '1', a_b: '2' } }), /参数环境变量冲突/)
})
```

Test that user `env` cannot override `AUTOFORGE_SESSION_ID`, `AUTOFORGE_SCRIPT_ID`, `AUTOFORGE_SCRIPT_DIR`, or `AUTOFORGE_PARAMS_JSON`.

- [ ] **Step 2: Write failing process tests using `process.execPath`**

Use Node itself as the controllable executable fixture; bypass format inspection because Task 6 tests only runner mechanics:

```ts
test('streams stdout and stderr and returns exit code zero', async () => {
  const logs: Array<[string, string]> = []
  const outcome = await runExecutableScript({
    entryPath: process.execPath,
    argsForTest: ['-e', "console.log('out'); console.error('err')"],
    cwd: root, env: process.env
  }, { log: (level, message) => logs.push([level, message]), onPid() {}, isAborted: () => false })
  assert.equal(outcome.ok, true)
  assert.deepEqual(logs, [['INFO', 'out'], ['ERROR', 'err']])
})

test('reports a non-zero exit', async () => {
  const outcome = await runExecutableScript(testInput(['-e', 'process.exit(7)']), callbacks)
  assert.deepEqual(outcome, { ok: false, exitCode: 7, errorMessage: '可执行程序退出码 7' })
})
```

Add tests for split UTF-8 chunks, no output, spawn error, abort, and a child process spawning a long-lived grandchild. Add both files to `test:unit`.

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```powershell
node --import tsx --test src/shared/executable-environment.test.ts src/main/services/executable-process.test.ts
```

Expected: FAIL because environment and executable runner modules do not exist.

- [ ] **Step 4: Implement the environment builder**

```ts
export function buildExecutableEnvironment(input: ExecutableEnvironmentInput): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = { ...input.baseEnv, ...input.env }
  const seen = new Map<string, string>()
  for (const [key, value] of Object.entries(input.params)) {
    const normalized = normalizeExecutableParamKey(key)
    const previous = seen.get(normalized)
    if (previous) throw new Error(`参数环境变量冲突: ${previous} 与 ${key}`)
    seen.set(normalized, key)
    output[`AUTOFORGE_PARAM_${normalized}`] = value
  }
  return Object.assign(output, {
    AUTOFORGE_PARAMS_JSON: JSON.stringify(input.params),
    AUTOFORGE_SESSION_ID: input.sessionId,
    AUTOFORGE_SCRIPT_ID: input.scriptId,
    AUTOFORGE_SCRIPT_DIR: input.scriptDir
  })
}
```

- [ ] **Step 5: Implement managed spawn and tree termination**

Use `StringDecoder('utf8')` per stream and flush remaining text on close. On Unix set `detached: true` only to create a process group while retaining pipes and parent ownership; never `unref()`. This creates a killable process group and is not fire-and-forget execution. Kill `-pid` with `SIGTERM`, then `SIGKILL` after two seconds. On Windows call hidden `taskkill /PID <pid> /T /F`. Store/cancel the escalation timer when the child closes.

Before Unix spawn, preserve the current mode and apply `chmodSync(entryPath, mode | 0o100)`. Return:

```ts
export interface ExecutableRunOutcome {
  ok: boolean
  exitCode?: number
  signal?: NodeJS.Signals
  errorMessage?: string
  aborted?: boolean
}
```

The production runner passes no arguments. Keep optional `argsForTest` internal/non-exported or explicitly marked test-only.

- [ ] **Step 6: Run focused process tests and check for leaked processes**

Run:

```powershell
node --import tsx --test src/shared/executable-environment.test.ts src/main/services/executable-process.test.ts
npm run test:unit
```

Expected: output/exit/abort/tree tests PASS and the test command exits normally with no child process left running.

- [ ] **Step 7: Commit native process execution**

```powershell
git add -- src/shared/executable-environment.ts src/shared/executable-environment.test.ts src/main/services/executable-script-runner.ts src/main/services/executable-process.test.ts package.json
git commit -m "feat: run and stop native executables"
```

### Task 7: ScriptRunner Authorization and Executable Lifecycle Integration

**Files:**
- Modify: `src/main/services/script-runner.ts`
- Modify: `src/main/services/runtime-container.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/services/autoforge-control-facade.ts`
- Create: `src/main/services/executable-runner-integration.test.ts`
- Modify: `src/shared/types/script.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Modify: `package.json`

**Interfaces:**
- Extends `StartOptions` with `interactive?: boolean`; default is `false` in the service.
- Main-window single-run IPC always overrides to `interactive: true`.
- Batch, scheduler, and MCP explicitly pass `interactive: false`.
- Consumes: Task 5 authorization and Task 6 managed runner.
- Produces executable lifecycle: `validating -> awaiting-confirmation -> starting -> running -> completed|failed|stopped`.

- [ ] **Step 1: Write failing runner integration tests with injected dependencies**

Refactor the service constructor to accept an options object so tests do not open Electron dialogs:

```ts
test('interactive executable start authorizes then reaches success', async () => {
  const runner = makeRunner({ authorize: async () => authorization, runExecutable: async (_input, callbacks) => {
    callbacks.onPid(1234); return { ok: true, exitCode: 0 }
  }})
  const session = await runner.start('native-1', undefined, {}, { interactive: true })
  await waitFor(() => runner.getSession(session.id)?.status === 'success')
  assert.equal(runner.getSession(session.id)?.exitCode, 0)
})

test('untrusted non-interactive executable produces a clear failed session', async () => {
  const runner = makeRunner({ requireTrusted: () => { throw new Error('需要先在 Autoforge 中手动确认运行') } })
  await assert.rejects(
    () => runner.start('native-1', undefined, {}, { interactive: false }),
    /需要先在 Autoforge 中手动确认运行/
  )
  assert.equal(runner.listSessions().length, 0)
})

test('stop terminates the executable child rather than Python helper only', async () => {
  const runner = makeRunnerWithHangingChild()
  const session = await runner.start('native-1', undefined, {}, { interactive: true })
  runner.stop(session.id)
  assert.equal(runner.getSession(session.id)?.status, 'stopped')
  assert.equal(killExecutableCalls, 1)
})
```

Add tests for a trusted non-interactive start, confirmation cancellation mapping to `stopped`, nonzero exit mapping to `error` plus `exitCode`, and timeout. Add the file to `test:unit`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --import tsx --test src/main/services/executable-runner-integration.test.ts
```

Expected: FAIL because `ScriptRunnerService` has no executable branch or injectable native dependencies.

- [ ] **Step 3: Add an executable active-session branch**

Before creating `RunSession`, preflight an executable request when `interactive !== true`:

```ts
const preauthorized = script.language === 'executable' && options?.interactive !== true
  ? this.executableTrust.requireTrusted(script)
  : undefined
```

This makes scheduler/MCP/batch callers receive an immediate rejection and avoids recording a run that never had permission to start. Carry `preauthorized` in `ActiveSession`. Then generalize `ActiveSession.childProcess` and stop dispatch:

```ts
if (active.executableChild) killExecutableProcess(active.executableChild)
else killPythonProcess(active.childProcess)
```

In `executePackage`, add the explicit branch before JavaScript fallback:

```ts
if (script.language === 'python') return this.executePythonPackage(...args)
if (script.language === 'executable') return this.executeExecutablePackage(...args)
return this.executeJsPackage(...args)
```

`executeExecutablePackage` must set phases, use `ActiveSession.preauthorized` for non-interactive starts or call interactive authorization, call `assertExecutableAuthorizationCurrent` immediately before spawning, build the environment, arm the existing timeout only after authorization, assign PID/child, stream logs, and call existing `completeSession`/`failSession`. Catch `ExecutableAuthorizationCancelledError` separately and call `stop(session.id)` without an error log; all other authorization errors fail the session. Store `outcome.exitCode` on the session before terminal history persistence.

- [ ] **Step 4: Centralize the main-process confirmation prompt**

In `runtime-container.ts`, construct the trust service with a confirmation callback using `dialog.showMessageBox(getWindow() ?? undefined, ...)`. The detail must include name, relative entry, source (`Autoforge Hub` when `hubScriptId` exists, otherwise `本地导入`) and full SHA-256. Buttons are `['信任并运行', '取消']`, with `cancelId: 1`, `noLink: true`, and warning type.

Pass `interactive: true` only in `IPC.RUNNER_START`; discard any renderer-supplied interactive flag. Pass `false` in `startBatch`, scheduler setup, and `ControlFacade.startScript`.

- [ ] **Step 5: Run integration, existing lifecycle, and full tests**

Run:

```powershell
node --import tsx --test src/main/services/executable-runner-integration.test.ts src/main/services/python-process-exit.test.mjs src/main/services/browser-lifecycle.test.mjs
npm run build
npm run test:unit
```

Expected: executable lifecycle tests PASS; Python/browser lifecycle regressions PASS; build and suite PASS.

- [ ] **Step 6: Commit runner integration**

```powershell
git add -- src/main/services/script-runner.ts src/main/services/runtime-container.ts src/main/ipc/handlers.ts src/main/services/autoforge-control-facade.ts src/main/services/executable-runner-integration.test.ts src/shared/types/script.ts src/preload/index.ts src/renderer/src/env.d.ts package.json
git commit -m "feat: integrate executable run lifecycle"
```

### Task 8: Entry Selection UI, Executable Badges, and Export Guard

**Files:**
- Create: `src/renderer/src/components/ExecutableEntryPickerModal.vue`
- Create: `src/renderer/src/components/ExecutableEntryPickerModal.test.mjs`
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/composables/useScriptStore.ts`
- Modify: `src/renderer/src/components/ScriptCard.vue`
- Create: `src/renderer/src/components/ScriptCardExecutable.test.mjs`
- Modify: `src/renderer/src/components/DetailPanel.vue`
- Modify: `src/renderer/src/components/DetailPanelHeader.test.mjs`
- Modify: `src/main/services/script-package-exporter.ts`
- Create: `src/main/services/script-package-exporter-executable.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 4 `inspectImport` and `ExecutableCandidate` types.
- Produces modal emits: `confirm(entry: string)` and `cancel`.
- Consumes: Task 1 `scriptLanguageBadge`.
- Enforces executable export rejection in `buildScriptExportPlan` before reading binary content.

- [ ] **Step 1: Write failing UI source-contract and export tests**

Follow existing component source-test style:

```js
test('entry picker renders radio candidates and emits the selected relative path', () => {
  const source = readFileSync(resolve('src/renderer/src/components/ExecutableEntryPickerModal.vue'), 'utf8')
  assert.match(source, /v-for="candidate in candidates"/)
  assert.match(source, /type="radio"/)
  assert.match(source, /candidate\.entry/)
  assert.match(source, /candidate\.format/)
  assert.match(source, /formatBytes\(candidate\.size\)/)
  assert.match(source, /emit\('confirm', selectedEntry\)/)
})
```

Create exporter test:

```ts
test('refuses executable package export before reading the entry', () => {
  assert.throws(() => buildScriptExportPlan(nativeScript, nativeManifest), /不支持导出原生程序包/)
})
```

Extend badge header tests to require the three-way title helper rather than a Python ternary. Add new files to `test:unit`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```powershell
node --import tsx --test src/renderer/src/components/ExecutableEntryPickerModal.test.mjs src/main/services/script-package-exporter-executable.test.ts src/renderer/src/components/DetailPanelHeader.test.mjs
```

Expected: FAIL because the modal/export guard/three-way titles do not exist.

- [ ] **Step 3: Build the import picker and two-phase store flow**

`ExecutableEntryPickerModal.vue` accepts `open` and `candidates`, keeps a stable selected relative entry, and uses a compact modal with radio controls. Disable confirmation until selected. Do not nest cards; render a simple bordered list.

In `useScriptStore.ts`:

```ts
async function importFromPath(sourcePath: string): Promise<void> {
  const inspection = await window.autoforge.scripts.inspectImport(sourcePath)
  const selectedEntry = inspection.kind === 'select-executable'
    ? await chooseExecutableEntry(inspection.candidates)
    : inspection.candidate?.entry
  if (inspection.kind === 'select-executable' && !selectedEntry) return
  await window.autoforge.scripts.import(sourcePath, selectedEntry)
  await refresh()
}
```

Expose the pending chooser state to `App.vue`, mount the modal once, and resolve/cancel its promise without leaving stale state.

- [ ] **Step 4: Add executable-specific UI branches**

Add a shared `scriptLanguageTitle(language)` helper returning `JavaScript 脚本`, `Python 脚本`, or `可执行程序`. Use it in card and detail badges.

In `ScriptCard.vue`, disable the export button for executable scripts, set `title="原生程序包暂不支持导出"`, and never call preview/export. In `DetailPanel.vue`, hide dependency install and browser-headless controls when `script.language === 'executable'`; retain env/params configuration because native manifests may declare them. Existing binary editor detection keeps the entry read-only. In `App.vue`, skip the existing generic “运行脚本” confirmation for executable scripts because the main-process SHA-256 warning is the required confirmation; retain the generic confirmation for JavaScript/Python.

- [ ] **Step 5: Add the main-process export guard**

At the start of `buildScriptExportPlan`:

```ts
if (script.language === 'executable' || manifest.language === 'executable') {
  throw new Error('不支持导出原生程序包')
}
```

This protects both preview and export IPC handlers.

- [ ] **Step 6: Run UI contract tests, build, and full suite**

Run:

```powershell
node --import tsx --test src/renderer/src/components/ExecutableEntryPickerModal.test.mjs src/main/services/script-package-exporter-executable.test.ts src/renderer/src/components/DetailPanelHeader.test.mjs src/renderer/src/components/ScriptCardExecutable.test.mjs
npm run build
npm run test:unit
```

Expected: picker/badge/export tests PASS; build and all tests PASS.

- [ ] **Step 7: Commit user-facing executable support**

```powershell
git add -- src/renderer/src/components/ExecutableEntryPickerModal.vue src/renderer/src/components/ExecutableEntryPickerModal.test.mjs src/renderer/src/App.vue src/renderer/src/composables/useScriptStore.ts src/renderer/src/components/ScriptCard.vue src/renderer/src/components/ScriptCardExecutable.test.mjs src/renderer/src/components/DetailPanel.vue src/renderer/src/components/DetailPanelHeader.test.mjs src/main/services/script-package-exporter.ts src/main/services/script-package-exporter-executable.test.ts package.json
git commit -m "feat: add executable import and status UI"
```

### Task 9: Hub Installation, MCP Behavior, Documentation, and End-to-End Verification

**Files:**
- Modify: `src/main/services/hub-script-installer.ts`
- Create: `src/main/services/hub-executable-install.test.ts`
- Modify: `src/main/services/autoforge-control-facade.ts`
- Modify: `src/main/services/mcp-control-server.test.ts`
- Modify: `docs/script-spec.md`
- Modify: `docs/architecture.md`
- Modify: `README.md`
- Modify: `skills/autoforge-script-create/SKILL.md`
- Modify: `skills/autoforge-script-create/reference.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: safe ZIP/source preparation from Task 4.
- Hub behavior: unique native candidate imports and generates a manifest; multiple candidates throw `HubInstallError('invalid_package', messageWithEntries)`.
- MCP behavior: untrusted executable starts return a terminal error session/message instructing manual confirmation; MCP cannot grant trust.
- Documents the final `language: executable`, environment contract, no-manifest generation, trust, and no-export rules.

- [ ] **Step 1: Write failing Hub and MCP behavior tests**

```ts
test('Hub installs a manifestless ZIP with one executable candidate', async () => {
  const result = await installFixtureHubZip({ 'tool.exe': pe() }, { platform: 'win32' })
  const manifest = JSON.parse(readFileSync(join(result.workspacePath, 'autoforge.json'), 'utf8'))
  assert.equal(manifest.language, 'executable')
  assert.equal(manifest.entry, 'tool.exe')
})

test('Hub rejects multiple candidates and lists their relative paths', async () => {
  await assert.rejects(
    () => installFixtureHubZip({ 'a.exe': pe(), 'bin/b.exe': pe() }, { platform: 'win32' }),
    (error) => error instanceof HubInstallError && error.code === 'invalid_package' && /a\.exe/.test(error.message) && /bin\/b\.exe/.test(error.message)
  )
})
```

Extend `mcp-control-server.test.ts` so an executable start cannot pass an authorization flag and returns the service's “手动确认” error until the repository already trusts the hash.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```powershell
node --import tsx --test src/main/services/hub-executable-install.test.ts src/main/services/mcp-control-server.test.ts
```

Expected: Hub no-manifest tests FAIL against the old manifest-only resolver; MCP executable trust behavior is not wired.

- [ ] **Step 3: Reuse safe source discovery in Hub installation**

Replace Hub-local extraction/root helpers with Task 4 functions. After download/extraction:

```ts
const inspection = inspectPreparedPackage(packageRoot)
if (inspection.kind === 'select-executable') {
  throw new HubInstallError('invalid_package', `检测到多个可执行程序，请补充 autoforge.json：${inspection.candidates.map((item) => item.entry).join(', ')}`)
}
const packageManifest = prepareHubPackageManifest(packageRoot, inspection.candidate)
```

Generate the manifest only in the temporary extracted package, then call the existing registry import/update path. Preserve duplicate Hub update prompts and all download/ZIP limits. An update to changed native bytes must not copy trust because trust is hash-specific.

- [ ] **Step 4: Lock down MCP and scheduled starts**

Ensure `ControlFacade.startScript` and runtime scheduler pass `{ interactive: false }`. Do not add `trust`, `confirmedExecutable`, or equivalent to MCP types/tools. Map the untrusted outcome to the existing validation/error response while retaining the actionable Chinese message.

- [ ] **Step 5: Update package specification, architecture, README, and bundled skill**

Document this minimal native example in `docs/script-spec.md` and the skill reference:

```json
{
  "autoforge": "1.0",
  "name": "本地工具",
  "version": "1.0.0",
  "entry": "bin/tool.exe",
  "language": "executable",
  "env": [],
  "params": []
}
```

State the exact injected variables, supported formats, single-platform/single-entry rule, no `.app`, no `dependencies`, no native ZIP export, no-manifest auto-generation, multi-candidate behavior, Unix permission repair, and SHA-256 confirmation. Update `docs/architecture.md` execution data flow and module table. Update `README.md` feature/language sections. Update `skills/autoforge-script-create/SKILL.md` and `reference.md` so generated packages may explicitly use `executable` but the skill does not claim to compile binaries.

- [ ] **Step 6: Run full automated verification**

Run:

```powershell
node --import tsx --test src/main/services/hub-executable-install.test.ts src/main/services/mcp-control-server.test.ts
npm run lint
npm run test:unit
npm run build
git diff --check
```

Expected: focused tests PASS; lint has zero errors; full unit suite PASS; production build completes; no whitespace errors.

- [ ] **Step 7: Perform current-platform manual smoke verification**

On Windows, copy a harmless console `.exe` fixture into a directory without `autoforge.json`; on macOS/Linux, compile or use a harmless current-platform CLI fixture with no extension and remove its user execute bit. Verify:

```text
1. Single candidate imports and creates autoforge.json with language executable.
2. Two candidates show a radio list and cancel leaves no script.
3. First run shows name, relative path, source, and SHA-256.
4. Cancel produces stopped; confirm streams logs and exits success.
5. Second unchanged run does not prompt.
6. Replacing entry bytes prompts again.
7. Stop/timeout removes child and grandchild processes.
8. Native export is disabled and main-process preview rejects direct invocation.
9. A JavaScript package and Python package still import, run, edit, and export.
```

Expected: all nine checks pass on the current OS. Record any unavailable cross-platform launch coverage as covered by static fixtures and CI, not as locally verified.

- [ ] **Step 8: Commit Hub, documentation, and final verification changes**

```powershell
git add -- src/main/services/hub-script-installer.ts src/main/services/hub-executable-install.test.ts src/main/services/autoforge-control-facade.ts src/main/services/mcp-control-server.test.ts docs/script-spec.md docs/architecture.md README.md skills/autoforge-script-create/SKILL.md skills/autoforge-script-create/reference.md package.json
git commit -m "docs: finalize executable package support"
```

## Final Acceptance

- [ ] A declared PE/Mach-O/ELF package imports and runs only on its matching OS.
- [ ] An undeclared executable entry is inferred by bytes, including extensionless Mach-O/ELF after restart.
- [ ] Manifestless file/directory/ZIP imports generate the exact minimal manifest; local multiple candidates require selection and Hub multiple candidates fail clearly.
- [ ] Environment and parameter values arrive under the documented variable names with collision protection.
- [ ] First run and changed bytes require main-process SHA-256 confirmation; non-interactive callers cannot grant trust.
- [ ] Exit zero, nonzero, spawn error, stop, timeout, stdout/stderr, and process-tree cleanup map to correct sessions/history.
- [ ] Unix execute permission repair happens only after authorization.
- [ ] Native ZIP export is blocked in both UI and main process.
- [ ] JavaScript and Python regression tests, lint, and production build pass.
