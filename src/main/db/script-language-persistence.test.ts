import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { resolveScriptLanguage, scriptLanguageBadge } from '../../shared/script-language'
import { closeDatabase, getDb, initDatabase } from './database'
import { createRepositories } from './repositories'

const roots: string[] = []

afterEach(() => {
  closeDatabase()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
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
    id: 'native-1',
    name: 'Tool',
    description: '',
    workspacePath: join(root, 'tool'),
    category: 'local',
    categoryLabel: '本地',
    categoryColor: '',
    icon: 'terminal',
    iconColor: '',
    iconBg: '',
    iconBorder: '',
    version: '1.0.0',
    entry: 'bin/tool',
    language: 'executable',
    envSchema: [],
    paramSchema: []
  })

  assert.equal(repos.scripts.getById('native-1')?.language, 'executable')
})
