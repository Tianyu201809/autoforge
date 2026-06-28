import { onMounted, onUnmounted, ref } from 'vue'
import type { LogLine, RunSession } from '../../../shared/types/script'
import type { ScriptLifecycleEvent } from '../../../shared/script-contract'
import { useToast } from './useToast'

const sessions = ref<RunSession[]>([])
const logs = ref<LogLine[]>([])
const lifecycleEvents = ref<ScriptLifecycleEvent[]>([])
const activeSession = ref<RunSession | null>(null)

let unsubLog: (() => void) | undefined
let unsubSession: (() => void) | undefined
let unsubLifecycle: (() => void) | undefined

async function refreshSessions(): Promise<void> {
  sessions.value = await window.autoforge.runner.listSessions()
}

function scriptLabel(scriptId: string, getScriptName?: (scriptId: string) => string | undefined): string {
  return getScriptName?.(scriptId) ?? scriptId
}

function showStartFailureToast(
  scriptId: string,
  message: string,
  getScriptName?: (scriptId: string) => string | undefined
): void {
  const { pushToast } = useToast()
  const name = scriptLabel(scriptId, getScriptName)
  pushToast({
    type: 'error',
    title: `${name} 启动失败`,
    message
  })
}

async function stop(sessionId: string): Promise<void> {
  await window.autoforge.runner.stop(sessionId)
  await refreshSessions()
}

function logsForSession(sessionId: string | undefined): LogLine[] {
  if (!sessionId) return logs.value.slice(-200)
  return logs.value.filter((l) => l.sessionId === sessionId)
}

function clearLogs(sessionId?: string): void {
  if (sessionId) {
    logs.value = logs.value.filter((l) => l.sessionId !== sessionId)
  } else {
    logs.value = []
  }
}

function lastSuccessSessionForScript(scriptId: string) {
  return [...sessions.value]
    .filter((s) => s.scriptId === scriptId && s.status === 'success')
    .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0]
}

function resultForScript(scriptId: string): unknown {
  return lastSuccessSessionForScript(scriptId)?.result
}

export function useScriptRunner(
  onSessionChange?: () => void,
  getScriptName?: (scriptId: string) => string | undefined
) {
  const { pushToast } = useToast()

  async function start(
    scriptId: string,
    envId?: string,
    params?: Record<string, string>
  ): Promise<RunSession | null> {
    try {
      const session = await window.autoforge.runner.start(scriptId, envId, params)
      activeSession.value = session
      await refreshSessions()
      return session
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showStartFailureToast(scriptId, message, getScriptName)
      return null
    }
  }

  async function restart(
    scriptId: string,
    envId?: string,
    params?: Record<string, string>
  ): Promise<RunSession | null> {
    const running = sessions.value.find((s) => s.scriptId === scriptId && s.status === 'running')
    if (running) {
      await stop(running.id)
    }
    return start(scriptId, envId, params)
  }

  onMounted(() => {
    if (!window.autoforge) {
      console.error('window.autoforge is not available')
      return
    }
    void refreshSessions()

    unsubLog = window.autoforge.runner.onLog((line) => {
      logs.value.push(line)
      if (logs.value.length > 2000) logs.value.shift()
    })

    unsubSession = window.autoforge.runner.onSession((session) => {
      const idx = sessions.value.findIndex((s) => s.id === session.id)
      if (idx >= 0) {
        sessions.value[idx] = session
      } else {
        sessions.value.push(session)
      }
      if (activeSession.value?.id === session.id) {
        activeSession.value = session
      }
      onSessionChange?.()
    })

    unsubLifecycle = window.autoforge.runner.onLifecycle((ev) => {
      lifecycleEvents.value.push(ev)
      if (lifecycleEvents.value.length > 100) lifecycleEvents.value.shift()

      const name = scriptLabel(ev.scriptId, getScriptName)

      if (ev.phase === 'completed') {
        pushToast({
          type: 'success',
          title: `${name} 运行完成`,
          message: '脚本已成功执行完毕'
        })
      } else if (ev.phase === 'failed' && ev.message) {
        pushToast({
          type: 'error',
          title: `${name} 运行失败`,
          message: ev.message
        })
      }
    })
  })

  onUnmounted(() => {
    unsubLog?.()
    unsubSession?.()
    unsubLifecycle?.()
  })

  return {
    sessions,
    logs,
    lifecycleEvents,
    activeSession,
    start,
    stop,
    restart,
    refreshSessions,
    logsForSession,
    resultForScript,
    lastSuccessSessionForScript,
    clearLogs
  }
}
