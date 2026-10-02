import type { ConversionTurn } from '../../../shared/conversion-conversation'
import type { ConfirmOptions } from '../composables/useConfirmDialog'

/** 第一轮可以不写要求。之后必须有新内容。转换进行中不能再发。 */
export function canSendConversionMessage(
  turns: ConversionTurn[],
  draft: string,
  converting: boolean
): boolean {
  if (converting) return false
  if (!turns.some((turn) => turn.role === 'user')) return true
  return draft.trim().length > 0
}

export function workspaceDeleteConfirm(
  repoLabel: string,
  workspacePath: string,
  source: 'git' | 'local' = 'git'
): ConfirmOptions {
  return {
    title: '删除工作区',
    confirmLabel: '删除',
    cancelLabel: '取消',
    variant: 'danger',
    message: [
      `确定删除「${repoLabel}」的转换工作区吗？`,
      `本地目录：${workspacePath}`,
      source === 'local'
        ? '工作区里的副本和转换产物会一起删除。原来的文件夹不会动。'
        : '克隆的仓库和转换产物会一起删除。',
      '脚本列表里已导入的脚本不会删除。'
    ].join('\n')
  }
}
