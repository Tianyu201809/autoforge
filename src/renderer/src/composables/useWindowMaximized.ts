import { onMounted, onUnmounted, ref } from 'vue'

export function useWindowMaximized() {
  const isMaximized = ref(false)
  let unsub: (() => void) | undefined

  onMounted(async () => {
    isMaximized.value = await window.api.isMaximized()
    unsub = window.api.onMaximizedChange((maximized) => {
      isMaximized.value = maximized
    })
  })

  onUnmounted(() => {
    unsub?.()
  })

  function toggleMaximize(): void {
    window.api.maximize()
  }

  return { isMaximized, toggleMaximize }
}
