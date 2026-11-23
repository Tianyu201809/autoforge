import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAgentTools } from './agent-tools'

function createTools(fileContent = '', options?: { allowImport?: boolean }) {
  let writes = 0
  const tools = createAgentTools({
    workspace: {
      listProjectFiles: async () => [],
      readProjectFile: () => ({ path: 'index.mjs', content: fileContent, sha256: 'hash', size: fileContent.length, kind: 'text' as const }),
      applyProjectChanges: async () => {
        writes += 1
        return { applied: [], conflicts: [], rollbackFailed: [] }
      }
    },
    checks: {
      checkScriptPackage: async () => ({ status: 'passed' as const, code: 'package_valid', message: 'ok', diagnostics: [] }),
      checkScriptSyntax: async () => ({ status: 'passed' as const, code: 'syntax_valid', message: 'ok', diagnostics: [] })
    },
    importScript: async () => ({ scriptId: 'script-1', name: 'Script' })
  }, options)
  return { tools, getWrites: () => writes }
}

const project = {
  id: 'project-1',
  name: 'Demo',
  rootPath: 'C:/workspace',
  language: 'javascript' as const,
  profileId: 'profile-1',
  status: 'ready' as const,
  createdAt: '2026-11-22T00:00:00.000Z',
  updatedAt: '2026-11-22T00:00:00.000Z'
}

test('rejects agent tools that are not in the allowlist', async () => {
  const { tools } = createTools()
  await assert.rejects(() => tools.execute('run_command', '{}', project), /Agent 工具不允许/)
})

test('does not expose or execute script import when import is disabled', async () => {
  const { tools } = createTools('', { allowImport: false })
  assert.equal(tools.definitions.some((definition) => definition.name === 'import_script'), false)
  await assert.rejects(() => tools.execute('import_script', '{}', project), /Agent 工具不允许/)
})

test('rejects malformed write arguments before touching project files', async () => {
  const { tools, getWrites } = createTools()
  await assert.rejects(
    () => tools.execute('write_project_files', JSON.stringify({
      changes: [{ path: 'index.mjs', content: 'x' }],
      expectedHashes: {}
    }), project),
    /文件版本/
  )
  assert.equal(getWrites(), 0)
})

test('rejects malformed JSON tool arguments', async () => {
  const { tools, getWrites } = createTools()
  await assert.rejects(() => tools.execute('read_project_file', '{', project), /工具参数必须是有效 JSON/)
  assert.equal(getWrites(), 0)
})

test('rejects file contents that exceed the Agent context limit', async () => {
  const { tools } = createTools('x'.repeat(130_000))
  await assert.rejects(
    () => tools.execute('read_project_file', JSON.stringify({ path: 'large.md' }), project),
    /Agent 上下文限制/
  )
})
