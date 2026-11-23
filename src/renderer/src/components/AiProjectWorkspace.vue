<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Bot, Check, ChevronDown, CircleAlert, Download, FolderOpen, LoaderCircle, MoreHorizontal, PanelRightClose, PanelRightOpen, Pencil, Pin, PinOff, Plus, Paperclip, X, RotateCcw, Send, Square, Trash2 } from 'lucide-vue-next'
import { renderAiMarkdown } from '../lib/ai-markdown'
import { useAiProjectWorkspace } from '../composables/useAiProjectWorkspace'
import { askConfirm } from '../composables/useConfirmDialog'
import { askPrompt } from '../composables/usePromptDialog'
import { useToast } from '../composables/useToast'

const props = defineProps<{ inspectorOpen: boolean; inspectorWidth: number; activeProjectId: string | null }>()
const emit = defineEmits<{ toggleInspector: []; resizeInspector: [width: number]; activeProjectChange: [id: string | null] }>()
const state = useAiProjectWorkspace(window.autoforge.ai, () => crypto.randomUUID(), (id) => emit('activeProjectChange', id))
const openProjectActionsId = ref<string | null>(null)
const narrow = ref(false)
const inspectorResizeCleanup = ref<(() => void) | null>(null)
const { pushToast } = useToast()
const currentProfile = computed(() => state.profiles.value.find((profile) => profile.id === state.activeProfileId.value))
const conversation = computed(() => state.turns.value.filter((turn) => turn.role === 'user' || turn.content).map(turn => ({ ...turn, html: turn.role === 'assistant' ? renderAiMarkdown(turn.content) : '' })))
const streamingHtml = computed(() => renderAiMarkdown(state.streamingText.value))
const conversationElement = ref<HTMLElement | null>(null)
const followLatest = ref(true)
watch(() => [state.streamingText.value, state.turns.value.length], async () => {
  if (!followLatest.value) return
  await nextTick()
  const element = conversationElement.value
  if (element) element.scrollTop = element.scrollHeight
})
function trackScroll(): void {
  const element = conversationElement.value
  if (element) followLatest.value = element.scrollHeight - element.scrollTop - element.clientHeight < 100
}
watch(() => state.activeProject.value?.id, () => { followLatest.value = true })
function openMarkdownLink(event: MouseEvent): void {
  const anchor = (event.target as Element)?.closest('a')
  if (!anchor) return
  event.preventDefault()
  const href = anchor.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) void window.autoforge.system.openExternal(href)
}

function startInspectorResize(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  const startX = event.clientX
  const startWidth = props.inspectorWidth
  const onMove = (moveEvent: PointerEvent): void => emit('resizeInspector', startWidth + startX - moveEvent.clientX)
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    inspectorResizeCleanup.value = null
  }
  inspectorResizeCleanup.value?.()
  inspectorResizeCleanup.value = onUp
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function resizeInspectorByKeyboard(event: KeyboardEvent): void {
  const step = event.shiftKey ? 24 : 8
  if (event.key === 'ArrowLeft') emit('resizeInspector', props.inspectorWidth + step)
  else if (event.key === 'ArrowRight') emit('resizeInspector', props.inspectorWidth - step)
  else return
  event.preventDefault()
}

function updateViewport(): void {
  narrow.value = window.innerWidth < 1180
}

