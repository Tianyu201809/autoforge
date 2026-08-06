import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTOFORGE_TOOL_DEFINITIONS, successResult } from './tool-definitions'

test('MCP tool definitions expose the approved surface and confirmation schemas', () => {
  const names = AUTOFORGE_TOOL_DEFINITIONS.map((item) => item.name)
  assert.equal(new Set(names).size, names.length)
  assert.ok(names.includes('autoforge_list_scripts'))
  assert.ok(names.includes('autoforge_create_script'))
  for (const name of ['autoforge_create_script', 'autoforge_write_script_file', 'autoforge_delete_script', 'autoforge_set_script_env']) {
    const definition = AUTOFORGE_TOOL_DEFINITIONS.find((item) => item.name === name)
    assert.ok(definition)
    assert.ok(definition.schema.confirm)
    assert.equal(definition.schema.confirm.safeParse(true).success, true)
  }
})

test('MCP tool results wrap arrays in an object structuredContent payload', () => {
  const environments = [{ id: 'env-1', name: 'Development' }]
  const result = successResult(environments)

  assert.deepEqual(result.structuredContent, { value: environments })
  assert.deepEqual(JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : ''), {
    value: environments
  })
})
