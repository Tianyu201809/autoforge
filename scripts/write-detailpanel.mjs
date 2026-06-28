import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const target = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/src/components/DetailPanel.vue')

const t = {
  detail: '\u8be6\u60c5',
  edit: '\u7f16\u8f91',
  log: '\u65e5\u5fd7',
  config: '\u914d\u7f6e',
  running: '\u8fd0\u884c\u4e2d',
  runError: '\u8fd0\u884c\u5f02\u5e38',
  idle: '\u7a7a\u95f2',
  ipcComment:
    'IPC \u9700\u8981\u7eaf JSON \u5bf9\u8c61\uff0cVue reactive Proxy \u65e0\u6cd5 structured clone',
  depsFailed: '\u4f9d\u8d56\u5b89\u88c5\u5931\u8d25',
  run: '\u8fd0\u884c',
  stop: '\u505c\u6b62',
  restart: '\u91cd\u542f',
  runEnv: '\u8fd0\u884c\u73af\u5883',
  runStatus: '\u8fd0\u884c\u72b6\u6001',
  runResult: '\u8fd0\u884c\u7ed3\u679c',
  copyResult: '\u590d\u5236\u7ed3\u679c',
  desc: '\u63cf\u8ff0',
  noDesc: '\u6682\u65e0\u63cf\u8ff0',
  version: '\u7248\u672c',
  entry: '\u5165\u53e3',
  deps: '\u4f9d\u8d56',
  installing: '\u5b89\u88c5\u4e2d\u2026',
  installDeps: '\u5b89\u88c5\u4f9d\u8d56',
  recentLogs: '\u6700\u8fd1\u65e5\u5fd7',
  noLogsStart: '\u6682\u65e0\u65e5\u5fd7\uff0c\u70b9\u51fb\u8fd0\u884c\u5f00\u59cb',
  openDir: '\u6253\u5f00\u76ee\u5f55',
  delete: '\u5220\u9664',
  noLogs: '\u6682\u65e0\u65e5\u5fd7',
  saving: '\u4fdd\u5b58\u4e2d\u2026',
  save: '\u4fdd\u5b58',
  envHint:
    '\u4e0d\u540c\u73af\u5883\u53ef\u914d\u7f6e\u4e0d\u540c\u7684\u8d26\u53f7\u3001URL \u7b49\uff0c\u8fd0\u884c\u65f6\u53ef\u5207\u6362',
  scriptConfig: '\u811a\u672c\u914d\u7f6e',
  scriptConfigHint:
    '\u5728\u6b64\u586b\u5199\u672c\u811a\u672c\u7684\u914d\u7f6e\u9879\uff0c\u4fdd\u5b58\u540e\u4ec5\u5bf9\u8be5\u811a\u672c\u751f\u6548',
  default: '\u9ed8\u8ba4',
  required: '\u5fc5\u586b',
  optional: '\u53ef\u9009',
  noEnvSchema:
    '\u6b64\u811a\u672c\u672a\u58f0\u660e\u914d\u7f6e\u9879\u3002\u53ef\u5728\u300c\u7f16\u8f91 \u2192 autoforge.json\u300d\u7684 <code class="sb-text-muted">env</code> \u5b57\u6bb5\u4e2d\u6dfb\u52a0\uff0c\u4f8b\u5982\u8d26\u53f7\u3001\u5bc6\u7801\u3001URL\u3002',
  schedule: '\u5b9a\u65f6\u4efb\u52a1',
  enableSchedule: '\u542f\u7528\u5b9a\u65f6\u4efb\u52a1',
  saveConfig: '\u4fdd\u5b58\u914d\u7f6e'
}

