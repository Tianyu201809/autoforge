<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  FileJson,
  FolderOpen,
  GitBranch,
  History,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Terminal,
  Trash2
} from 'lucide-vue-next'
import type { ScriptItem } from '../../../shared/types/script'
import type { RepoConvertibilityLevel } from '../../../shared/repo-types'
import AppFeatureModal from './AppFeatureModal.vue'
import { REPO_IMPORT_STEPS, useRepoImport } from '../composables/useRepoImport'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; imported: [script: ScriptItem] }>()

const {
  url,
  branch,
  token,
  showAdvanced,
  busy,
  importing,
  error,
  progress,
  workspace,
  history,
  step,
  progressPercent,
  canSubmit,
  engine,
  llmProfiles,
  selectedProfileId,
  selectedProfile,
  allowBuildGlobally,
  allowBuildThisRun,
  instruction,
  converting,
  conversionLogs,
  conversionResult,
  turns,
  plannedBuildCommands,
  canConvert,
  resetAll,
  loadHistory,
  loadLlmProfiles,
  startFetch,
  recheckPackage,
  resumeWorkspace,
  startLlmConversion,
  cancelLlmConversion,
  importPackage,
  openFolder,
  copyPrompt,
  deleteWorkspace
} = useRepoImport()

const CONVERTIBILITY_META: Record<
  RepoConvertibilityLevel,
  { label: string; tone: string; warn: boolean }
> = {
  direct: { label: '可直接转换', tone: 'text-emerald-500', warn: false },
  wrappable: { label: '需适配包装', tone: 'text-sky-500', warn: false },
  'needs-build': { label: '需先构建', tone: 'text-amber-500', warn: true },
  unsupported: { label: '不适合脚本化', tone: 'text-red-500', warn: true }
}

const convertibilityMeta = computed(() =>
  workspace.value ? CONVERTIBILITY_META[workspace.value.profile.convertibility] : null
)

const profile = computed(() => workspace.value?.profile ?? null)

const logContainer = ref<HTMLElement | null>(null)

const phaseLabel = computed(() => {
  const phase = progress.value?.phase
  if (phase === 'downloading') return '下载中'
  if (phase === 'cloning') return '克隆中'
  if (phase === 'extracting') return '解压中'
  if (phase === 'analyzing') return '分析中'
  if (phase === 'validating') return '校验中'
  if (phase === 'workspace-ready') return '已就绪'
  if (phase === 'llm-preparing') return '准备上下文'
  if (phase === 'llm-building') return '构建中'
  if (phase === 'llm-generating') return '模型生成中'
  if (phase === 'llm-writing') return '写入中'
  if (phase === 'llm-validating') return '校验中'
  return '处理中'
})

const hasUserTurn = computed(() => turns.value.some((turn) => turn.role === 'user'))
const sendLabel = computed(() => (hasUserTurn.value ? '发送' : '开始转换'))

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function languageSummary(): string {
  if (!profile.value) return ''
  return profile.value.languages
    .slice(0, 3)
    .map((item) => `${item.name} ${item.files}`)
    .join(' · ')
}

function logTone(level: 'INFO' | 'WARN' | 'ERROR'): string {
  if (level === 'ERROR') return 'text-rose-500'
  if (level === 'WARN') return 'text-amber-600'
  return 'sb-text-secondary'
}

async function onImport(): Promise<void> {
  const script = await importPackage()
  if (!script) return
  emit('imported', script)
  emit('close')
}

function onClose(): void {
  if (busy.value || importing.value || converting.value) return
  emit('close')
}

function onReset(): void {
  if (busy.value || importing.value || converting.value) return
  resetAll()
}

function openSettings(): void {
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      void loadHistory()
      void loadLlmProfiles()
    }
  }
)

