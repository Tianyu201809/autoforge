import { ref } from 'vue'

export type ConfirmVariant = 'danger' | 'default'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve: ((value: boolean) => void) | null
}

const defaultState = (): ConfirmState => ({
  open: false,
  title: '',
  message: '',
  confirmLabel: '确定',
  cancelLabel: '取消',
  variant: 'default',
  resolve: null
})

const state = ref<ConfirmState>(defaultState())

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    state.value = {
      open: true,
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? '确定',
      cancelLabel: options.cancelLabel ?? '取消',
      variant: options.variant ?? 'default',
      resolve
    }
  })
}

export function resolveConfirm(confirmed: boolean): void {
  state.value.resolve?.(confirmed)
  state.value = defaultState()
}

export function useConfirmDialog() {
  return { state, askConfirm, resolveConfirm }
}
