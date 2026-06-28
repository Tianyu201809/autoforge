import { ref } from 'vue'

export interface PromptOptions {
  title: string
  message?: string
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
}

interface PromptState extends PromptOptions {
  open: boolean
  value: string
  resolve: ((value: string | null) => void) | null
}

const defaultState = (): PromptState => ({
  open: false,
  title: '',
  message: '',
  label: '',
  defaultValue: '',
  placeholder: '',
  confirmLabel: '确定',
  cancelLabel: '取消',
  value: '',
  resolve: null
})

const state = ref<PromptState>(defaultState())

export function askPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    state.value = {
      open: true,
      title: options.title,
      message: options.message ?? '',
      label: options.label ?? '',
      defaultValue: options.defaultValue ?? '',
      placeholder: options.placeholder ?? '',
      confirmLabel: options.confirmLabel ?? '确定',
      cancelLabel: options.cancelLabel ?? '取消',
      value: options.defaultValue ?? '',
      resolve
    }
  })
}

export function resolvePrompt(value: string | null): void {
  state.value.resolve?.(value)
  state.value = defaultState()
}

export function usePromptDialog() {
  return { state, askPrompt, resolvePrompt }
}
