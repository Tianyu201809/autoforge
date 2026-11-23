import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { closeDatabase, initDatabase } from '../db/database'
import { ScriptRegistry } from './script-registry'
import { ScriptStore } from './script-store'
import { ScriptWorkspace } from './script-workspace'
import { createProjectBuilder } from './ai/project-builder'
import { createProjectChecks } from './ai/project-checks'

function writePackage(root: string, entry: string, content: string, version: string): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'autoforge.json'), JSON.stringify({
    autoforge: '1.0', name: 'Project Script', version, entry, language: 'javascript'
  }))
  writeFileSync(join(root, entry), content)
}

test('imports a project, updates it in place, and restores the prior script after a failed update', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-project-import-'))
  const userData = join(root, 'data')
  const source = join(root, 'source')
  const update = join(root, 'update')
  const invalid = join(root, 'invalid')
  t.after(() => {
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  })

  await initDatabase(userData)
  const store = new ScriptStore()
  const workspace = new ScriptWorkspace(() => userData)
  const registry = new ScriptRegistry(store, workspace)
  const builtSource = join(root, 'built-project')
  mkdirSync(builtSource)
  writeFileSync(join(builtSource, 'autoforge.json'), JSON.stringify({
    autoforge: '1.0', name: 'Built Project', version: '1.0.0', entry: 'dist/index.mjs', language: 'javascript'
  }))
  writeFileSync(join(builtSource, 'package.json'), JSON.stringify({ scripts: { build: 'node build.cjs' } }))
  writeFileSync(join(builtSource, 'build.cjs'), "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.mjs','export function run() { return 42 }')")
  const checks = createProjectChecks()
  assert.notEqual((await checks.checkScriptPackage(builtSource)).status, 'passed')
  assert.equal((await createProjectBuilder()(builtSource)).status, 'passed')
  assert.equal((await checks.checkScriptPackage(builtSource)).status, 'passed')
  assert.equal((await checks.checkScriptSyntax(builtSource, workspace.validatePackageDirectory(builtSource))).status, 'passed')
  const built = registry.importFromPath(builtSource)
  assert.equal(readFileSync(join(built.workspacePath, 'dist/index.mjs'), 'utf8'), 'export function run() { return 42 }')

  writePackage(source, 'index.mjs', 'export const version = 1', '1.0.0')
  const imported = registry.importFromPath(source)
  store.setPreference(imported.id, {
    starred: true,
    defaultEnvId: 'default',
    configByEnv: { default: { API_TOKEN: 'kept' } },
    paramsByEnv: { default: { query: 'preserved' } }
  })

  writePackage(update, 'index.mjs', 'export const version = 2', '2.0.0')
  const updated = registry.updateFromProject(imported.id, update)
  assert.equal(updated.id, imported.id)
  assert.equal(updated.workspacePath, imported.workspacePath)
  assert.equal(updated.hubScriptId, undefined)
  assert.equal(updated.starred, true)
  assert.equal(updated.defaultEnvId, 'default')
  assert.deepEqual(updated.configByEnv, { default: { API_TOKEN: 'kept' } })
  assert.deepEqual(updated.paramsByEnv, { default: { query: 'preserved' } })
  assert.equal(readFileSync(join(updated.workspacePath, 'index.mjs'), 'utf8'), 'export const version = 2')

  mkdirSync(invalid, { recursive: true })
  writeFileSync(join(invalid, 'autoforge.json'), JSON.stringify({
    autoforge: '1.0', name: 'Project Script', version: '3.0.0', entry: 'missing.mjs', language: 'javascript'
  }))
  assert.throws(() => registry.updateFromProject(imported.id, invalid), /入口文件不存在/)
  assert.equal(readFileSync(join(updated.workspacePath, 'index.mjs'), 'utf8'), 'export const version = 2')
  assert.equal(registry.getById(imported.id)?.version, '2.0.0')

  const outside = join(root, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'sentinel.txt'), 'outside')
  const linkedPackage = join(root, 'linked-package')
  writePackage(linkedPackage, 'index.mjs', 'export const version = 3', '3.0.0')
  symlinkSync(outside, join(linkedPackage, 'linked-dir'), 'junction')
  assert.throws(() => registry.updateFromProject(imported.id, linkedPackage), /符号链接/)
  assert.equal(readFileSync(join(updated.workspacePath, 'index.mjs'), 'utf8'), 'export const version = 2')
})
