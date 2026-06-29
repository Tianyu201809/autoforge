<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import LogConsole from './components/LogConsole.vue'
import PopoutTitleBar from './components/PopoutTitleBar.vue'
import type { LogConsoleDisplayMode, LogConsoleSession } from './components/LogConsole.vue'
import { useScriptRunner } from './composables/useScriptRunner'

const runner = useScriptRunner(() => {})
const displayMode = ref<LogConsoleDisplayMode>('normal')
const activeSessionId = ref<string | undefined>()
const trackedSessionIds = ref<string[]>([])
const pinned = ref(false)
const scriptNames = ref<Record<string, string>>({})

function scriptNameForSession(sessionId: string): string {
  const session = runner.sessions.value.find((s) => s.id === sessionId)
  if (!session) return sessionId.slice(0, 8)
  return scriptNames.value[session.scriptId] ?? session.scriptId
}

function trackSession(sessionId: string): void {
  if (!trackedSessionIds.value.includes(sessionId)) {
    trackedSessionIds.value = [...trackedSessionIds.value, sessionId]
  }
}

const sessions = computed<LogConsoleSession[]>(() =>
  trackedSessionIds.value
    .map((sessionId) => {
      const session = runner.sessions.value.find((s) => s.id === sessionId)
      return {
        sessionId,
        scriptName: scriptNameForSession(sessionId),
        logs: runner.logsForSession(sessionId),
        status: session?.status,
        runProgress: session?.runProgress
      }
    })
    .sort((a, b) => {
      const rank = (status?: string) => (status === 'running' ? 0 : 1)
      return rank(a.status) - rank(b.status)
    })
)

const sessionSubtitle = computed(() =>
  sessions.value.length ? `${sessions.value.length} 个会话` : undefined
)

watch(
  () => runner.sessions.value,
  (list) => {
    for (const session of list) {
      if (session.status === 'running') trackSession(session.id)
    }
  },
  { deep: true, immediate: true }
)

watch(
  () => runner.activeSession.value,
  (session) => {
    if (session) {
      trackSession(session.id)
      activeSessionId.value = session.id
    }
  }
)

onMounted(async () => {
  pinned.value = await window.autoforge.terminal.isPinned()
  const data = await window.autoforge.scripts.list()
  scriptNames.value = Object.fromEntries(data.scripts.map((s) => [s.id, s.name]))
  const existing = await window.autoforge.runner.listSessions()
  for (const s of existing) trackSession(s.id)
  if (existing.length) {
    activeSessionId.value =
      existing.find((s) => s.status === 'running')?.id ?? existing[existing.length - 1]?.id
  }
})

async function togglePin(): Promise<void> {
  pinned.value = await window.autoforge.terminal.togglePin()
}

async function dockBack(): Promise<void> {
  await window.autoforge.terminal.close()
}

function handleClear(sessionId?: string): void {
  if (sessionId) {
    runner.clearLogs(sessionId)
    return
  }
  for (const id of trackedSessionIds.value) {
    runner.clearLogs(id)
  }
}

function handleClose(sessionId: string): void {
  trackedSessionIds.value = trackedSessionIds.value.filter((id) => id !== sessionId)
  runner.clearLogs(sessionId)
  if (!trackedSessionIds.value.length) {
    activeSessionId.value = undefined
  }
}

function handleCloseAll(): void {
  for (const id of trackedSessionIds.value) {
    runner.clearLogs(id)
  }
  trackedSessionIds.value = []
  activeSessionId.value = undefined
}
</script>

<template>
  <div class="flex flex-col h-full sb-bg-panel">
    <PopoutTitleBar
      breadcrumb="终端"
      :subtitle="sessionSubtitle"
      :pinned="pinned"
      @toggle-pin="togglePin"
      @dock="dockBack"
    />
    <div class="flex-1 min-h-0 flex flex-col">
      <LogConsole
        v-model:display-mode="displayMode"
        v-model:active-session-id="activeSessionId"
        :sessions="sessions"
        standalone
        @clear="handleClear"
        @close="handleClose"
        @close-all="handleCloseAll"
      />
    </div>
  </div>
</template>
