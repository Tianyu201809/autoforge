import { askPrompt } from './usePromptDialog'
import { useToast } from './useToast'

export async function renameScript(scriptId: string, currentName: string): Promise<boolean> {
  const { pushToast } = useToast()
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

  try {
    const updated = await window.autoforge.scripts.updateMeta(scriptId, { name: trimmed })
    if (!updated) {
      pushToast({
        type: 'error',
        title: '重命名失败',
        message: '无法更新脚本元数据'
      })
      return false
    }
    pushToast({ type: 'success', title: '已保存', message: `脚本已重命名为「${trimmed}」` })
    return true
  } catch (err) {
    pushToast({
      type: 'error',
      title: '重命名失败',
      message: err instanceof Error ? err.message : '无法更新 autoforge.json'
    })
    return false
  }
}
