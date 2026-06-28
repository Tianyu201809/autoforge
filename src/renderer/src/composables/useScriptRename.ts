import { askPrompt } from './usePromptDialog'

export async function renameScript(scriptId: string, currentName: string): Promise<boolean> {
  const name = await askPrompt({
    title: '重命名脚本',
    message: '名称将写入 autoforge.json，并在列表与详情中同步显示。',
    label: '脚本名称',
    defaultValue: currentName,
    confirmLabel: '保存'
  })
  if (name === null) return false

  const trimmed = name.trim()
  if (!trimmed || trimmed === currentName.trim()) return false

  await window.autoforge.scripts.updateMeta(scriptId, { name: trimmed })
  return true
}
