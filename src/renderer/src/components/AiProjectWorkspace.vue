<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Bot, Check, ChevronDown, CircleAlert, FolderOpen, LoaderCircle, PanelRightClose, PanelRightOpen, Plus, Send, Square, Trash2 } from 'lucide-vue-next'
import { useAiProjectWorkspace } from '../composables/useAiProjectWorkspace'

const props = defineProps<{ inspectorOpen: boolean; activeProjectId: string | null }>()
const emit = defineEmits<{ toggleInspector: []; activeProjectChange: [id: string | null] }>()
const state = useAiProjectWorkspace(window.autoforge.ai, () => crypto.randomUUID(), (id) => emit('activeProjectChange', id))
const currentProfile = computed(() => state.profiles.value.find((profile) => profile.id === state.activeProfileId.value))
const conversation = computed(() => state.turns.value.filter((turn) => turn.role === 'user' || turn.content))

onMounted(() => void state.load(props.activeProjectId))

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
        <button v-if="state.activeProject.value" type="button" title="移除项目记录" aria-label="移除项目记录" @click="state.removeProject(state.activeProject.value.id)">
          <Trash2 :size="15" />
        </button>
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
        <button
          v-for="project in state.projects.value"
          :key="project.id"
          type="button"
          class="ai-project-list-item"
          :class="state.activeProject.value?.id === project.id && 'is-active'"
          @click="state.openProject(project.id)"
        >
          <span class="ai-project-list-name">{{ project.name }}</span>
          <span class="ai-project-list-path">{{ folderName(project.rootPath) }}</span>
        </button>
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
          <div class="ai-conversation" aria-live="polite">
            <div v-if="!conversation.length && !state.busy.value" class="ai-conversation-empty">
              <div class="ai-empty-icon"><Bot :size="20" /></div>
              <h1>{{ state.activeProject.value.name }}</h1>
              <p>描述要创建或修改的 Autoforge 脚本。</p>
            </div>
            <article v-for="turn in conversation" :key="turn.id" class="ai-turn" :class="`ai-turn--${turn.role}`">
              <div class="ai-turn-avatar"><span v-if="turn.role === 'user'">你</span><Bot v-else :size="15" /></div>
              <div class="ai-turn-content">
                <div class="ai-turn-role">{{ turn.role === 'user' ? '你' : 'Autoforge Agent' }}</div>
                <pre>{{ turn.content }}</pre>
              </div>
            </article>
            <article v-if="state.busy.value" class="ai-turn ai-turn--assistant">
              <div class="ai-turn-avatar"><Bot :size="15" /></div>
              <div class="ai-turn-content">
                <div class="ai-turn-role">Autoforge Agent</div>
                <pre>{{ state.streamingText.value }}<span class="ai-stream-caret" /></pre>
                <span v-if="!state.streamingText.value" class="ai-working"><LoaderCircle class="ai-spin" :size="14" /> 正在处理项目</span>
              </div>
            </article>
          </div>

          <form class="ai-composer" @submit.prevent="state.sendMessage()">
            <textarea
              v-model="state.prompt.value"
              :disabled="state.busy.value"
              rows="3"
              placeholder="描述你想创建或修改的脚本…"
              @keydown.ctrl.enter.prevent="state.sendMessage()"
              @keydown.meta.enter.prevent="state.sendMessage()"
            />
            <div class="ai-composer-footer">
              <span class="ai-model-label"><span>{{ currentProfile?.name ?? '选择模型' }}</span><ChevronDown :size="13" /></span>
              <button v-if="state.busy.value" type="button" class="ai-send-button ai-stop-button" title="停止生成" aria-label="停止生成" @click="state.cancelTurn()"><Square :size="14" /></button>
              <button v-else type="submit" class="ai-send-button" title="发送消息" aria-label="发送消息" :disabled="!state.prompt.value.trim()"><Send :size="15" /></button>
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
      <aside v-if="props.inspectorOpen" class="ai-inspector">
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
          <button v-if="state.activeProject.value && !state.busy.value" type="button" class="ai-retry-button" @click="state.retryChecks()">重新检查</button>
        </section>
        <section>
          <h3>Autoforge 导入</h3>
          <div v-if="state.importResult.value" class="ai-import-result" :class="state.importResult.value.ok ? 'is-passed' : 'is-failed'">
            <Check v-if="state.importResult.value.ok" :size="14" /><CircleAlert v-else :size="14" />
            <span>{{ state.importResult.value.message }}</span>
          </div>
          <p v-else class="ai-inspector-empty">校验通过后会自动导入</p>
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
.ai-project-list-item { display: grid; gap: 3px; width: 100%; min-width: 0; padding: 8px; border: 0; border-radius: 5px; background: transparent; color: var(--sb-text-muted); text-align: left; cursor: pointer; }
.ai-project-list-item:hover, .ai-project-list-item.is-active { background: var(--sb-bg-inset); color: var(--sb-text-primary); }
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
.ai-inspector { display: flex; width: 320px; flex: 0 0 320px; min-width: 260px; flex-direction: column; gap: 18px; padding: 14px 12px; border-left: 1px solid var(--sb-border-subtle); background: var(--sb-bg-panel); overflow: auto; color: var(--sb-text-primary); }
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
.ai-retry-button { display: inline-flex; min-height: 30px; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--sb-border-subtle); border-radius: 5px; background: var(--sb-bg-panel); color: var(--sb-text-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.ai-spin { animation: ai-spin .9s linear infinite; }
@keyframes ai-spin { to { transform: rotate(360deg); } }
@keyframes ai-caret { to { visibility: hidden; } }
@media (max-width: 1180px) { .ai-inspector { width: 270px; flex-basis: 270px; min-width: 260px; } }
@media (max-width: 760px) { .ai-project-list { width: 150px; flex-basis: 150px; } .ai-inspector { width: 260px; flex-basis: 260px; } .ai-composer { width: calc(100% - 24px); margin: 0 12px 12px; } .ai-project-toolbar { padding-inline: 9px; } }
@media (prefers-reduced-motion: reduce) { .ai-spin, .ai-stream-caret { animation-duration: 2s; } }
</style>
