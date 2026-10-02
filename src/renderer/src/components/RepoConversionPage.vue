<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  FolderOpen,
  GitBranch,
  Loader2,
  Play
} from 'lucide-vue-next'
import type { ScriptItem } from '../../../shared/types/script'
import type { ConversionFileChange, ConversionTurn } from '../../../shared/conversion-conversation'
import { useRepoImport } from '../composables/useRepoImport'

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
  instruction,
  converting,
  conversionLogs,
  turns,
  llmProfiles,
  selectedProfileId,
  selectedProfile,
  allowBuildGlobally,
  allowBuildThisRun,
  canConvert,
  canSubmit,
  loadHistory,
  loadLlmProfiles,
  startFetch,
  importLocalPaths,
  pickLocal,
  resumeWorkspace,
  startLlmConversion,
  cancelLlmConversion,
  importPackage,
  openFolder,
  renameWorkspace,
  deleteWorkspace
} = useRepoImport()

const pulling = ref(false)
const localDropRef = ref<HTMLElement | null>(null)
const historyReady = ref(false)
const threadRef = ref<HTMLElement | null>(null)
const composerRef = ref<HTMLTextAreaElement | null>(null)
const workspaceMenu = ref<{ taskId: string; x: number; y: number } | null>(null)
const openThinking = ref<Record<string, boolean>>({})

const repoLabel = computed(() => {
  const profile = workspace.value?.profile
  if (!profile) return ''
  return (
    profile.alias?.trim() ||
    (profile.ref.provider === 'local' ? profile.ref.repo : `${profile.ref.owner}/${profile.ref.repo}`)
  )
})

const repoIdentity = computed(() => {
  const profile = workspace.value?.profile
  if (!profile) return ''
  return `${profile.ref.owner}/${profile.ref.repo}`
})

const hasUserTurn = computed(() => turns.value.some((turn) => turn.role === 'user'))
const sendLabel = computed(() => (hasUserTurn.value ? '发送' : '开始转换'))

function kindLabel(kind: ConversionFileChange['kind']): string {
  if (kind === 'copy') return '复制'
  if (kind === 'manifest') return '清单'
  return '新增'
}

function turnProse(turn: ConversionTurn): string {
  const text = turn.changes?.length
    ? turn.content
        .split('\n')
        .filter((line) => !line.startsWith('写入文件：'))
        .join('\n')
        .trim()
    : turn.content.trim()
  if (turn.role === 'user' && !text) return '按仓库现状直接转换'
  if (turn.role === 'assistant' && !text && turn.status === 'running') return '正在阅读仓库并生成脚本包'
  return text
}

function onThinkingToggle(id: string, event: Event): void {
  const open = event.target instanceof HTMLDetailsElement && event.target.open
  openThinking.value = { ...openThinking.value, [id]: open }
}

function statusLabel(turn: ConversionTurn): string {
  if (turn.status === 'running') return '进行中'
  if (turn.status === 'cancelled') return '已取消'
  if (turn.status === 'error') return '未完成'
  return '完成'
}

function logTone(level: 'INFO' | 'WARN' | 'ERROR'): string {
  if (level === 'ERROR') return 'log-error'
  if (level === 'WARN') return 'log-warn'
  return ''
}

function openPull(): void {
  if (busy.value || converting.value) return
  pulling.value = true
  error.value = null
}

async function submitPull(): Promise<void> {
  await startFetch()
  if (workspace.value && !error.value) pulling.value = false
}

async function submitLocal(paths: string[]): Promise<void> {
  await importLocalPaths(paths)
  if (workspace.value && !error.value) pulling.value = false
}

function onLocalDrop(event: Event): void {
  const paths = (event as CustomEvent<string[]>).detail
  if (!Array.isArray(paths) || !paths.length) return
  void submitLocal(paths)
}

async function openWorkspace(taskId: string): Promise<void> {
  if (busy.value || converting.value) return
  pulling.value = false
  await resumeWorkspace(taskId)
  await nextTick()
  composerRef.value?.focus()
}

async function onImport(): Promise<void> {
  const script = await importPackage()
  if (script) emit('imported', script)
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  if (!canConvert.value) return
  event.preventDefault()
  void startLlmConversion()
}

function workspaceTitle(item: { alias?: string; repo: string }): string {
  return item.alias?.trim() || item.repo
}

function openWorkspaceMenu(taskId: string, event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  const menuWidth = 148
  const menuHeight = 76
  workspaceMenu.value = {
    taskId,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
  }
}

