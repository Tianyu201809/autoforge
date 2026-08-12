import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ScriptManifest } from '../../shared/script-contract'
import type { ScriptMeta } from '../../shared/types/script'
import { buildScriptExportPlan } from './script-package-exporter'

test('refuses executable package export before reading the entry', () => {
  const script = { language: 'executable', workspacePath: 'missing' } as ScriptMeta
  const manifest: ScriptManifest = {
    autoforge: '1.0', name: 'Tool', entry: 'missing.exe', language: 'executable'
  }
  assert.throws(() => buildScriptExportPlan(script, manifest), /不支持导出原生程序包/)
})
