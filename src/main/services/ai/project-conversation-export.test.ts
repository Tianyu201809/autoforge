import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AiProject, AiProjectTurn } from '../../../shared/ai-workspace-types'
import { createProjectConversationExport } from './project-conversation-export'

test('exports project identity and all conversation turn metadata without folder paths', () => {
  const project: AiProject = {
    id: 'project-1', name: 'Research', rootPath: 'C:/private/research', language: 'python', profileId: 'profile-secret',
    pinned: true, status: 'ready', createdAt: 'created', updatedAt: 'updated'
  }
  const turns: AiProjectTurn[] = [{
    id: 'turn-1', projectId: project.id, role: 'assistant', content: 'Done', status: 'complete',
    changes: [{ path: 'main.py' }], checks: [{ code: 'syntax_valid', status: 'passed' }], importedScriptId: 'script-1', createdAt: 'turn-created'
  }]

  const exported = createProjectConversationExport(project, turns, () => 'exported')

  assert.equal(exported.format, 'autoforge-ai-conversation')
  assert.equal(exported.project.name, 'Research')
  assert.equal('rootPath' in exported.project, false)
  assert.equal('profileId' in exported.project, false)
  assert.deepEqual(exported.turns, turns)
  assert.equal(exported.exportedAt, 'exported')
})