function closeWorkspaceMenu(): void {
  workspaceMenu.value = null
}

function onPageKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeWorkspaceMenu()
}

async function renameFromMenu(taskId: string): Promise<void> {
  closeWorkspaceMenu()
  await renameWorkspace(taskId)
}

async function deleteFromMenu(taskId: string): Promise<void> {
  closeWorkspaceMenu()
  await deleteWorkspace(taskId)
}

function closePage(): void {
  if (busy.value || importing.value || converting.value) return
  emit('close')
}

async function refreshWorkspaces(): Promise<void> {
  await loadHistory()
  historyReady.value = true
  await loadLlmProfiles()
}

watch(localDropRef, (element, _previous, onCleanup) => {
  if (!element) return
  const unbind = window.autoforge.files.bindPathDropZone(element)
  element.addEventListener('autoforge-local-import', onLocalDrop)
  onCleanup(() => {
    unbind()
    element.removeEventListener('autoforge-local-import', onLocalDrop)
  })
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    void refreshWorkspaces()
  }
)

watch(
  () => [turns.value.length, conversionLogs.value.length, converting.value] as const,
  async () => {
    await nextTick()
    const thread = threadRef.value
    if (thread) thread.scrollTop = thread.scrollHeight
  }
)

onMounted(() => {
  document.addEventListener('keydown', onPageKeydown)
  if (props.open) void refreshWorkspaces()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onPageKeydown)
})
</script>

