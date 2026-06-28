import { ref } from 'vue'

export type ToastType = 'error' | 'success' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  title: string
  message: string
}

const toasts = ref<ToastItem[]>([])
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function dismissToast(id: string): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  const idx = toasts.value.findIndex((t) => t.id === id)
  if (idx >= 0) toasts.value.splice(idx, 1)
}

function pushToast(options: {
  type?: ToastType
  title: string
  message: string
  duration?: number
}): string {
  const id = crypto.randomUUID()
  toasts.value.push({
    id,
    type: options.type ?? 'info',
    title: options.title,
    message: options.message
  })

  const duration = options.duration ?? (options.type === 'error' ? 10000 : 5000)
  timers.set(
    id,
    setTimeout(() => dismissToast(id), duration)
  )

  return id
}

export function useToast() {
  return { toasts, pushToast, dismissToast }
}
