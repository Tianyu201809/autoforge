import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import AdmZip from 'adm-zip'
import { createStoreZip } from './store-zip'

describe('createStoreZip', () => {
  it('packs skill files into a folder that unzips as UTF-8', () => {
    const bytes = createStoreZip([
      { name: 'autoforge-script-create/SKILL.md', content: '---\nname: demo\n---\n# 技能' },
      { name: 'autoforge-script-create/reference.md', content: '契约' }
    ])
    const zip = new AdmZip(Buffer.from(bytes))
    const names = zip.getEntries().map((entry) => entry.entryName).sort()
    assert.deepEqual(names, [
      'autoforge-script-create/SKILL.md',
      'autoforge-script-create/reference.md'
    ])
    assert.equal(zip.readAsText('autoforge-script-create/SKILL.md'), '---\nname: demo\n---\n# 技能')
  })
})