<template>
  <div v-if="open" class="forge-page" @click="closeWorkspaceMenu">
    <header class="forge-top">
      <button type="button" class="forge-icon" aria-label="返回" title="返回" @click="closePage">
        <ArrowLeft :size="17" :stroke-width="1.5" />
      </button>
      <div class="forge-brand">
        <span class="forge-kicker">WORKSPACE</span>
        <h1>仓库转换</h1>
      </div>
      <button
        v-if="workspace?.packageReady && !converting"
        type="button"
        class="forge-import"
        :disabled="importing"
        @click="onImport"
      >
        <Loader2 v-if="importing" class="spin" :size="14" />
        <span v-else>导入到脚本列表</span>
      </button>
    </header>

    <div class="forge-body">
      <aside class="forge-rail" aria-label="工作区">
        <div class="forge-rail-head">
          <span>工作区</span>
          <button type="button" :disabled="busy || converting" @click="openPull">新建</button>
        </div>
        <p v-if="!history.length" class="forge-rail-empty">还没有工作区。</p>
        <ul v-else class="forge-list">
          <li v-for="item in history" :key="item.taskId" @contextmenu="openWorkspaceMenu(item.taskId, $event)">
            <button
              type="button"
              class="forge-item"
              :class="{ active: workspace?.taskId === item.taskId && !pulling }"
              :title="item.alias ? item.repo : '右键可以设置别名或删除'"
              @click="openWorkspace(item.taskId)"
            >
              <span class="forge-item-name">{{ workspaceTitle(item) }}</span>
              <span class="forge-item-meta">
                {{ item.alias ? item.repo : item.resolvedRef }}
                <template v-if="item.alias"> · {{ item.resolvedRef }}</template>
                <em v-if="item.packageReady">可导入</em>
                <em v-if="converting && workspace?.taskId === item.taskId" class="live">转换中</em>
              </span>
            </button>
          </li>
        </ul>
        <p class="forge-rail-note">删除工作区时，这里的副本会一起删除，原来的文件夹不会动。已经导入的脚本会留在列表里。</p>
      </aside>

      <main class="forge-main">
        <section v-if="!historyReady && !workspace" class="forge-blank">
          <p>正在读取工作区…</p>
        </section>

        <form v-else-if="pulling || (!workspace && !history.length)" class="forge-pull" @submit.prevent="submitPull">
          <p class="forge-kicker">NEW REPO</p>
          <h2>拉取一个仓库</h2>
          <p class="forge-lead">
            支持 GitHub、Gitee，也可以从本机放入文件夹或文件。内容会放进这个工作区，转换对话和脚本包都留在这里。
          </p>
          <label for="forge-url">仓库地址</label>
          <input
            id="forge-url"
            v-model="url"
            type="text"
            placeholder="https://github.com/owner/repo"
            :disabled="busy"
            required
          />
          <button type="button" class="forge-advanced" @click="showAdvanced = !showAdvanced">
            {{ showAdvanced ? '收起分支和令牌' : '分支 / 私有仓库' }}
          </button>
          <div v-if="showAdvanced" class="forge-advanced-fields">
            <label for="forge-branch">分支</label>
            <input id="forge-branch" v-model="branch" type="text" placeholder="默认分支" :disabled="busy" />
            <label for="forge-token">访问令牌</label>
            <input
              id="forge-token"
              v-model="token"
              type="password"
              placeholder="仅本次使用，不保存"
              :disabled="busy"
            />
          </div>
          <p v-if="busy" class="forge-status">{{ progress?.message ?? '正在拉取仓库' }}</p>
          <p v-if="error" class="forge-error">{{ error }}</p>
          <div
            ref="localDropRef"
            class="forge-local"
            :aria-disabled="busy ? 'true' : 'false'"
          >
            <p class="forge-local-title">或从本机放入</p>
            <p class="forge-local-hint">把文件夹或文件拖到这里</p>
            <div class="forge-local-actions">
              <button type="button" class="forge-ghost" :disabled="busy" @click="pickLocal('directory')">选择文件夹</button>
              <button type="button" class="forge-ghost" :disabled="busy" @click="pickLocal('files')">选择文件</button>
            </div>
          </div>
          <div class="forge-pull-actions">
            <button v-if="history.length" type="button" class="forge-ghost" :disabled="busy" @click="pulling = false">
              返回
            </button>
            <button type="submit" class="forge-send" :disabled="!canSubmit">
              <Loader2 v-if="busy" class="spin" :size="14" />
              <GitBranch v-else :size="14" :stroke-width="1.5" />
              拉取
            </button>
          </div>
        </form>

        <section v-else-if="!workspace" class="forge-blank">
          <GitBranch :size="22" :stroke-width="1.5" />
          <h2>选择一个工作区</h2>
          <p>左侧是已经放进来的工作区。打开后可以继续对话，让模型按你的要求重做脚本包。</p>
        </section>

        <section v-else class="forge-chat">
          <header class="forge-chat-head">
            <div>
              <h2>{{ repoLabel }}</h2>
              <p>
                <template v-if="workspace.profile.ref.provider === 'local'">
                  本地目录 · {{ workspace.profile.ref.url || '多个位置' }}
                  · {{ workspace.profile.convertibilityReason }}
                </template>
                <template v-else>
                  <template v-if="workspace.profile.alias">{{ repoIdentity }} · </template>
                  {{ workspace.profile.resolvedRef }}
                  · {{ workspace.profile.convertibilityReason }}
                </template>
              </p>
            </div>
            <div class="forge-chat-tools">
              <button type="button" @click="openFolder('repo')">
                <FolderOpen :size="13" :stroke-width="1.5" />
                仓库
              </button>
              <button type="button" @click="openFolder('package')">
                <FolderOpen :size="13" :stroke-width="1.5" />
                产物
              </button>
            </div>
          </header>

          <div ref="threadRef" class="forge-thread">
            <article v-if="!turns.length" class="forge-welcome">
              <p>这个仓库还没有转换过。直接开始，或先写明你要留下的能力。</p>
            </article>

            <article
              v-for="turn in turns"
              :key="turn.id"
              class="forge-turn"
              :class="[turn.role, turn.status]"
            >
              <header>
                <span>{{ turn.role === 'user' ? '你' : '转换' }}</span>
                <em v-if="turn.role === 'assistant'">{{ statusLabel(turn) }}</em>
              </header>
              <p class="forge-prose">{{ turnProse(turn) }}</p>
              <p v-if="turn.status === 'error' && turn.error" class="forge-error">{{ turn.error }}</p>
              <details v-if="turn.thinking" @toggle="onThinkingToggle(turn.id, $event)">
                <summary>思考过程</summary>
                <pre v-if="openThinking[turn.id]">{{ turn.thinking }}</pre>
              </details>
              <div v-if="turn.changes?.length" class="forge-changes">
                <p>修改点 · {{ turn.changes.length }} 个文件</p>
                <ul>
                  <li v-for="change in turn.changes" :key="`${turn.id}-${change.path}`">
                    <span class="kind" :data-kind="change.kind">{{ kindLabel(change.kind) }}</span>
                    <code>{{ change.path }}</code>
                    <span class="note">{{ change.note }}</span>
                    <span v-if="change.lines" class="lines">+{{ change.lines }}</span>
                  </li>
                </ul>
              </div>
            </article>

            <div v-if="converting || conversionLogs.length" class="forge-logs">
              <p>
                <Loader2 v-if="converting" class="spin" :size="13" />
                {{ converting ? (progress?.message ?? '正在转换') : '最近一次日志' }}
              </p>
              <pre><span v-for="(line, index) in conversionLogs" :key="index" :class="logTone(line.level)">{{ line.message + '\n' }}</span></pre>
            </div>
          </div>

          <form class="forge-composer" @submit.prevent="startLlmConversion">
            <p v-if="error" class="forge-error">{{ error }}</p>
            <textarea
              ref="composerRef"
              v-model="instruction"
              rows="3"
              :disabled="converting"
              :placeholder="hasUserTurn ? '写下要改的地方。Enter 发送，Shift+Enter 换行' : '可选：只保留导出，或把地址做成环境变量'"
              @keydown="onComposerKeydown"
            />
            <div class="forge-composer-bar">
              <label v-if="llmProfiles.length" class="forge-model">
                <span>模型</span>
                <select v-model="selectedProfileId" :disabled="converting">
                  <option v-for="item in llmProfiles" :key="item.id" :value="item.id">
                    {{ item.name }} · {{ item.model }}{{ item.hasApiKey ? '' : '（缺 Key）' }}
                  </option>
                </select>
              </label>
              <p v-else class="forge-hint">先到设置里添加一个模型配置。</p>
              <p v-if="selectedProfile && !selectedProfile.hasApiKey" class="forge-error">这个配置还没有 API Key。</p>
              <label v-if="allowBuildGlobally" class="forge-build">
                <input v-model="allowBuildThisRun" type="checkbox" :disabled="converting" />
                允许构建
              </label>
              <span class="forge-spacer" />
              <button v-if="converting" type="button" class="forge-ghost" @click="cancelLlmConversion">取消</button>
              <button v-else type="submit" class="forge-send" :disabled="!canConvert">
                <Play :size="13" :stroke-width="1.5" />
                {{ sendLabel }}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>

    <div
      v-if="workspaceMenu"
      class="forge-menu"
      :style="{ left: `${workspaceMenu.x}px`, top: `${workspaceMenu.y}px` }"
      @click.stop
    >
      <button type="button" @click="renameFromMenu(workspaceMenu.taskId)">设置别名</button>
      <button
        type="button"
        class="danger"
        :disabled="converting && workspace?.taskId === workspaceMenu.taskId"
        @click="deleteFromMenu(workspaceMenu.taskId)"
      >
        删除工作区
      </button>
    </div>
  </div>
