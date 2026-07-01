import { ref } from 'vue'

export type PanelSaveFeedbackType = 'success' | 'error'

export interface PanelSaveFeedback {
  type: PanelSaveFeedbackType
  title: string
  message?: string
}

/** 详情面板 / 独立编辑窗口顶部区域的内联保存反馈，避免底部 toast 遮挡保存按钮 */
export function usePanelSaveFeedback() {
  const saveFeedback = ref<PanelSaveFeedback | null>(null)
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined

  function showSaveFeedback(
    type: PanelSaveFeedbackType,
    title: string,
    message?: string,
    duration?: number
  ): void {
    if (feedbackTimer) clearTimeout(feedbackTimer)
    saveFeedback.value = { type, title, message: message || undefined }
    const ms = duration ?? (type === 'error' ? 10000 : 5000)
    feedbackTimer = setTimeout(() => {
      saveFeedback.value = null
      feedbackTimer = undefined
    }, ms)
  }

  function clearSaveFeedback(): void {
    if (feedbackTimer) clearTimeout(feedbackTimer)
    feedbackTimer = undefined
    saveFeedback.value = null
  }

  return { saveFeedback, showSaveFeedback, clearSaveFeedback }
}
