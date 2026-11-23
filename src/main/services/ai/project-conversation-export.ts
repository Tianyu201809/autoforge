import type { AiProject, AiProjectConversationExport, AiProjectTurn } from '../../../shared/ai-workspace-types'

export function createProjectConversationExport(
  project: AiProject,
  turns: AiProjectTurn[],
  now: () => string = () => new Date().toISOString()
): AiProjectConversationExport {
  return {
    format: 'autoforge-ai-conversation',
    version: 1,
    exportedAt: now(),
    project: {
      id: project.id,
      name: project.name,
      language: project.language,
      status: project.status,
      pinned: project.pinned,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    },
    turns
  }
}