</template>

<style scoped>
.forge-page {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: var(--sb-bg-panel);
  color: var(--sb-text-primary);
}

.forge-top,
.forge-rail-head,
.forge-chat-head,
.forge-composer-bar,
.forge-pull-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.forge-top {
  height: 50px;
  padding: 0 14px 0 8px;
  border-bottom: 1px solid var(--sb-border-subtle);
  flex: 0 0 auto;
}

.forge-local {
  margin-top: 16px;
  padding: 12px;
  border: 1px dashed var(--sb-border-subtle);
  border-radius: 10px;
  background: var(--sb-bg-inset);
}

.forge-local[aria-disabled='true'] {
  opacity: 0.55;
}

.forge-local.is-local-import-target {
  border-color: var(--sb-accent-solid);
}

.forge-local-title,
.forge-local-hint {
  margin: 0;
}

.forge-local-title {
  font-size: 11px;
  color: var(--sb-text-faint);
}

.forge-local-hint {
  margin-top: 4px;
  color: var(--sb-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.forge-local-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.forge-local-actions .forge-ghost {
  appearance: none;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--sb-border-subtle);
  border-radius: 8px;
  background: var(--sb-bg-panel);
  color: var(--sb-text-secondary);
  font: inherit;
  font-size: 12px;
}

.forge-local-actions .forge-ghost:hover {
  border-color: color-mix(in srgb, var(--sb-accent-solid) 45%, var(--sb-border-subtle));
  background: var(--sb-bg-panel);
  color: var(--sb-text-primary);
}

.forge-local-actions .forge-ghost:disabled {
  opacity: 0.45;
  cursor: default;
}

.forge-icon,
.forge-rail-head button,
.forge-chat-tools button,
.forge-ghost,
.forge-advanced {
  border: 0;
  background: transparent;
  color: var(--sb-text-muted);
  cursor: pointer;
}

.forge-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
}