watch(
  () => conversionLogs.value.length,
  async () => {
    await nextTick()
    if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
)

onMounted(() => {
  if (props.open) {
    void loadHistory()
    void loadLlmProfiles()
  }
})
</script>

<template>
  <AppFeatureModal :open="open" max-width="3xl" @close="onClose">
    <div class="flex items-center justify-between gap-3 px-5 py-3.5 border-b sb-border-subtle flex-shrink-0">
      <div class="flex items-center gap-2.5 min-w-0">
        <GitBranch class="w-4 h-4 text-violet-500 flex-shrink-0" :stroke-width="1.5" />
        <div class="min-w-0">
          <h2 id="repo-import-title" class="text-[14px] font-medium sb-text-primary">从仓库导入</h2>
          <p class="text-[11px] sb-text-faint truncate">拉取 GitHub / Gitee 项目，转成可运行的 Autoforge 脚本包</p>
        </div>
      </div>
      <button
        type="button"
        class="text-[12px] sb-text-muted hover:sb-text-primary transition-colors disabled:opacity-40"
        :disabled="busy || importing || converting"
        @click="onClose"
      >
        关闭
      </button>
    </div>

    <div class="flex items-center gap-2 px-5 py-2.5 border-b sb-border-subtle flex-shrink-0 text-[11px]">
      <template v-for="(item, index) in REPO_IMPORT_STEPS" :key="item.id">
        <span
          class="flex items-center gap-1.5"
          :class="step === item.id ? 'text-[var(--sb-accent-solid)] font-medium' : step > item.id ? 'sb-text-muted' : 'sb-text-faint'"
        >
          <span
            class="w-4 h-4 rounded-full border flex items-center justify-center text-[10px] leading-none"
            :class="step > item.id ? 'border-emerald-500/60 text-emerald-500' : step === item.id ? 'border-[var(--sb-accent-solid)]' : 'sb-border-subtle'"
          >
            <CheckCircle2 v-if="step > item.id" class="w-3 h-3" :stroke-width="2" />
            <template v-else>{{ item.id }}</template>
          </span>
          {{ item.label }}
        </span>
        <ArrowRight
          v-if="index < REPO_IMPORT_STEPS.length - 1"
          class="w-3 h-3 sb-text-faint flex-shrink-0"
          :stroke-width="1.5"
        />
      </template>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
      <div
        v-if="error"
        class="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20"
      >
        <AlertTriangle class="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" :stroke-width="1.5" />
        <div class="min-w-0 flex-1">
          <p class="text-[12px] text-red-500 leading-relaxed break-words">{{ error }}</p>
        </div>
      </div>

      <template v-if="step === 1">
        <div class="space-y-2">
          <label class="sb-field-label text-[12px]" for="repo-url">仓库地址</label>
          <input
            id="repo-url"
            v-model="url"
            type="text"
            class="w-full h-9 px-3 text-[13px] sb-input border rounded-lg placeholder:sb-text-faint outline-none focus:sb-input transition-all font-mono"
            placeholder="https://gitee.com/owner/repo 或 git@gitee.com:owner/repo.git"
            :disabled="busy"
            @keydown.enter="startFetch"
          />
          <p class="text-[11px] sb-text-faint leading-relaxed">
            支持 https 与 SSH 地址，也可携带分支：
            <code class="font-mono">.../tree/main</code>。
            GitHub 走归档下载；<span class="sb-text-muted">Gitee 与 SSH 地址需要本机已安装 git</span>。
          </p>
        </div>

        <div>
          <button
            type="button"
            class="text-[12px] sb-text-muted hover:sb-text-primary transition-colors"
            @click="showAdvanced = !showAdvanced"
          >
            {{ showAdvanced ? '收起高级选项' : '高级选项（分支 / 私有仓库令牌）' }}
          </button>
          <div v-if="showAdvanced" class="mt-2.5 grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="text-[11px] sb-text-faint" for="repo-branch">分支 / 标签</label>
              <input
                id="repo-branch"
                v-model="branch"
                type="text"
                class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none font-mono"
                placeholder="默认分支"
                :disabled="busy"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-[11px] sb-text-faint" for="repo-token">访问令牌（GitHub 私有仓库）</label>
              <input
                id="repo-token"
                v-model="token"
                type="password"
                class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none font-mono"
                placeholder="仅本次拉取使用，不落库"
                :disabled="busy"
              />
            </div>
          </div>
          <p v-if="showAdvanced" class="mt-2 text-[11px] sb-text-faint leading-relaxed">
            Gitee 私有仓库请改用 SSH 地址（需本机已配置 SSH 密钥），或先配置本机 git 凭据管理器。
          </p>
        </div>

        <div v-if="history.length" class="space-y-2">
          <div class="flex items-center gap-1.5">
            <History class="w-3.5 h-3.5 sb-text-faint" :stroke-width="1.5" />
            <span class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">最近工作区</span>
          </div>
          <div class="space-y-1">
            <div
              v-for="item in history.slice(0, 5)"
              :key="item.taskId"
              class="group flex items-center gap-2 px-2.5 py-2 rounded-lg border sb-border-subtle sb-bg-inset"
            >
              <div class="min-w-0 flex-1">
                <p class="text-[12px] sb-text-primary truncate font-mono">{{ item.repo }}</p>
                <p class="text-[11px] sb-text-faint truncate">
                  {{ item.resolvedRef }} · {{ item.provider }}
                  <span v-if="item.packageReady" class="text-emerald-500">· 已有产物</span>
                </p>
              </div>
              <button
                type="button"
                class="text-[11px] sb-text-muted hover:sb-text-primary transition-colors flex-shrink-0"
                @click="resumeWorkspace(item.taskId)"
              >
                打开
              </button>
              <button
                type="button"
                class="sb-text-faint hover:text-red-500 transition-colors flex-shrink-0"
                title="删除工作区"
                @click="deleteWorkspace(item.taskId)"
              >
                <Trash2 class="w-3.5 h-3.5" :stroke-width="1.5" />
              </button>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="step === 2">
        <div class="py-6 space-y-4">
          <div class="flex items-center gap-2.5">
            <Loader2 class="w-4 h-4 text-[var(--sb-accent-solid)] animate-spin" :stroke-width="1.5" />
            <span class="text-[13px] sb-text-primary">{{ progress?.message ?? '正在处理仓库' }}</span>
            <span class="ml-auto text-[11px] sb-text-faint">{{ phaseLabel }}</span>
          </div>
          <div class="h-1.5 rounded-full sb-bg-inset overflow-hidden">
            <div
              class="h-full bg-[var(--sb-accent-solid)] transition-all duration-300"
              :style="{ width: `${Math.max(progressPercent, 4)}%` }"
            />
          </div>
          <div v-if="progress?.totalBytes" class="flex items-center justify-between text-[11px] sb-text-faint">
            <span>{{ formatBytes(progress.downloadedBytes ?? 0) }}</span>
            <span>{{ formatBytes(progress.totalBytes) }}</span>
          </div>
          <p class="text-[11px] sb-text-faint leading-relaxed">
            拉取完成后会立刻分析仓库结构并生成转换工作区，不会自动执行仓库中的任何代码。
          </p>
        </div>
      </template>

      <template v-else-if="workspace && profile">
        <div class="flex items-start gap-3 px-3.5 py-3 rounded-lg border sb-border-subtle sb-bg-inset">
          <div class="min-w-0 flex-1">
            <p class="text-[13px] sb-text-primary font-mono truncate">
              {{ profile.ref.owner }}/{{ profile.ref.repo }}
            </p>
            <p class="text-[11px] sb-text-faint mt-0.5">
              {{ profile.resolvedRef }} · {{ profile.fileCount }} 个文件 · {{ formatBytes(profile.totalBytes) }}
              · {{ profile.license ?? '未发现许可证' }}
            </p>
            <p class="text-[11px] sb-text-faint mt-0.5 font-mono">
              {{ profile.fetchMethod === 'git' ? 'git clone' : '归档 zip' }}<template
                v-if="profile.commitSha"
              > · {{ profile.commitSha.slice(0, 8) }}</template>
            </p>
          </div>
          <div v-if="convertibilityMeta" class="flex items-center gap-1.5 flex-shrink-0">
            <ShieldAlert
              v-if="convertibilityMeta.warn"
              class="w-3.5 h-3.5"
              :class="convertibilityMeta.tone"
              :stroke-width="1.5"
            />
            <CheckCircle2 v-else class="w-3.5 h-3.5" :class="convertibilityMeta.tone" :stroke-width="1.5" />
            <span class="text-[12px] font-medium" :class="convertibilityMeta.tone">
              {{ convertibilityMeta.label }}
            </span>
          </div>
        </div>

        <div class="px-3.5 py-2.5 rounded-lg border sb-border-subtle">
          <p class="text-[12px] sb-text-secondary leading-relaxed">{{ profile.convertibilityReason }}</p>
        </div>

        <div class="grid grid-cols-2 gap-x-5 gap-y-2 text-[12px]">
          <div class="flex justify-between gap-3 border-b sb-border-subtle py-1.5">
            <span class="sb-text-faint flex-shrink-0">主要语言</span>
            <span class="sb-text-primary truncate text-right">{{ languageSummary() || '未知' }}</span>
          </div>
          <div class="flex justify-between gap-3 border-b sb-border-subtle py-1.5">
            <span class="sb-text-faint flex-shrink-0">依赖清单</span>
            <span class="sb-text-primary truncate text-right">{{ profile.manifests.join('、') || '无' }}</span>
          </div>
          <div class="flex justify-between gap-3 border-b sb-border-subtle py-1.5">
            <span class="sb-text-faint flex-shrink-0">入口候选</span>
            <span class="sb-text-primary truncate text-right">{{ profile.entryCandidates.join('、') || '无' }}</span>
          </div>
          <div class="flex justify-between gap-3 border-b sb-border-subtle py-1.5">
            <span class="sb-text-faint flex-shrink-0">运行期依赖</span>
            <span class="sb-text-primary truncate text-right">{{ profile.runtimeDependencies.length }} 个</span>
          </div>
        </div>

        <div v-if="profile.risks.length" class="px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-1">
          <p class="text-[11px] font-medium text-amber-600">风险提示</p>
          <p v-for="risk in profile.risks" :key="risk" class="text-[11px] text-amber-600/90 leading-relaxed">
            · {{ risk }}
          </p>
        </div>

        <div class="flex items-center gap-1 p-0.5 rounded-lg sb-bg-inset border sb-border-subtle">
          <button
            type="button"
            class="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md text-[12px] transition-colors"
            :class="engine === 'agent' ? 'sb-bg-surface sb-text-primary font-medium' : 'sb-text-muted hover:sb-text-primary'"
            @click="engine = 'agent'"
          >
            <Bot class="w-3.5 h-3.5" :stroke-width="1.5" />
            Agent 交接
          </button>
          <button
            type="button"
            class="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md text-[12px] transition-colors"
            :class="engine === 'llm' ? 'sb-bg-surface sb-text-primary font-medium' : 'sb-text-muted hover:sb-text-primary'"
            @click="engine = 'llm'"
          >
            <Cpu class="w-3.5 h-3.5" :stroke-width="1.5" />
            内置 LLM 转换
          </button>
        </div>

        <template v-if="engine === 'agent'">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <span class="text-[11px] font-medium sb-text-faint uppercase tracking-wider">交接提示词</span>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="flex items-center gap-1 text-[11px] sb-text-muted hover:sb-text-primary transition-colors"
                  @click="copyPrompt"
                >
                  <Copy class="w-3 h-3" :stroke-width="1.5" />
                  复制
                </button>
                <button
                  type="button"
                  class="flex items-center gap-1 text-[11px] sb-text-muted hover:sb-text-primary transition-colors"
                  @click="openFolder('root')"
                >
                  <FolderOpen class="w-3 h-3" :stroke-width="1.5" />
                  打开工作区
                </button>
              </div>
            </div>
            <pre
              class="px-3 py-2.5 rounded-lg sb-bg-inset border sb-border-subtle text-[11px] sb-text-secondary leading-relaxed whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto"
            >{{ workspace.handoffPrompt }}</pre>
            <p class="text-[11px] sb-text-faint leading-relaxed">
              把提示词粘贴给已接入 MCP 的 Agent（Codex / Claude / Cursor），它会读取
              <code class="font-mono">.autoforge/HANDOFF.md</code> 并产出脚本包；产物就绪后点下方「重新检测」。
            </p>
          </div>
        </template>

        <template v-else>
          <div v-if="llmProfiles.length === 0" class="px-3.5 py-3 rounded-lg border sb-border-subtle space-y-2">
            <p class="text-[12px] sb-text-secondary">还没有配置模型，无法使用内置转换。</p>
            <p class="text-[11px] sb-text-faint leading-relaxed">
              请到「设置 → 模型」添加一个 OpenAI 兼容接口配置（如 DeepSeek、通义千问、智谱）。
            </p>
          </div>

          <template v-else>
            <div class="space-y-2">
              <label class="text-[11px] font-medium sb-text-faint uppercase tracking-wider" for="llm-profile">
                使用的模型
              </label>
              <select
                id="llm-profile"
                v-model="selectedProfileId"
                class="w-full h-8 px-2.5 text-[12px] sb-input border rounded-lg outline-none"
                :disabled="converting"
              >
                <option v-for="item in llmProfiles" :key="item.id" :value="item.id">
                  {{ item.name }} · {{ item.model }}{{ item.hasApiKey ? '' : '（缺少 Key）' }}
                </option>
              </select>
              <p v-if="selectedProfile && !selectedProfile.hasApiKey" class="text-[11px] text-rose-500">
                该配置还没有填写 API Key，请先到「设置 → 模型」补充。
              </p>
            </div>

            <div v-if="turns.length" class="space-y-2 max-h-56 overflow-y-auto">
              <div
                v-for="turn in turns"
                :key="turn.id"
                class="px-3 py-2 rounded-lg border sb-border-subtle space-y-1"
              >
                <p class="text-[11px] sb-text-faint">{{ turn.role === 'user' ? '你' : '助手' }}</p>
                <p class="text-[12px] sb-text-primary whitespace-pre-wrap break-all">
                  {{
                    turn.content ||
                    (turn.status === 'running' ? '正在转换…' : turn.status === 'cancelled' ? '已取消' : '')
                  }}
                </p>
                <p v-if="turn.status === 'error' && turn.error" class="text-[11px] text-rose-500">
                  {{ turn.error }}
                </p>
                <details v-if="turn.thinking">
                  <summary class="text-[11px] sb-text-muted cursor-pointer">思考过程</summary>
                  <pre
                    class="mt-1 px-2 py-1.5 rounded-md sb-bg-inset text-[11px] sb-text-secondary whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto"
                  >{{ turn.thinking }}</pre>
                </details>
              </div>
            </div>

            <div v-if="converting || conversionLogs.length" class="space-y-2">
              <div class="flex items-center gap-2.5">
                <Loader2
                  v-if="converting"
                  class="w-3.5 h-3.5 text-[var(--sb-accent-solid)] animate-spin"
                  :stroke-width="1.5"
                />
                <Terminal v-else class="w-3.5 h-3.5 sb-text-faint" :stroke-width="1.5" />
                <span class="text-[12px] sb-text-primary">
                  {{ converting ? (progress?.message ?? '正在转换') : '转换日志' }}
                </span>
                <span class="ml-auto text-[11px] sb-text-faint">{{ phaseLabel }}</span>
              </div>
              <div
                ref="logContainer"
                class="max-h-44 overflow-y-auto px-3 py-2 rounded-lg sb-bg-log border sb-border-subtle font-mono text-[11px] leading-relaxed space-y-0.5"
              >
                <p v-for="(line, index) in conversionLogs" :key="index" :class="logTone(line.level)">
                  {{ line.message }}
                </p>
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-[11px] sb-text-faint" for="llm-instruction">
                {{ hasUserTurn ? '新的要求' : '要求（可留空）' }}
              </label>
              <textarea
                id="llm-instruction"
                v-model="instruction"
                rows="2"
                class="w-full px-2.5 py-2 text-[12px] sb-input border rounded-lg outline-none resize-none"
                :placeholder="hasUserTurn ? '写下要改的地方，会按整段对话重新生成脚本包' : '例如：只保留导出 CSV 的功能；把接口地址做成环境变量'"
                :disabled="converting"
              />
            </div>

            <div
              v-if="allowBuildGlobally"
              class="px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-2"
            >
              <label class="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="mt-0.5 flex-shrink-0"
                  :checked="allowBuildThisRun"
                  :disabled="converting"
                  @change="allowBuildThisRun = ($event.target as HTMLInputElement).checked"
                />
                <span class="min-w-0">
                  <span class="block text-[12px] text-amber-600 font-medium">本次允许执行构建命令</span>
                  <span class="block text-[11px] text-amber-600/90 leading-relaxed mt-0.5">
                    仓库需要构建时，会在 <code class="font-mono">repo/</code> 中执行依赖安装与构建，
                    等于运行仓库作者编写的代码。请仅对可信仓库勾选。
                  </span>
                </span>
              </label>
            </div>
            <div v-else class="px-3.5 py-2.5 rounded-lg border sb-border-subtle">
              <p class="text-[11px] sb-text-faint leading-relaxed">
                构建授权未开启。若仓库需要构建，模型给出的构建命令会被跳过，产物可能无法直接运行。
                可在「设置 → 模型 → 构建授权」中开启。
              </p>
            </div>

            <div
              v-if="conversionResult"
              class="px-3.5 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 space-y-1"
            >
              <p class="text-[12px] text-emerald-600 font-medium">{{ conversionResult.plan.summary }}</p>
              <p class="text-[11px] text-emerald-600/90 leading-relaxed">
                共写入 {{ conversionResult.writtenFiles }} 个文件
                <template v-if="conversionResult.copiedEntries">
                  · 从仓库复制 {{ conversionResult.copiedEntries }} 个条目
                </template>
                <template v-if="conversionResult.executedBuildCommands.length">
                  · 已执行 {{ conversionResult.executedBuildCommands.length }} 条构建命令
                </template>
                <template v-else-if="plannedBuildCommands.length"> · 构建命令未执行（未授权）</template>
              </p>
              <p v-if="conversionResult.plan.notes" class="text-[11px] text-emerald-600/90 leading-relaxed">
                {{ conversionResult.plan.notes }}
              </p>
            </div>
          </template>
        </template>
      </template>
    </div>

    <div class="flex items-center justify-between gap-3 px-5 py-3 border-t sb-border-subtle flex-shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <button
          v-if="workspace"
          type="button"
          class="text-[12px] sb-text-muted hover:sb-text-primary transition-colors disabled:opacity-40"
          :disabled="busy || importing || converting"
          @click="onReset"
        >
          重新开始
        </button>
        <button
          v-if="workspace"
          type="button"
          class="flex items-center gap-1 text-[12px] sb-text-muted hover:sb-text-primary transition-colors disabled:opacity-40"
          :disabled="busy || importing || converting"
          @click="openFolder('package')"
        >
          <FolderOpen class="w-3 h-3" :stroke-width="1.5" />
          打开产物目录
        </button>
        <button
          v-if="workspace && engine === 'llm' && llmProfiles.length === 0"
          type="button"
          class="text-[12px] sb-text-muted hover:sb-text-primary transition-colors"
          @click="openSettings"
        >
          去设置模型
        </button>
      </div>

      <div class="flex items-center gap-2 flex-shrink-0">
        <template v-if="step === 1">
          <button
            type="button"
            class="flex items-center gap-1.5 h-8 px-4 rounded-lg sb-btn-accent text-[12px] font-medium transition-colors disabled:opacity-40"
            :disabled="!canSubmit"
            @click="startFetch"
          >
            <Download class="w-3.5 h-3.5" :stroke-width="1.5" />
            拉取仓库
          </button>
        </template>
        <template v-else-if="workspace && engine === 'agent' && step === 3">
          <button
            type="button"
            class="flex items-center gap-1.5 h-8 px-3 rounded-lg border sb-border text-[12px] sb-text-secondary hover:sb-text-primary transition-colors"
            @click="recheckPackage"
          >
            <RefreshCw class="w-3.5 h-3.5" :stroke-width="1.5" />
            重新检测
          </button>
        </template>
        <template v-else-if="workspace && engine === 'llm'">
          <button
            v-if="converting"
            type="button"
            class="flex items-center gap-1.5 h-8 px-4 rounded-lg border sb-border text-[12px] sb-text-secondary hover:sb-text-primary transition-colors"
            @click="cancelLlmConversion"
          >
            取消
          </button>
          <button
            v-else
            type="button"
            class="flex items-center gap-1.5 h-8 px-4 rounded-lg sb-btn-accent text-[12px] font-medium transition-colors disabled:opacity-40"
            :disabled="!canConvert"
            @click="startLlmConversion"
          >
            <Play class="w-3.5 h-3.5" :stroke-width="1.5" />
            {{ sendLabel }}
          </button>
          <button
            v-if="step === 4 && !converting"
            type="button"
            class="flex items-center gap-1.5 h-8 px-4 rounded-lg sb-btn-accent text-[12px] font-medium transition-colors disabled:opacity-40"
            :disabled="importing"
            @click="onImport"
          >
            <Loader2 v-if="importing" class="w-3.5 h-3.5 animate-spin" :stroke-width="1.5" />
            <FileJson v-else class="w-3.5 h-3.5" :stroke-width="1.5" />
            导入并试运行
          </button>
        </template>
        <template v-else-if="step === 4">
          <button
            type="button"
            class="flex items-center gap-1.5 h-8 px-4 rounded-lg sb-btn-accent text-[12px] font-medium transition-colors disabled:opacity-40"
            :disabled="importing"
            @click="onImport"
          >
            <Loader2 v-if="importing" class="w-3.5 h-3.5 animate-spin" :stroke-width="1.5" />
            <FileJson v-else class="w-3.5 h-3.5" :stroke-width="1.5" />
            导入并试运行
          </button>
        </template>
      </div>
    </div>
  </AppFeatureModal>
</template>
