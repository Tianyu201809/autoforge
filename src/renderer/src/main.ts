import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'

function showBootError(message: string): void {
  const root = document.getElementById('app')
  if (!root) return
  root.innerHTML = `<div style="padding:24px;color:#fca5a5;font-family:monospace;white-space:pre-wrap">${message}</div>`
}

if (!window.autoforge) {
  showBootError('Preload 未加载：window.autoforge 不可用。\n请确认 preload 脚本路径正确后重启应用。')
} else {
  try {
    createApp(App).mount('#app')
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    showBootError(`Vue 启动失败：\n${message}`)
  }
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason)
})