.forge-icon:hover,
.forge-rail-head button:hover,
.forge-chat-tools button:hover,
.forge-ghost:hover,
.forge-advanced:hover {
  color: var(--sb-text-primary);
  background: var(--sb-bg-hover);
}

.forge-brand {
  min-width: 0;
}

.forge-brand h1,
.forge-pull h2,
.forge-blank h2,
.forge-chat-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.forge-kicker {
  display: block;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--sb-text-faint);
}

.forge-import,
.forge-send {
  border: 0;
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--sb-accent-solid);
  color: white;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.forge-import {
  margin-left: auto;
}

.forge-import:disabled,
.forge-send:disabled,
.forge-rail-head button:disabled,
.forge-menu button:disabled {
  opacity: 0.45;
  cursor: default;
}

.forge-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
}

.forge-rail {
  border-right: 1px solid var(--sb-border-subtle);
  background: color-mix(in srgb, var(--sb-bg-inset) 55%, var(--sb-bg-panel));
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px;
}

.forge-rail-head {
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sb-text-faint);
}

.forge-rail-head button,
.forge-advanced,
.forge-ghost,
.forge-chat-tools button {
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
}

.forge-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.forge-list li {
  display: flex;
  align-items: stretch;
  gap: 2px;
}

.forge-item {
  flex: 1;
  min-width: 0;
  text-align: left;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  padding: 8px 8px 8px 10px;
  cursor: pointer;
}

.forge-item.active {
  background: color-mix(in srgb, var(--sb-accent-solid) 10%, var(--sb-bg-panel));
  box-shadow: inset 2px 0 0 var(--sb-accent-solid);
}

.forge-item-name,
.forge-item-meta {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forge-item-name {
  font-family: var(--font-mono);
  font-size: 12px;
}

.forge-item-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--sb-text-faint);
}

.forge-item-meta em {
  font-style: normal;
  margin-left: 6px;
  color: var(--color-emerald-500, #10b981);
}

.forge-item-meta .live {
  color: var(--sb-accent-solid);
}

.forge-menu {
  position: fixed;
  z-index: 80;
  min-width: 140px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--sb-border);
  background: var(--sb-bg-panel);
  box-shadow: 0 12px 32px color-mix(in srgb, black 18%, transparent);
}