onMounted(() => {
  updateViewport()
  window.addEventListener('resize', updateViewport)
  void state.load(props.activeProjectId)
})
onUnmounted(() => {
  window.removeEventListener('resize', updateViewport)
  inspectorResizeCleanup.value?.()
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

function folderName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path
}

async function startProject(): Promise<void> {
  const folder = await state.chooseProjectFolder()
  if (!folder) return
  if (!state.projectDraft.profileId && state.activeProfileId.value) {
    state.projectDraft.profileId = state.activeProfileId.value
  }
  state.creating.value = true
  if (!state.projectDraft.name.trim()) state.projectDraft.name = folderName(folder)
}

async function submitProject(): Promise<void> {
  const profileId = state.projectDraft.profileId || state.activeProfileId.value
  if (!profileId) {
    state.error.value = '请先在设置中添加模型配置'
    return
  }
  await state.createProject({ ...state.projectDraft, profileId })
}

async function renameProject(project: (typeof state.projects.value)[number]): Promise<void> {
  openProjectActionsId.value = null
  const name = await askPrompt({
    title: '重命名项目',
    message: '更改项目在 Autoforge 中显示的名称。',
    label: '项目名称',
    defaultValue: project.name,
    placeholder: '输入项目名称',
    confirmLabel: '保存名称'
  })
  if (name !== null) await state.renameProject(project.id, name)
}

async function toggleProjectPinned(project: (typeof state.projects.value)[number]): Promise<void> {
  openProjectActionsId.value = null
  await state.setProjectPinned(project.id, !project.pinned)
}

async function exportProjectTurns(project: (typeof state.projects.value)[number]): Promise<void> {
  openProjectActionsId.value = null
  const filePath = await state.exportProjectTurns(project.id)
  if (filePath) {
    pushToast({ type: 'success', title: '对话已导出', message: filePath })
  }
}

async function confirmRemoveProject(project: (typeof state.projects.value)[number]): Promise<void> {
  openProjectActionsId.value = null
  const firstConfirmed = await askConfirm({
    title: '删除项目记录？',
    message: `将移除“${project.name}”在 Autoforge 中的项目记录和对话。本机文件夹及其中的文件会保留。`,
    confirmLabel: '继续',
    variant: 'danger'
  })
  if (!firstConfirmed) return

  const secondConfirmed = await askConfirm({
    title: '再次确认删除',
    message: `确认移除“${project.name}”的项目记录和全部对话？此操作无法在 Autoforge 中撤销。`,
    confirmLabel: '确认删除项目',
    variant: 'danger'
  })
  if (secondConfirmed) await state.removeProject(project.id)
}
</script>

<template>
  <section class="ai-project-workspace">
    <header class="ai-project-toolbar">
      <div class="ai-project-identity">
        <FolderOpen :size="16" />
        <template v-if="state.activeProject.value">
          <span class="ai-project-title">{{ state.activeProject.value.name }}</span>
          <span class="ai-project-language">{{ state.activeProject.value.language === 'javascript' ? 'JavaScript' : 'Python' }}</span>
        </template>
        <span v-else class="ai-project-title">项目工作区</span>
      </div>
      <div class="ai-project-toolbar-actions">
        <button type="button" class="ai-toolbar-new" @click="startProject"><Plus :size="15" /> 新建项目</button>
        <button
          type="button"
          :aria-label="props.inspectorOpen ? '关闭检查面板' : '打开检查面板'"
          :title="props.inspectorOpen ? '关闭检查面板' : '打开检查面板'"
          @click="emit('toggleInspector')"
        >
          <PanelRightClose v-if="props.inspectorOpen" :size="16" />
          <PanelRightOpen v-else :size="16" />
        </button>
      </div>
    </header>

    <div class="ai-project-body">
      <aside class="ai-project-list" aria-label="AI 项目">
        <div class="ai-project-list-heading">
          <span>项目</span>
          <button type="button" aria-label="新建项目" title="新建项目" @click="startProject"><Plus :size="15" /></button>
        </div>
        <div
          v-for="project in state.projects.value"
          :key="project.id"
          class="ai-project-list-row"
          :class="state.activeProject.value?.id === project.id && 'is-active'"
        >
          <button type="button" class="ai-project-list-item" @click="openProjectActionsId = null; state.openProject(project.id)">
            <span class="ai-project-list-name">
              <Pin v-if="project.pinned" :size="12" aria-label="已置顶" />
              {{ project.name }}
            </span>
            <span class="ai-project-list-path">{{ folderName(project.rootPath) }}</span>
          </button>
          <button
            type="button"
            class="ai-project-actions-trigger"
            aria-label="项目操作"
            title="项目操作"
            :aria-expanded="openProjectActionsId === project.id"
            @click.stop="openProjectActionsId = openProjectActionsId === project.id ? null : project.id"
            @keydown.esc="openProjectActionsId = null"
          ><MoreHorizontal :size="16" /></button>
          <div v-if="openProjectActionsId === project.id" class="ai-project-actions-menu" role="menu" @click.stop>
            <button type="button" role="menuitem" @click="renameProject(project)"><Pencil :size="14" />重命名</button>
            <button type="button" role="menuitem" @click="toggleProjectPinned(project)">
              <PinOff v-if="project.pinned" :size="14" />
              <Pin v-else :size="14" />
              {{ project.pinned ? '取消置顶' : '置顶项目' }}
            </button>
            <button type="button" role="menuitem" @click="exportProjectTurns(project)"><Download :size="14" />导出对话</button>
            <button type="button" role="menuitem" class="ai-project-actions-delete" @click="confirmRemoveProject(project)"><Trash2 :size="14" />删除项目</button>
          </div>
        </div>
        <p v-if="!state.projects.value.length && !state.loading.value" class="ai-project-list-empty">没有项目</p>
      </aside>

      <div v-if="state.creating.value" class="ai-project-create-overlay">
        <form class="ai-project-create-form" @submit.prevent="submitProject()">
          <div class="ai-create-heading">
            <div><FolderOpen :size="18" /><h2>新建项目</h2></div>
            <button type="button" aria-label="取消新建" title="取消" @click="state.creating.value = false">×</button>
          </div>
          <label>项目名称<input v-model="state.projectDraft.name" required maxlength="100"></label>
          <label>项目文件夹
            <button type="button" class="ai-folder-picker" @click="startProject">
              <span>{{ state.pendingFolder.value || '选择一个本机文件夹' }}</span><FolderOpen :size="15" />
            </button>
          </label>
          <label>脚本语言
            <select v-model="state.projectDraft.language">
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
            </select>
          </label>
          <label>模型
            <select v-model="state.projectDraft.profileId" required>
              <option value="" disabled>选择模型配置</option>
              <option v-for="profile in state.profiles.value" :key="profile.id" :value="profile.id" :disabled="!profile.hasCredentials">{{ profile.name }} · {{ profile.model }}{{ profile.hasCredentials ? '' : '（未配置凭据）' }}</option>
            </select>
          </label>
          <p v-if="!state.profiles.value.some((profile) => profile.hasCredentials)" class="ai-project-warning"><CircleAlert :size="15" />请先添加并配置模型凭据。</p>
          <div class="ai-create-actions">
            <button type="button" class="ai-button-secondary" @click="state.creating.value = false">取消</button>
            <button type="submit" class="ai-button-primary" :disabled="!state.profiles.value.some((profile) => profile.hasCredentials)">创建项目</button>
          </div>
        </form>
      </div>

      <main class="ai-project-main">
        <template v-if="state.activeProject.value">
          <div ref="conversationElement" class="ai-conversation" aria-live="polite" @scroll="trackScroll">
            <div v-if="!conversation.length && !state.busy.value" class="ai-conversation-empty">
              <div class="ai-empty-icon"><Bot :size="20" /></div>
              <h1>{{ state.activeProject.value.name }}</h1>
              <p>描述要创建或修改的 Autoforge 脚本。</p>
            </div>
            <article v-for="turn in conversation" :key="turn.id" class="ai-turn" :class="`ai-turn--${turn.role}`">
              <div class="ai-turn-avatar"><span v-if="turn.role === 'user'">你</span><Bot v-else :size="15" /></div>
              <div class="ai-turn-content">
                <div class="ai-turn-role">{{ turn.role === 'user' ? '你' : 'Autoforge Agent' }}</div>
                <div v-if="turn.role === 'assistant'" class="ai-markdown" @click="openMarkdownLink" v-html="turn.html" />
                <pre v-else>{{ turn.content }}</pre>
                <div v-if="turn.attachments?.length" class="ai-attachments">
                  <button v-for="attachment in turn.attachments" :key="attachment.id" type="button" class="ai-attachment" :title="attachment.name" @click="state.previewAttachment(attachment)">
                    <img v-if="state.attachmentPreviews.value[attachment.id]?.dataUrl" :src="state.attachmentPreviews.value[attachment.id].dataUrl" :alt="attachment.name">
                    <Paperclip v-else :size="18" />
                    <span>{{ attachment.name }}<small>{{ state.attachmentPreviews.value[attachment.id]?.error ?? (attachment.size / 1024).toFixed(1) + ' KB' }}</small></span>
                  </button>
                </div>
                <details v-for="attachment in (turn.attachments ?? []).filter(a => a.kind === 'text')" :key="attachment.id" class="ai-text-preview" @toggle="state.previewAttachment(attachment)">
                  <summary>{{ attachment.name }}</summary><pre>{{ state.attachmentPreviews.value[attachment.id]?.text ?? '预览不可用' }}</pre>
                </details>
                <span v-if="turn.status === 'error' || turn.status === 'cancelled'" class="ai-turn-status">{{ turn.status === 'error' ? '任务失败' : '已停止' }}</span>
              </div>
            </article>
            <article v-if="state.busy.value" class="ai-turn ai-turn--assistant">
              <div class="ai-turn-avatar"><Bot :size="15" /></div>
              <div class="ai-turn-content">
                <div class="ai-turn-role">Autoforge Agent</div>
                <div class="ai-markdown" @click="openMarkdownLink" v-html="streamingHtml" /><span v-if="state.streamingText.value" class="ai-stream-caret" />
                <span v-if="!state.streamingText.value" class="ai-working"><LoaderCircle class="ai-spin" :size="14" /> 正在处理项目</span>
              </div>
            </article>
          </div>

          <button v-if="state.canRetry.value && !state.busy.value" type="button" class="ai-retry-button" @click="state.retryMessage()"><RotateCcw :size="13" />重试上一条消息</button>
          <form class="ai-composer" @submit.prevent="state.sendMessage()">
            <div v-if="state.pendingAttachments.value.length" class="ai-attachments">
              <div v-for="attachment in state.pendingAttachments.value" :key="attachment.id" class="ai-attachment">
                <img v-if="state.attachmentPreviews.value[attachment.id]?.dataUrl" :src="state.attachmentPreviews.value[attachment.id].dataUrl" :alt="attachment.name">
                <Paperclip v-else :size="18" />
                <span>{{ attachment.name }}<small>{{ (attachment.size / 1024).toFixed(1) }} KB</small></span>
                <button type="button" :disabled="state.busy.value" :aria-label="'移除 ' + attachment.name" @click="state.removeAttachment(attachment)"><X :size="13" /></button>
              </div>
            </div>
            <textarea
              v-model="state.prompt.value"
              :disabled="state.busy.value"
              rows="3"
              placeholder="描述你想创建或修改的脚本…"
              @keydown.ctrl.enter.prevent="state.sendMessage()"
              @keydown.meta.enter.prevent="state.sendMessage()"
            />
            <div class="ai-composer-footer">
              <div class="ai-composer-tools"><button type="button" class="ai-add-attachment" aria-label="添加素材" title="添加图片或 UTF-8 文本素材（最多 8 个）" :disabled="state.busy.value || state.attaching.value" @click="state.addAttachments()"><LoaderCircle v-if="state.attaching.value" class="ai-spin" :size="16" /><Paperclip v-else :size="16" /></button><span class="ai-model-label"><span>{{ currentProfile?.name ?? '选择模型' }}</span><ChevronDown :size="13" /></span></div>
              <button v-if="state.busy.value" type="button" class="ai-send-button ai-stop-button" title="停止生成" aria-label="停止生成" @click="state.cancelTurn()"><Square :size="14" /></button>
              <button v-else type="submit" class="ai-send-button" title="发送消息" aria-label="发送消息" :disabled="state.attaching.value || (!state.prompt.value.trim() && !state.pendingAttachments.value.length)"><Send :size="15" /></button>
            </div>
          </form>
        </template>
        <div v-else-if="!state.creating.value" class="ai-project-no-selection">
          <div class="ai-empty-icon"><FolderOpen :size="20" /></div>
          <h1>选择一个项目</h1>
          <p>选择本机文件夹来创建项目工作区。</p>
          <button type="button" class="ai-button-primary" @click="startProject"><Plus :size="15" />新建项目</button>
        </div>
        <p v-if="state.error.value" class="ai-project-error" role="alert"><CircleAlert :size="15" />{{ state.error.value }}</p>
      </main>
      <div
        v-if="props.inspectorOpen && !narrow"
        class="ai-inspector-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整检查面板宽度"
        tabindex="0"
        @pointerdown="startInspectorResize"
        @keydown="resizeInspectorByKeyboard"
      />
      <button v-if="props.inspectorOpen && narrow" type="button" class="ai-inspector-backdrop" aria-label="关闭检查面板" @click="emit('toggleInspector')" />
      <aside v-if="props.inspectorOpen" class="ai-inspector" :class="narrow && 'ai-inspector--drawer'" :style="{ width: narrow ? 'min(360px, calc(100vw - 72px))' : `${props.inspectorWidth}px` }">
        <header><strong>检查结果</strong><span v-if="state.activeProject.value?.status">{{ state.activeProject.value.status }}</span></header>
        <section>
          <h3>本轮文件</h3>
          <p v-if="!state.fileChanges.value.length" class="ai-inspector-empty">暂无变更</p>
          <ul v-else><li v-for="path in state.fileChanges.value" :key="path"><Check :size="13" />{{ path }}</li></ul>
        </section>
        <section>
          <h3>包与语法检查</h3>
          <p v-if="!state.checkResults.value.length" class="ai-inspector-empty">检查结果会显示在这里</p>
          <article v-for="(check, index) in state.checkResults.value" :key="`${check.code}-${index}`" class="ai-check-result" :class="check.status === 'passed' ? 'is-passed' : 'is-failed'">
            <div><Check v-if="check.status === 'passed'" :size="14" /><CircleAlert v-else :size="14" /><strong>{{ check.code ?? '检查' }}</strong></div>
            <p>{{ check.message ?? check.status }}</p>
            <pre v-if="check.diagnostics?.length">{{ check.diagnostics.join('\n') }}</pre>
          </article>
          <button
            v-if="state.activeProject.value"
            type="button"
            class="ai-analyze-button"
            :disabled="state.busy.value"
            @click="state.analyzeProject()"
          >
            <LoaderCircle v-if="state.busy.value" class="ai-spin" :size="14" />
            <span>{{ state.busy.value ? '正在分析和检查…' : state.checkResults.value.length ? '重新分析、检查并导入' : 'AI 分析、检查并导入' }}</span>
          </button>
        </section>
        <section>
          <h3>Autoforge 导入</h3>
          <div v-if="state.importResult.value" class="ai-import-result" :class="state.importResult.value.ok ? 'is-passed' : 'is-failed'">
            <Check v-if="state.importResult.value.ok" :size="14" /><CircleAlert v-else :size="14" />
            <span>{{ state.importResult.value.message }}</span>
          </div>
          <p v-else-if="state.checkResults.value.some((check) => check.status === 'passed') && state.checkResults.value.every((check) => check.status === 'passed')" class="ai-inspector-empty">检查通过，等待手动导入</p>
          <p v-else class="ai-inspector-empty">手动触发分析与检查后，才会导入脚本</p>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.ai-project-workspace { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; background: var(--sb-bg-base); color: var(--sb-text-primary); }
.ai-project-toolbar { display: flex; flex: 0 0 42px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 14px; border-bottom: 1px solid var(--sb-border-subtle); background: var(--sb-bg-panel); }
.ai-project-identity, .ai-project-toolbar-actions { display: flex; min-width: 0; align-items: center; gap: 9px; color: var(--sb-text-muted); }
.ai-project-title { overflow: hidden; color: var(--sb-text-primary); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.ai-project-language { padding: 3px 6px; border-radius: 4px; background: var(--sb-bg-inset); font-size: 10px; }
.ai-project-toolbar-actions button, .ai-project-list-heading button { display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 5px; background: transparent; color: var(--sb-text-muted); cursor: pointer; }
.ai-project-toolbar-actions button:hover, .ai-project-list-heading button:hover { background: var(--sb-bg-hover); color: var(--sb-text-primary); }
.ai-project-toolbar-actions .ai-toolbar-new { display: inline-flex; width: auto; align-items: center; gap: 5px; padding: 0 8px; border: 1px solid var(--sb-border-subtle); font-size: 11px; }
.ai-project-body { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; }
.ai-project-list { display: flex; width: 208px; flex: 0 0 208px; min-height: 0; flex-direction: column; gap: 3px; padding: 10px 8px; border-right: 1px solid var(--sb-border-subtle); background: var(--sb-bg-panel); overflow-y: auto; }
.ai-project-list-heading { display: flex; align-items: center; justify-content: space-between; padding: 0 5px 7px; color: var(--sb-text-muted); font-size: 11px; font-weight: 600; }
.ai-project-list-row { position: relative; display: flex; min-width: 0; align-items: stretch; border-radius: 5px; }
.ai-project-list-row.is-active { background: var(--sb-bg-inset); }
.ai-project-list-item { display: grid; flex: 1; gap: 3px; width: 0; min-width: 0; padding: 8px; border: 0; border-radius: 5px; background: transparent; color: var(--sb-text-muted); text-align: left; cursor: pointer; }
.ai-project-list-item:hover, .ai-project-list-row.is-active .ai-project-list-item { color: var(--sb-text-primary); }
.ai-project-list-name { display: flex; min-width: 0; align-items: center; gap: 5px; }
.ai-project-list-name svg { flex: 0 0 auto; color: var(--sb-accent-solid); }
.ai-project-actions-trigger { display: grid; width: 27px; flex: 0 0 27px; place-items: center; align-self: center; border: 0; border-radius: 4px; background: transparent; color: var(--sb-text-faint); cursor: pointer; }
.ai-project-actions-trigger:hover, .ai-project-actions-trigger[aria-expanded="true"] { background: var(--sb-bg-hover); color: var(--sb-text-primary); }
.ai-project-actions-menu { position: absolute; z-index: 10; top: calc(100% - 3px); right: 2px; display: grid; width: 164px; gap: 2px; padding: 5px; border: 1px solid var(--sb-border-subtle); border-radius: 7px; background: var(--sb-bg-elevated); box-shadow: 0 9px 24px rgba(0,0,0,.2); }
.ai-project-actions-menu button { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 7px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--sb-text-secondary); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.ai-project-actions-menu button:hover { background: var(--sb-bg-hover); color: var(--sb-text-primary); }
.ai-project-actions-menu button svg { flex: 0 0 auto; }
.ai-project-actions-menu .ai-project-actions-delete { color: var(--sb-danger, #c44); }
.ai-project-list-name, .ai-project-list-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-project-list-name { font-size: 12px; }
.ai-project-list-path { color: var(--sb-text-faint); font-size: 10px; }
.ai-project-list-empty { padding: 8px; color: var(--sb-text-faint); font-size: 11px; }
.ai-project-main { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; }
.ai-conversation { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 24px; overflow: auto; padding: 28px max(24px, calc((100% - 780px) / 2)); }
.ai-conversation-empty, .ai-project-no-selection { display: flex; flex: 1; min-height: 0; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.ai-empty-icon { display: grid; width: 38px; height: 38px; place-items: center; border: 1px solid var(--sb-border-subtle); border-radius: 8px; background: var(--sb-bg-panel); color: var(--sb-accent-solid); }
.ai-conversation-empty h1, .ai-project-no-selection h1 { margin: 14px 0 5px; font-size: 17px; font-weight: 600; }
.ai-conversation-empty p, .ai-project-no-selection p { margin: 0 0 14px; color: var(--sb-text-muted); font-size: 12px; }
.ai-turn { display: flex; gap: 12px; max-width: 780px; width: 100%; align-self: center; }
.ai-turn-avatar { display: grid; width: 25px; height: 25px; flex: 0 0 25px; place-items: center; border: 1px solid var(--sb-border-subtle); border-radius: 6px; background: var(--sb-bg-panel); color: var(--sb-text-muted); font-size: 10px; }
.ai-turn--user .ai-turn-avatar { background: var(--sb-bg-inset); }
.ai-turn-content { min-width: 0; flex: 1; }
.ai-turn-role { margin: 3px 0 7px; color: var(--sb-text-muted); font-size: 11px; font-weight: 600; }
.ai-turn pre { margin: 0; color: var(--sb-text-primary); font: inherit; font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.ai-stream-caret { display: inline-block; width: 2px; height: 14px; margin-left: 2px; vertical-align: -2px; background: var(--sb-accent-solid); animation: ai-caret 1s steps(2, start) infinite; }
.ai-working { display: inline-flex; align-items: center; gap: 6px; margin-top: 3px; color: var(--sb-text-muted); font-size: 12px; }
.ai-composer { display: flex; flex: 0 0 auto; flex-direction: column; max-width: 780px; width: calc(100% - 48px); align-self: center; margin: 0 24px 20px; padding: 10px; border: 1px solid var(--sb-border-subtle); border-radius: 8px; background: var(--sb-bg-panel); box-shadow: 0 3px 12px rgba(0,0,0,.08); }
.ai-composer:focus-within { border-color: color-mix(in srgb, var(--sb-accent-solid) 58%, var(--sb-border-subtle)); }
.ai-composer textarea { width: 100%; min-height: 55px; max-height: 220px; resize: vertical; border: 0; outline: 0; background: transparent; color: var(--sb-text-primary); font: inherit; font-size: 13px; line-height: 1.55; }
.ai-composer textarea::placeholder { color: var(--sb-text-faint); }
.ai-composer-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 7px; }
.ai-model-label { display: inline-flex; align-items: center; gap: 5px; max-width: 75%; color: var(--sb-text-muted); font-size: 11px; }
.ai-model-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-send-button { display: grid; width: 30px; height: 30px; place-items: center; border: 0; border-radius: 6px; background: var(--sb-accent-solid); color: var(--sb-accent-contrast, white); cursor: pointer; }
.ai-send-button:disabled { opacity: .45; cursor: default; }
.ai-stop-button { background: var(--sb-bg-inset); color: var(--sb-text-primary); }
.ai-button-primary, .ai-button-secondary { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; gap: 6px; padding: 0 11px; border: 1px solid var(--sb-border-subtle); border-radius: 5px; background: var(--sb-bg-elevated); color: var(--sb-text-primary); font: inherit; font-size: 12px; cursor: pointer; }
.ai-button-primary { border-color: var(--sb-accent-solid); background: var(--sb-accent-solid); color: var(--sb-accent-contrast, white); }
.ai-button-primary:disabled { opacity: .5; cursor: default; }
.ai-project-no-selection { gap: 2px; }
.ai-project-no-selection h1 { margin-top: 12px; }
.ai-project-create-overlay { position: absolute; z-index: 5; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--sb-bg-base) 55%, transparent); }
.ai-project-create-form { display: grid; width: min(400px, calc(100% - 32px)); gap: 13px; padding: 18px; border: 1px solid var(--sb-border-subtle); border-radius: 8px; background: var(--sb-bg-panel); box-shadow: 0 18px 50px rgba(0,0,0,.18); }
.ai-create-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.ai-create-heading > div { display: flex; align-items: center; gap: 8px; color: var(--sb-accent-solid); }
.ai-create-heading h2 { margin: 0; color: var(--sb-text-primary); font-size: 15px; font-weight: 600; }
.ai-create-heading button { width: 28px; height: 28px; border: 0; border-radius: 5px; background: transparent; color: var(--sb-text-muted); font-size: 18px; cursor: pointer; }
.ai-project-create-form > label { display: grid; gap: 5px; color: var(--sb-text-muted); font-size: 11px; }
.ai-project-create-form input, .ai-project-create-form select, .ai-folder-picker { display: flex; width: 100%; min-width: 0; height: 34px; align-items: center; justify-content: space-between; padding: 0 9px; border: 1px solid var(--sb-border-subtle); border-radius: 5px; background: var(--sb-bg-base); color: var(--sb-text-primary); font: inherit; font-size: 12px; }
.ai-folder-picker { cursor: pointer; }
.ai-folder-picker span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-create-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 3px; }
.ai-project-warning, .ai-project-error { display: flex; align-items: center; gap: 6px; color: var(--sb-danger, #c44); font-size: 11px; }
.ai-project-error { margin: 0; padding: 9px 14px; }
.ai-inspector-resizer { position: relative; z-index: 2; width: 9px; flex: 0 0 9px; margin-inline: -4px; cursor: col-resize; touch-action: none; }
.ai-inspector-resizer::after { position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; background: transparent; content: ''; }
.ai-inspector-resizer:hover::after, .ai-inspector-resizer:focus-visible::after { background: var(--sb-accent-solid); }
.ai-inspector-resizer:focus-visible { outline: none; }
.ai-inspector { display: flex; flex: 0 0 auto; min-width: 260px; flex-direction: column; gap: 18px; padding: 14px 12px; border-left: 1px solid var(--sb-border-subtle); background: var(--sb-bg-panel); overflow: auto; color: var(--sb-text-primary); }
.ai-inspector-backdrop { position: absolute; z-index: 2; inset: 0; border: 0; background: rgba(0,0,0,.28); }
.ai-inspector--drawer { position: absolute; z-index: 3; top: 0; right: 0; bottom: 0; min-width: 0; box-shadow: -16px 0 40px rgba(0,0,0,.2); }
.ai-inspector > header { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
.ai-inspector > header span { padding: 3px 6px; border-radius: 4px; background: var(--sb-bg-inset); color: var(--sb-text-muted); font-size: 10px; }
.ai-inspector section { display: grid; gap: 8px; }
.ai-inspector section h3 { margin: 0; font-size: 11px; font-weight: 600; }
.ai-inspector-empty { margin: 0; color: var(--sb-text-faint); font-size: 11px; }
.ai-inspector ul { display: grid; gap: 6px; padding: 0; margin: 0; list-style: none; }
.ai-inspector li, .ai-import-result { display: flex; align-items: flex-start; gap: 6px; color: var(--sb-text-muted); font-size: 11px; overflow-wrap: anywhere; }
.ai-inspector li svg, .ai-import-result svg { flex: 0 0 auto; color: var(--sb-success, #2d9864); }
.ai-check-result { display: grid; gap: 5px; padding: 8px; border: 1px solid var(--sb-border-subtle); border-radius: 5px; background: var(--sb-bg-base); }
.ai-check-result > div { display: flex; align-items: center; gap: 5px; font-size: 11px; }
.ai-check-result p, .ai-check-result pre { margin: 0; color: var(--sb-text-muted); font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.is-passed > div, .ai-import-result.is-passed { color: var(--sb-success, #2d9864); }
.is-failed > div, .ai-import-result.is-failed { color: var(--sb-danger, #c44); }
.ai-analyze-button { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--sb-accent-solid); border-radius: 5px; background: var(--sb-accent-solid); color: var(--sb-accent-contrast, white); font: inherit; font-size: 11px; cursor: pointer; }
.ai-analyze-button:disabled { opacity: .55; cursor: default; }
.ai-spin { animation: ai-spin .9s linear infinite; }
@keyframes ai-spin { to { transform: rotate(360deg); } }
@keyframes ai-caret { to { visibility: hidden; } }
@media (max-width: 760px) { .ai-project-list { width: 150px; flex-basis: 150px; } .ai-composer { width: calc(100% - 24px); margin: 0 12px 12px; } .ai-project-toolbar { padding-inline: 9px; } }
@media (prefers-reduced-motion: reduce) { .ai-spin, .ai-stream-caret { animation-duration: 2s; } }

.ai-markdown { font-size: 13px; line-height: 1.75; overflow-wrap: anywhere; }
.ai-markdown :deep(> :first-child) { margin-top: 0; }
.ai-markdown :deep(> :last-child) { margin-bottom: 0; }
.ai-markdown :deep(h1) { font-size: 22px; }
.ai-markdown :deep(h2) { font-size: 18px; }
.ai-markdown :deep(h3) { font-size: 15px; }
.ai-markdown :deep(h1), .ai-markdown :deep(h2), .ai-markdown :deep(h3) { margin: 20px 0 10px; line-height: 1.4; }
.ai-markdown :deep(p), .ai-markdown :deep(ul), .ai-markdown :deep(ol) { margin: 10px 0; }
.ai-markdown :deep(ul), .ai-markdown :deep(ol) { padding-left: 24px; }
.ai-markdown :deep(code) { padding: 2px 5px; border-radius: 4px; background: var(--sb-bg-inset); font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.ai-markdown :deep(pre) { margin: 12px 0; padding: 14px; overflow: auto; border: 1px solid var(--sb-border-subtle); border-radius: 7px; background: var(--sb-bg-inset); white-space: pre; }
.ai-markdown :deep(pre code) { padding: 0; background: transparent; }
.ai-markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 12px 0; }
.ai-markdown :deep(th), .ai-markdown :deep(td) { padding: 7px 12px; border: 1px solid var(--sb-border-subtle); text-align: left; }
.ai-markdown :deep(th) { background: var(--sb-bg-inset); }
.ai-markdown :deep(blockquote) { margin: 12px 0; padding-left: 14px; border-left: 3px solid var(--sb-border-subtle); color: var(--sb-text-muted); }
.ai-markdown :deep(a) { color: var(--sb-accent-solid); text-decoration: underline; }
.ai-composer-tools { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ai-add-attachment, .ai-attachment button { display: grid; place-items: center; border: 0; border-radius: 5px; background: transparent; color: var(--sb-text-muted); cursor: pointer; }
.ai-add-attachment { width: 28px; height: 28px; }
.ai-add-attachment:hover { background: var(--sb-bg-hover); }
.ai-add-attachment:disabled { opacity: .4; cursor: default; }
.ai-attachments { display: flex; gap: 8px; flex-wrap: wrap; padding: 6px 0 12px; }
.ai-attachment { display: flex; align-items: center; gap: 8px; max-width: 240px; min-width: 0; padding: 7px; border: 1px solid var(--sb-border-subtle); border-radius: 7px; background: var(--sb-bg-inset); color: var(--sb-text-primary); font: inherit; text-align: left; }
.ai-attachment img { width: 44px; height: 44px; flex: 0 0 44px; object-fit: contain; border-radius: 4px; }
.ai-attachment > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.ai-attachment small { display: block; margin-top: 3px; color: var(--sb-text-muted); font-size: 10px; }
.ai-attachment button { align-self: flex-start; padding: 3px; }
.ai-text-preview { padding: 6px 0; color: var(--sb-text-muted); font-size: 11px; }
.ai-text-preview pre { max-height: 200px; overflow: auto; }
.ai-turn-status { display: block; margin-top: 8px; color: var(--sb-text-muted); font-size: 11px; }
.ai-retry-button { display: inline-flex; align-items: center; align-self: center; gap: 6px; margin: 8px 0; border: 0; background: transparent; color: var(--sb-text-muted); cursor: pointer; font-size: 12px; }
</style>