const content = `<script setup lang="ts">
import { computed, onMounted, ref, toRaw, watch } from 'vue'
import {
  AppWindow,
  CheckCircle2,
  Copy,
  DownloadCloud,
  ExternalLink,
  FolderOpen,
  FolderSync,
  Globe,
  KeyRound,
  Mail,
  Package,
  Play,
  RotateCw,
  Save,
  Square,
  Trash2,
  X
} from 'lucide-vue-next'
import { normalizeCronExpression } from '../../../shared/cron-schedule'
import type { EnvironmentProfile, ScriptItem } from '../../../shared/types/script'
import type { useScriptRunner } from '../composables/useScriptRunner'
import CronScheduleBuilder from './CronScheduleBuilder.vue'

const props = defineProps<{
  script: ScriptItem
  runner: ReturnType<typeof useScriptRunner>
  initialTab?: 'detail' | 'edit' | 'log' | 'config'
}>()

const emit = defineEmits<{
  close: []
  refresh: []
  delete: []
}>()

const activeTab = ref<'detail' | 'edit' | 'log' | 'config'>('detail')
const environments = ref<EnvironmentProfile[]>([])
const selectedEnvId = ref('')
const cronExpression = ref('')
const cronEnabled = ref(false)
const editContent = ref('')
const manifestContent = ref('')
const editTarget = ref<'entry' | 'manifest'>('entry')
const saving = ref(false)
const installingDeps = ref(false)
const envVars = ref<Record<string, string>>({})

const iconMap = {
  globe: Globe,
  'download-cloud': DownloadCloud,
  'app-window': AppWindow,
  'folder-sync': FolderSync,
  mail: Mail,
  'key-round': KeyRound
} as const

const tabs = [
  { id: 'detail' as const, label: '${t.detail}' },
  { id: 'edit' as const, label: '${t.edit}' },
  { id: 'log' as const, label: '${t.log}' },
  { id: 'config' as const, label: '${t.config}' }
]

const session = computed(() =>
  props.runner.sessions.value.find(
    (s) => s.scriptId === props.script.id && (s.status === 'running' || s.status === 'success' || s.status === 'error')
  )
)

const sessionLogs = computed(() => {
  const sid = session.value?.id ?? props.script.activeSessionId
  return props.runner.logsForSession(sid)
})

const runResult = computed(() => props.runner.resultForScript(props.script.id))

const statusLabel = computed(() => {
  if (props.script.status === 'running') return { text: '${t.running}', class: 'text-emerald-400' }
  if (props.script.status === 'error') return { text: '${t.runError}', class: 'text-red-400' }
  return { text: '${t.idle}', class: 'sb-text-muted' }
})

async function loadContent(): Promise<void> {
  const info = await window.autoforge.scripts.getContent(props.script.id)
  if (info) {
    editContent.value = info.content
    manifestContent.value = info.manifestContent
  }
}

async function loadEnvironments(): Promise<void> {
  environments.value = await window.autoforge.env.list()
  selectedEnvId.value = props.script.defaultEnvId ?? environments.value.find((e) => e.isDefault)?.id ?? environments.value[0]?.id ?? ''
  syncEnvVars()
}

function syncEnvVars(): void {
  const profile = environments.value.find((e) => e.id === selectedEnvId.value)
  const scriptConfig = props.script.configByEnv?.[selectedEnvId.value] ?? {}
  const vars: Record<string, string> = {}
  for (const def of props.script.envSchema) {
    vars[def.key] = scriptConfig[def.key] ?? profile?.variables[def.key] ?? def.default ?? ''
  }
  envVars.value = vars
}

function syncScheduleFromScript(): void {
  cronExpression.value = normalizeCronExpression(props.script.schedule?.expression)
  cronEnabled.value = props.script.schedule?.enabled ?? false
}

onMounted(async () => {
  syncScheduleFromScript()
  await Promise.all([loadContent(), loadEnvironments()])
})

watch(
  () => props.script.id,
  async () => {
    syncScheduleFromScript()
    await Promise.all([loadContent(), loadEnvironments()])
  }
)

watch(
  () => [props.script.id, props.initialTab] as const,
  ([, tab]) => {
    if (tab) activeTab.value = tab
  },
  { immediate: true }
)

watch(selectedEnvId, () => {
  syncEnvVars()
})

watch(
  () => props.script.configByEnv,
  () => syncEnvVars(),
  { deep: true }
)

async function saveScript(): Promise<void> {
  saving.value = true
  try {
    await window.autoforge.scripts.setContent(
      props.script.id,
      editContent.value,
      editTarget.value === 'manifest' ? manifestContent.value : undefined
    )
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function saveConfig(): Promise<void> {
  saving.value = true
  try {
    // ${t.ipcComment}
    const plainConfig = Object.fromEntries(
      Object.entries(toRaw(envVars.value)).map(([k, v]) => [k, v ?? ''])
    )
    await window.autoforge.scripts.setEnvConfig(props.script.id, selectedEnvId.value, plainConfig)
    await window.autoforge.scripts.update(props.script.id, {
      defaultEnvId: selectedEnvId.value,
      schedule: { expression: cronExpression.value, enabled: cronEnabled.value }
    })
    emit('refresh')
  } finally {
    saving.value = false
  }
}

async function runWithEnv(): Promise<void> {
  await props.runner.start(props.script.id, selectedEnvId.value)
  emit('refresh')
}

async function installDeps(): Promise<void> {
  installingDeps.value = true
  try {
    const result = await window.autoforge.scripts.installDeps(props.script.id)
    if (!result.ok) {
      alert(\`${t.depsFailed}:\\n\${result.stderr || result.stdout}\`)
    }
  } finally {
    installingDeps.value = false
  }
}

async function openScriptLocation(): Promise<void> {
  await window.autoforge.system.openPath(props.script.workspacePath)
}

async function copyResult(): Promise<void> {
  if (runResult.value) {
    await navigator.clipboard.writeText(JSON.stringify(runResult.value, null, 2))
  }
}

function formatLogTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function logLevelClass(level: string): string {
  if (level === 'WARN') return 'text-amber-400/80'
  if (level === 'ERROR') return 'text-red-400/80'
  return 'text-emerald-400/80'
}
</script>

<template>
  <aside class="w-96 flex-shrink-0 border-l sb-border sb-bg-panel flex flex-col">
    <div class="flex items-center justify-between px-4 py-3 border-b sb-border-subtle">
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-md border flex items-center justify-center" :class="[script.iconBg, script.iconBorder]">
          <component :is="iconMap[script.icon] ?? AppWindow" class="w-3.5 h-3.5" :class="script.iconColor" :stroke-width="1.5" />
        </div>
        <div>
          <h2 class="text-[13px] font-medium sb-text-primary">{{ script.name }}</h2>
          <p class="text-[11px] sb-text-faint">{{ script.categoryLabel }}</p>
        </div>
      </div>
      <button type="button" class="w-7 h-7 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-secondary hover:sb-bg-inset transition-colors" @click="emit('close')">
        <X class="w-4 h-4" :stroke-width="1.5" />
      </button>
    </div>

    <div class="flex border-b sb-border-subtle px-4">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="px-3 py-2.5 text-[12px] transition-colors"
        :class="activeTab === tab.id ? 'font-medium sb-text-primary border-b-2 border-[var(--sb-text-primary)] -mb-px' : 'sb-text-muted hover:sb-text-secondary'"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ${t.detail} -->
    <div v-if="activeTab === 'detail'" class="flex-1 overflow-y-auto flex flex-col min-h-0">
      <div class="flex gap-2 p-4 border-b sb-border-subtle">
        <button
          type="button"
          class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[12px] font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
          :disabled="script.status === 'running'"
          @click="runWithEnv"
        >
          <Play class="w-3 h-3" :stroke-width="1.5" />
          ${t.run}
        </button>
        <button
          type="button"
          class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-[12px] font-medium hover:bg-red-500/20 transition-colors disabled:opacity-40"
          :disabled="!script.activeSessionId"
          @click="script.activeSessionId && runner.stop(script.activeSessionId).then(() => emit('refresh'))"
        >
          <Square class="w-3 h-3" :stroke-width="1.5" />
          ${t.stop}
        </button>
        <button
          type="button"
          class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg sb-bg-inset sb-text-secondary border sb-border-subtle text-[12px] font-medium sb-bg-hover transition-colors"
          @click="runner.restart(script.id, selectedEnvId).then(() => emit('refresh'))"
        >
          <RotateCw class="w-3.5 h-3.5" :stroke-width="1.5" />
          ${t.restart}
        </button>
      </div>

      <div class="p-4 space-y-4 flex-1 overflow-y-auto">
        <div>
          <label class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">${t.runEnv}</label>
          <select
            v-model="selectedEnvId"
            class="mt-1.5 w-full h-8 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input"
          >
            <option v-for="env in environments" :key="env.id" :value="env.id">{{ env.name }}</option>
          </select>
        </div>

        <div>
          <label class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">${t.runStatus}</label>
          <div class="mt-2 flex items-center gap-3 p-3 rounded-lg border" :class="script.status === 'running' ? 'bg-emerald-500/5 border-emerald-500/15' : 'sb-bg-surface sb-border-subtle'">
            <div class="w-8 h-8 rounded-full flex items-center justify-center" :class="script.status === 'running' ? 'bg-emerald-500/10' : 'sb-bg-inset'">
              <CheckCircle2 class="w-4 h-4" :class="statusLabel.class" :stroke-width="1.5" />
            </div>
            <div>
              <p class="text-[13px] font-medium" :class="statusLabel.class">{{ statusLabel.text }}</p>
              <p v-if="session?.phase" class="text-[11px] sb-text-muted">{{ session.phase }}</p>
              <p v-else class="text-[11px] sb-text-muted">{{ script.meta }}</p>
            </div>
          </div>
        </div>

        <div v-if="runResult" class="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
          <label class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">${t.runResult}</label>
          <pre class="mt-2 text-[11px] font-mono text-blue-300 break-all whitespace-pre-wrap">{{ JSON.stringify(runResult, null, 2) }}</pre>
          <button type="button" class="mt-2 flex items-center gap-1 text-[12px] text-blue-400 hover:text-blue-300" @click="copyResult">
            <Copy class="w-3.5 h-3.5" :stroke-width="1.5" />
            ${t.copyResult}
          </button>
        </div>

        <div>
          <label class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">${t.desc}</label>
          <p class="mt-1.5 text-[13px] sb-text-muted leading-relaxed">{{ script.description || '${t.noDesc}' }}</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="p-3 rounded-lg border sb-border-subtle sb-bg-surface">
            <p class="text-[11px] sb-text-faint">${t.version}</p>
            <p class="text-[13px] sb-text-secondary mt-0.5 font-mono">{{ script.version }}</p>
          </div>
          <div class="p-3 rounded-lg border sb-border-subtle sb-bg-surface">
            <p class="text-[11px] sb-text-faint">${t.entry}</p>
            <p class="text-[11px] sb-text-muted mt-0.5 font-mono truncate">{{ script.entry }}</p>
          </div>
        </div>

        <div v-if="script.dependencies && Object.keys(script.dependencies).length">
          <label class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">${t.deps}</label>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="(ver, pkg) in script.dependencies" :key="pkg" class="text-[11px] px-2 py-1 rounded-md sb-bg-inset sb-text-muted border sb-border-subtle font-mono">
              {{ pkg }}@{{ ver }}
            </span>
          </div>
          <button
            type="button"
            class="mt-2 flex items-center gap-1.5 text-[12px] sb-text-muted hover:sb-text-primary"
            :disabled="installingDeps"
            @click="installDeps"
          >
            <Package class="w-3.5 h-3.5" :stroke-width="1.5" />
            {{ installingDeps ? '${t.installing}' : '${t.installDeps}' }}
          </button>
        </div>

        <div>
          <label class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">${t.recentLogs}</label>
          <div class="mt-2 rounded-lg border sb-border-subtle sb-bg-log p-3 font-mono text-[11px] leading-relaxed space-y-1 max-h-36 overflow-y-auto">
            <p v-if="!sessionLogs.length" class="sb-text-faint">${t.noLogsStart}</p>
            <p v-for="(log, i) in sessionLogs.slice(-20)" :key="i">
              <span class="sb-text-faint">{{ formatLogTime(log.ts) }}</span>
              <span class="ml-1" :class="logLevelClass(log.level)">{{ log.level }}</span>
              <span class="sb-text-muted ml-1">{{ log.message }}</span>
            </p>
          </div>
        </div>
      </div>

      <div class="p-3 border-t sb-border-subtle flex gap-2">
        <button type="button" class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[12px] sb-text-muted border sb-border hover:sb-text-primary hover:border-[var(--sb-border)] transition-all" @click="openScriptLocation">
          <FolderOpen class="w-3.5 h-3.5" :stroke-width="1.5" />
          ${t.openDir}
        </button>
        <button
          type="button"
          class="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[12px] text-red-400/70 border sb-border hover:text-red-400 hover:border-red-500/30 transition-all"
          @click="emit('delete')"
        >
          <Trash2 class="w-3.5 h-3.5" :stroke-width="1.5" />
          ${t.delete}
        </button>
      </div>
    </div>

    <!-- ${t.log} -->
    <div v-else-if="activeTab === 'log'" class="flex-1 overflow-y-auto p-4">
      <div class="rounded-lg border sb-border-subtle sb-bg-log p-3 font-mono text-[11px] leading-relaxed space-y-1">
        <p v-if="!sessionLogs.length" class="sb-text-faint">${t.noLogs}</p>
        <p v-for="(log, i) in sessionLogs" :key="i">
          <span class="sb-text-faint">{{ formatLogTime(log.ts) }}</span>
          <span class="ml-1" :class="logLevelClass(log.level)">{{ log.level }}</span>
          <span class="sb-text-muted ml-1">{{ log.message }}</span>
        </p>
      </div>
    </div>

    <!-- ${t.edit} -->
    <div v-else-if="activeTab === 'edit'" class="flex-1 flex flex-col p-4 gap-2 min-h-0">
      <div class="flex gap-1 sb-bg-input border sb-border rounded-lg p-0.5">
        <button
          type="button"
          class="flex-1 h-7 rounded-md text-[12px] transition-colors"
          :class="editTarget === 'entry' ? 'sb-bg-inset sb-text-primary' : 'sb-text-muted'"
          @click="editTarget = 'entry'"
        >
          {{ script.entry }}
        </button>
        <button
          type="button"
          class="flex-1 h-7 rounded-md text-[12px] transition-colors"
          :class="editTarget === 'manifest' ? 'sb-bg-inset sb-text-primary' : 'sb-text-muted'"
          @click="editTarget = 'manifest'"
        >
          autoforge.json
        </button>
      </div>
      <textarea
        v-if="editTarget === 'entry'"
        v-model="editContent"
        class="flex-1 w-full rounded-lg border sb-border sb-bg-log p-3 font-mono text-[12px] sb-text-secondary outline-none focus:sb-input resize-none min-h-0"
      />
      <textarea
        v-else
        v-model="manifestContent"
        class="flex-1 w-full rounded-lg border sb-border sb-bg-log p-3 font-mono text-[12px] sb-text-secondary outline-none focus:sb-input resize-none min-h-0"
      />
      <button
        type="button"
        class="flex items-center justify-center gap-1.5 h-8 rounded-lg sb-btn-accent text-[13px] font-medium hover:opacity-90 transition-colors disabled:opacity-50"
        :disabled="saving"
        @click="saveScript"
      >
        <Save class="w-3.5 h-3.5" :stroke-width="1.5" />
        {{ saving ? '${t.saving}' : '${t.save}' }}
      </button>
    </div>

    <!-- ${t.config} -->
    <div v-else-if="activeTab === 'config'" class="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <label class="text-[12px] sb-text-muted">${t.runEnv}</label>
        <select
          v-model="selectedEnvId"
          class="mt-1 w-full h-8 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input"
        >
          <option v-for="env in environments" :key="env.id" :value="env.id">{{ env.name }}</option>
        </select>
        <p class="mt-1 text-[11px] sb-text-faint">${t.envHint}</p>
      </div>

      <div v-if="script.envSchema.length">
        <h3 class="text-[12px] font-medium sb-text-muted mb-2">${t.scriptConfig}</h3>
        <p class="text-[11px] sb-text-faint mb-3">${t.scriptConfigHint}</p>
        <div v-for="def in script.envSchema" :key="def.key" class="mb-3">
          <label class="text-[12px] sb-text-muted">
            {{ def.label }}
            <span v-if="def.required" class="text-red-400">*</span>
          </label>
          <p v-if="def.description" class="text-[11px] sb-text-faint mt-0.5">{{ def.description }}</p>
          <input
            v-model="envVars[def.key]"
            :type="def.secret ? 'password' : 'text'"
            class="mt-1 w-full h-8 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input"
            :placeholder="def.default ? \`${t.default}: \${def.default}\` : def.required ? '${t.required}' : '${t.optional}'"
          />
          <p class="mt-0.5 text-[10px] sb-text-faint font-mono">{{ def.key }}</p>
        </div>
      </div>
      <div v-else class="rounded-lg border sb-border-subtle sb-bg-surface p-4 text-[12px] sb-text-muted">
        ${t.noEnvSchema}
      </div>

      <div>
        <label class="text-[12px] sb-text-muted">${t.schedule}</label>
        <div class="mt-1">
          <CronScheduleBuilder v-model="cronExpression" />
        </div>
        <label class="mt-3 flex items-center gap-2 text-[12px] sb-text-muted">
          <input v-model="cronEnabled" type="checkbox" class="rounded" />
          ${t.enableSchedule}
        </label>
      </div>

      <button
        type="button"
        class="w-full h-8 rounded-lg sb-btn-accent text-[13px] font-medium hover:opacity-90 transition-colors disabled:opacity-50"
        :disabled="saving"
        @click="saveConfig"
      >
        ${t.saveConfig}
      </button>
    </div>
  </aside>
</template>
`

writeFileSync(target, content, 'utf8')
console.log('written', target)