.forge-menu button {
  display: block;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--sb-text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.forge-menu button:hover {
  background: var(--sb-bg-hover);
}

.forge-menu button.danger {
  color: var(--color-rose-500, #f43f5e);
}

.forge-rail-empty,
.forge-rail-note,
.forge-lead,
.forge-chat-head p,
.forge-blank p,
.forge-welcome p,
.forge-hint {
  color: var(--sb-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.forge-rail-note {
  margin-top: auto;
  padding-top: 12px;
  color: var(--sb-text-faint);
  font-size: 11px;
}

.forge-main {
  min-width: 0;
  min-height: 0;
  display: flex;
}

.forge-pull,
.forge-blank {
  width: min(460px, calc(100% - 64px));
  margin: auto;
}

.forge-pull label,
.forge-model span {
  display: block;
  margin: 14px 0 6px;
  font-size: 11px;
  color: var(--sb-text-faint);
}

.forge-pull input,
.forge-composer textarea,
.forge-model select {
  width: 100%;
  border: 1px solid var(--sb-border-subtle);
  background: var(--sb-bg-inset);
  color: var(--sb-text-primary);
  border-radius: 8px;
  outline: none;
}

.forge-pull input,
.forge-model select {
  height: 34px;
  padding: 0 10px;
  font-size: 13px;
}

.forge-pull input:focus,
.forge-composer textarea:focus,
.forge-model select:focus {
  border-color: color-mix(in srgb, var(--sb-accent-solid) 55%, var(--sb-border-subtle));
}

.forge-lead {
  margin: 8px 0 4px;
}

.forge-advanced {
  margin-top: 10px;
  padding-left: 0;
}

.forge-status {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--sb-text-secondary);
}

.forge-error {
  margin: 8px 0 0;
  color: var(--color-rose-500, #f43f5e);
  font-size: 12px;
}

.forge-pull-actions {
  margin-top: 16px;
  justify-content: flex-end;
}

.forge-blank {
  text-align: left;
  color: var(--sb-text-muted);
}

.forge-blank svg {
  color: var(--sb-accent-solid);
}

.forge-chat {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.forge-chat-head {
  justify-content: space-between;
  gap: 16px;
  padding: 14px 22px 10px;
  align-items: flex-start;
}

.forge-chat-head p {
  margin: 3px 0 0;
}

.forge-chat-tools {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
}

.forge-chat-tools button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.forge-turn details pre,
.forge-logs pre {
  margin: 0;
  max-width: 100%;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
}

.forge-thread {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 8px 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.forge-welcome {
  margin-top: 12px;
}

.forge-turn {
  width: min(760px, 100%);
  min-width: 0;
  max-width: 100%;
}

.forge-turn.user {
  align-self: flex-end;
  width: min(560px, 86%);
  padding: 10px 12px;
  border-radius: 12px 12px 4px 12px;
  background: color-mix(in srgb, var(--sb-accent-solid) 8%, var(--sb-bg-inset));
}

.forge-turn header {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--sb-text-faint);
}

.forge-turn header em {
  font-style: normal;
}

.forge-turn.running header em {
  color: var(--sb-accent-solid);
}

.forge-turn.error header em,
.forge-turn.cancelled header em {
  color: var(--color-rose-500, #f43f5e);
}

.forge-prose {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.forge-turn details {
  margin-top: 8px;
}

.forge-turn summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--sb-text-muted);
}

.forge-turn details pre {
  margin-top: 6px;
  max-height: 180px;
  overflow: auto;
  min-width: 0;
  contain: inline-size;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--sb-bg-inset);
  color: var(--sb-text-secondary);
}

.forge-changes {
  margin-top: 10px;
  border: 1px solid var(--sb-border-subtle);
  border-radius: 10px;
  overflow: hidden;
  background: var(--sb-bg-surface, var(--sb-bg-panel));
}

.forge-changes > p {
  margin: 0;
  padding: 7px 10px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--sb-text-faint);
  border-bottom: 1px solid var(--sb-border-subtle);
}

.forge-changes ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.forge-changes li {
  display: grid;
  grid-template-columns: 42px minmax(120px, 1.1fr) minmax(80px, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 7px 10px;
  font-size: 12px;
}

.forge-changes li + li {
  border-top: 1px solid var(--sb-border-subtle);
}

.forge-changes code {
  font-family: var(--font-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forge-changes .note,
.forge-changes .lines {
  color: var(--sb-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forge-changes .lines {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-emerald-500, #10b981);
}

.kind {
  font-size: 10px;
  line-height: 18px;
  text-align: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-emerald-500, #10b981) 14%, transparent);
  color: var(--color-emerald-500, #10b981);
}

.kind[data-kind='copy'] {
  background: color-mix(in srgb, var(--color-sky-500, #0ea5e9) 14%, transparent);
  color: var(--color-sky-500, #0ea5e9);
}

.kind[data-kind='manifest'] {
  background: color-mix(in srgb, var(--color-amber-500, #f59e0b) 16%, transparent);
  color: var(--color-amber-500, #f59e0b);
}

.forge-logs {
  width: min(760px, 100%);
  min-width: 0;
  max-width: 100%;
}

.forge-logs > p {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--sb-text-faint);
}

.forge-logs pre {
  max-height: 160px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--sb-bg-inset);
  color: var(--sb-text-secondary);
}

.log-warn {
  color: var(--color-amber-500, #f59e0b);
}

.log-error {
  color: var(--color-rose-500, #f43f5e);
}

.forge-composer {
  flex: 0 0 auto;
  margin: 0 22px 16px;
  padding: 10px;
  border: 1px solid var(--sb-border-subtle);
  border-radius: 14px;
  background: color-mix(in srgb, var(--sb-bg-inset) 65%, var(--sb-bg-panel));
  box-shadow: 0 10px 30px color-mix(in srgb, var(--sb-bg-base, black) 8%, transparent);
}

.forge-composer textarea {
  resize: none;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
}

.forge-composer-bar {
  margin-top: 8px;
  align-items: center;
}

.forge-model {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.forge-model span {
  margin: 0;
}

.forge-model select {
  width: 220px;
  height: 28px;
}

.forge-build {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--sb-text-secondary);
}

.forge-spacer {
  flex: 1;
}

.forge-ghost {
  border: 1px solid var(--sb-border-subtle);
  background: var(--sb-bg-panel);
}

.spin {
  animation: forge-spin 0.8s linear infinite;
}

@keyframes forge-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 800px) {
  .forge-body {
    grid-template-columns: 1fr;
  }

  .forge-rail {
    max-height: 180px;
  }

  .forge-changes li {
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .forge-changes .note,
  .forge-changes .lines {
    display: none;
  }
}
</style>
