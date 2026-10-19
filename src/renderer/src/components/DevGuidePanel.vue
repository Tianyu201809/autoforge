<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen, Check, Copy, Download, FileCode2, MessageSquareText, X } from 'lucide-vue-next'
import type { BundledExampleInfo, DevGuideSkillCreateInfo } from '../../../shared/types/script'
import { useToast } from '../composables/useToast'
import { createStoreZip } from '../lib/store-zip'
import AppFeatureModal from './AppFeatureModal.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; imported: [] }>()
const { pushToast } = useToast()

const activeTab = ref<'agent' | 'guide' | 'examples'>('agent')
const markdown = ref('')
const skillCreate = ref<DevGuideSkillCreateInfo | null>(null)
const examples = ref<BundledExampleInfo[]>([])
const importingId = ref<string | null>(null)
const loading = ref(false)
const promptCopied = ref(false)
const promptExpanded = ref(false)
const loaded = ref(false)

const forgeStages = [
  { n: '01', title: '开场', detail: '把规则提示词贴进新对话，用自己的话描述要自动化的事' },
  { n: '02', title: '澄清', detail: 'Agent 一次只问一组问题，把语言、字段和产物问明确' },
  { n: '03', title: '确认', detail: '核对《脚本确认清单》，回复「确认」。在此之前不会写代码' },
  { n: '04', title: '锻造', detail: '按 Autoforge 契约生成脚本包，并说明去哪个 Tab 填写、如何导入' }
] as const

const agentPrompt = computed(() => skillCreate.value?.agentPrompt?.trim() ?? '')
const promptLineCount = computed(() => (agentPrompt.value ? agentPrompt.value.split('\n').length : 0))
const promptPreview = computed(() => {
  if (!agentPrompt.value || promptExpanded.value || promptLineCount.value <= 18) return agentPrompt.value
  return agentPrompt.value.split('\n').slice(0, 18).join('\n')
})

async function loadContent(): Promise<void> {
  if (loaded.value) return
  loading.value = true
  try {
    const [md, skill, list] = await Promise.all([
      window.autoforge.devGuide.get(),
      window.autoforge.devGuide.getSkillCreate(),
      window.autoforge.examples.list()
    ])
    markdown.value = md
    skillCreate.value = skill
    examples.value = list
    loaded.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadContent()
  },
  { immediate: true }
)

async function copyText(text: string, onCopied: () => void, title: string, message: string): Promise<void> {
  if (!text) {
    pushToast({ type: 'error', title: '复制失败', message: '内容为空' })
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    onCopied()
    pushToast({ type: 'success', title, message, duration: 2800 })
    window.setTimeout(() => {
      promptCopied.value = false
    }, 2200)
  } catch {
    pushToast({ type: 'error', title: '复制失败', message: '无法写入剪贴板' })
  }
}

async function copyPrompt(): Promise<void> {
  await copyText(
    agentPrompt.value,
    () => {
      promptCopied.value = true
    },
    '已复制规则提示词',
    '粘贴到新的 Agent 对话，再用一句话说明要做的脚本'
  )
}

const SKILL_ZIP_FILENAME = 'autoforge-script-create.zip'

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadSkill(): void {
  const skill = skillCreate.value
  const raw = skill?.raw?.trim() ?? ''
  if (!raw) {
    pushToast({ type: 'error', title: '下载失败', message: 'Skill 内容为空' })
    return
  }

  const folder = 'autoforge-script-create'
  const files = [
    { name: `${folder}/SKILL.md`, content: skill?.raw ?? '' },
    { name: `${folder}/reference.md`, content: skill?.reference ?? '' },
    { name: `${folder}/agent-prompt.md`, content: skill?.agentPrompt ?? '' }
  ].filter((file) => file.content.trim())

  const zip = createStoreZip(files)
  downloadBlob(new Blob([zip], { type: 'application/zip' }), SKILL_ZIP_FILENAME)
  pushToast({
    type: 'success',
    title: '已开始下载',
    message: '解压到 .cursor/skills/ 即可安装',
    duration: 2800
  })
}

const GUIDE_MARKDOWN_FILENAME = 'script-spec.md'

function downloadGuideMarkdown(): void {
  const content = markdown.value.trim()
  if (!content) {
    pushToast({ type: 'error', title: '下载失败', message: '开发规范内容为空' })
    return
  }

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  downloadBlob(blob, GUIDE_MARKDOWN_FILENAME)

  pushToast({
    type: 'success',
    title: '已开始下载',
    message: GUIDE_MARKDOWN_FILENAME,
    duration: 2200
  })
}

async function importExample(id: string): Promise<void> {
  importingId.value = id
  try {
    await window.autoforge.examples.import(id)
    emit('imported')
  } finally {
    importingId.value = null
  }
}

/** 轻量 markdown → HTML，覆盖 script-spec.md 常用语法 */
function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const html: string[] = []
  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []
  let inTable = false
  let tableRows: string[][] = []

  function flushCode(): void {
    if (!codeLines.length) return
    html.push(`<pre class="dev-guide-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeLines = []
  }

  function flushTable(): void {
    if (!tableRows.length) return
    const [header, ...body] = tableRows
    html.push('<div class="dev-guide-table-wrap"><table class="dev-guide-table"><thead><tr>')
    for (const cell of header) {
      html.push(`<th>${inlineFormat(cell.trim())}</th>`)
    }
    html.push('</tr></thead><tbody>')
    for (const row of body) {
      if (row.every((c) => /^[-:]+$/.test(c.trim()))) continue
      html.push('<tr>')
      for (const cell of row) {
        html.push(`<td>${inlineFormat(cell.trim())}</td>`)
      }
      html.push('</tr>')
    }
    html.push('</tbody></table></div>')
    tableRows = []
    inTable = false
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        flushCode()
        inCode = false
        codeLang = ''
      } else {
        inCode = true
        codeLang = line.slice(3).trim()
      }
      continue
    }
    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (line.includes('|') && line.trim().startsWith('|')) {
      if (!inTable) inTable = true
      tableRows.push(line.split('|').slice(1, -1))
      continue
    } else if (inTable) {
      flushTable()
    }

    if (line.startsWith('### ')) {
      html.push(`<h3 class="dev-guide-h3">${inlineFormat(line.slice(4))}</h3>`)
    } else if (line.startsWith('## ')) {
      html.push(`<h2 class="dev-guide-h2">${inlineFormat(line.slice(3))}</h2>`)
    } else if (line.startsWith('# ')) {
      html.push(`<h1 class="dev-guide-h1">${inlineFormat(line.slice(2))}</h1>`)
    } else if (line.startsWith('> ')) {
      html.push(`<blockquote class="dev-guide-quote">${inlineFormat(line.slice(2))}</blockquote>`)
    } else if (/^[-*] /.test(line)) {
      html.push(`<li class="dev-guide-li">${inlineFormat(line.slice(2))}</li>`)
    } else if (/^\d+\. /.test(line)) {
      html.push(`<li class="dev-guide-li dev-guide-oli">${inlineFormat(line.replace(/^\d+\. /, ''))}</li>`)
    } else if (line.trim() === '') {
      html.push('<div class="dev-guide-spacer"></div>')
    } else {
      html.push(`<p class="dev-guide-p">${inlineFormat(line)}</p>`)
    }
  }

  if (inCode) flushCode()
  if (inTable) flushTable()

  return html.join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inlineFormat(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code class="dev-guide-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

const guideHtml = computed(() => renderMarkdown(markdown.value))
</script>
<template>
  <AppFeatureModal
    :open="open"
    max-width="5xl"
    aria-labelledby="dev-guide-modal-title"
    @close="emit('close')"
  >
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
    <div class="relative flex items-center justify-between px-6 py-4 border-b sb-border-subtle flex-shrink-0 dev-guide-modal-header overflow-hidden">
      <div
        class="absolute inset-x-0 top-0 h-px pointer-events-none"
        style="background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sb-accent-solid) 50%, transparent), transparent)"
        aria-hidden="true"
      />
      <div class="flex items-start gap-3 min-w-0">
        <div class="w-9 h-9 rounded-lg sb-bg-inset border sb-border-subtle flex items-center justify-center flex-shrink-0">
          <BookOpen class="w-4 h-4 text-[var(--sb-accent-solid)]" :stroke-width="1.5" />
        </div>
      <div>
        <h1 id="dev-guide-modal-title" class="text-[15px] font-semibold sb-text-primary tracking-tight">脚本开发指南</h1>
        <p class="text-[11px] sb-text-muted mt-0.5">复制规则提示词，与 Agent 多轮澄清后再生成脚本</p>
      </div>
      </div>
      <button type="button" class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-secondary sb-bg-hover flex-shrink-0" title="关闭" @click="emit('close')">
        <X class="w-4 h-4" :stroke-width="1.5" />
      </button>
    </div>

    <div class="flex border-b sb-border-subtle px-6 flex-shrink-0">
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-2.5 text-[13px] transition-colors"
        :class="activeTab === 'agent' ? 'font-medium sb-text-primary border-b-2 border-[var(--sb-text-primary)] -mb-px' : 'sb-text-muted hover:sb-text-secondary'"
        @click="activeTab = 'agent'"
      >
        <MessageSquareText class="w-3.5 h-3.5" :stroke-width="1.5" />
        交给 Agent
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-2.5 text-[13px] transition-colors"
        :class="activeTab === 'guide' ? 'font-medium sb-text-primary border-b-2 border-[var(--sb-text-primary)] -mb-px' : 'sb-text-muted hover:sb-text-secondary'"
        @click="activeTab = 'guide'"
      >
        <BookOpen class="w-3.5 h-3.5" :stroke-width="1.5" />
        开发规范
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-2.5 text-[13px] transition-colors"
        :class="activeTab === 'examples' ? 'font-medium sb-text-primary border-b-2 border-[var(--sb-text-primary)] -mb-px' : 'sb-text-muted hover:sb-text-secondary'"
        @click="activeTab = 'examples'"
      >
        <FileCode2 class="w-3.5 h-3.5" :stroke-width="1.5" />
        示例脚本
        <span v-if="examples.length" class="text-[11px] sb-text-faint">({{ examples.length }})</span>
      </button>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center sb-text-muted text-sm">加载中…</div>

    <!-- 开发规范 -->
    <div v-else-if="activeTab === 'guide'" class="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div class="flex-shrink-0 flex items-center justify-between gap-3 px-6 pt-4 pb-2">
        <button
          type="button"
          class="text-left text-[12px] sb-text-muted hover:sb-text-secondary transition-colors min-w-0"
          @click="activeTab = 'agent'"
        >
          想直接开工？去「交给 Agent」复制规则提示词，先澄清再生成。
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 h-8 px-3 rounded-lg border sb-border text-[12px] sb-text-secondary hover:sb-bg-hover transition-colors flex-shrink-0"
          @click="downloadGuideMarkdown"
        >
          <Download class="w-3.5 h-3.5" :stroke-width="1.5" />
          下载 Markdown
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-6 pb-6 min-h-0">
        <article class="dev-guide max-w-3xl" v-html="guideHtml" />
      </div>
    </div>

    <!-- 交给 Agent -->
    <div v-else-if="activeTab === 'agent'" class="flex-1 overflow-y-auto px-6 py-5 min-h-0">
      <div class="dev-guide-forge">
        <aside class="dev-guide-rail" aria-label="对话阶段">
          <p class="dev-guide-kicker">Session</p>
          <ol class="dev-guide-stages">
            <li v-for="stage in forgeStages" :key="stage.n" class="dev-guide-stage">
              <span class="dev-guide-stage-no">{{ stage.n }}</span>
              <div>
                <p class="dev-guide-stage-title">{{ stage.title }}</p>
                <p class="dev-guide-stage-detail">{{ stage.detail }}</p>
              </div>
            </li>
          </ol>
          <div class="dev-guide-transcript" aria-hidden="true">
            <p class="dev-guide-kicker">一轮会这样走</p>
            <p><span>你</span>把订单表按日期拆开，结果要能在界面里打开。</p>
            <p><span>Agent</span>先定三件：语言用 Python 还是 JavaScript？文件是每次上传，还是固定目录？要不要产物目录？</p>
            <p><span>Agent</span>《脚本确认清单》已齐。回复「确认」后我才写代码。</p>
          </div>
        </aside>

        <section class="dev-guide-brief min-w-0">
          <p class="dev-guide-kicker">Forge brief</p>
          <h2 class="dev-guide-brief-title">先问清楚，再锻造</h2>
          <p class="dev-guide-brief-lead">
            复制规则提示词，整段发给 Agent。它会先澄清目录名、语言、env / params 和产物，你回复「确认」之后，才按 Autoforge 规范写脚本包。
          </p>

          <div class="flex flex-wrap items-center gap-2 mt-4">
            <button
              type="button"
              class="sb-btn-accent flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-medium disabled:opacity-50"
              :disabled="!agentPrompt"
              @click="copyPrompt"
            >
              <Check v-if="promptCopied" class="w-3.5 h-3.5" :stroke-width="1.5" />
              <Copy v-else class="w-3.5 h-3.5" :stroke-width="1.5" />
              {{ promptCopied ? '已复制，去新对话粘贴' : '复制规则提示词' }}
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 h-9 px-3 rounded-lg border sb-border text-[12px] sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-50"
              :disabled="!skillCreate?.raw"
              @click="downloadSkill"
            >
              <Download class="w-3.5 h-3.5" :stroke-width="1.5" />
              下载 Skill
            </button>
          </div>
          <p class="text-[11px] sb-text-faint mt-2 leading-relaxed">
            提示词自包含，贴到任意 Agent 即可开聊。下载的 zip 解压到
            <code class="dev-guide-inline-code">.cursor/skills/</code>
            后，对话里输入
            <code class="dev-guide-inline-code">/autoforge-script-create</code>
            也会走同一套澄清。
          </p>

          <div class="dev-guide-ticket mt-4">
            <div class="dev-guide-ticket-head">
              <span class="dev-guide-stamp">确认前不写代码</span>
              <span class="dev-guide-ticket-meta">agent-prompt · {{ promptLineCount }} 行</span>
              <button
                v-if="promptLineCount > 18"
                type="button"
                class="dev-guide-ticket-toggle"
                @click="promptExpanded = !promptExpanded"
              >
                {{ promptExpanded ? '收起' : '展开全文' }}
              </button>
            </div>
            <pre class="dev-guide-ticket-body" :class="{ 'is-expanded': promptExpanded }">{{ promptPreview || '未找到 agent-prompt.md' }}</pre>
          </div>
        </section>
      </div>
    </div>

    <!-- 示例脚本 -->
    <div v-else class="flex-1 overflow-y-auto px-6 py-6">
      <p class="text-[13px] sb-text-muted mb-4">
        以下示例随应用内置，点击「添加到我的脚本」即可复制到工作区并运行。建议从 <strong class="sb-text-secondary">hello-world</strong> 开始。
      </p>
      <div v-if="!examples.length" class="text-center sb-text-muted text-sm py-12">未找到示例脚本</div>
      <div v-else class="grid gap-3 max-w-2xl">
        <div
          v-for="ex in examples"
          :key="ex.id"
          class="rounded-xl border sb-border sb-bg-surface p-4 flex items-start gap-4"
        >
          <div class="w-10 h-10 rounded-lg sb-bg-inset flex items-center justify-center flex-shrink-0">
            <FileCode2 class="w-5 h-5 sb-text-muted" :stroke-width="1.5" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-[14px] font-medium sb-text-primary">{{ ex.name }}</h3>
              <span class="text-[10px] px-1.5 py-0.5 rounded border sb-border sb-text-faint font-mono">{{ ex.version }}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded sb-bg-inset sb-text-muted">{{ ex.categoryLabel }}</span>
            </div>
            <p class="text-[12px] sb-text-muted mt-1">{{ ex.description || '无描述' }}</p>
            <p class="text-[11px] sb-text-faint mt-1 font-mono">examples/{{ ex.id }}/</p>
          </div>
          <button
            type="button"
            class="flex items-center gap-1.5 h-8 px-3 rounded-lg sb-btn-accent text-[12px] font-medium flex-shrink-0 disabled:opacity-50"
            :disabled="importingId === ex.id"
            @click="importExample(ex.id)"
          >
            <Download class="w-3.5 h-3.5" :stroke-width="1.5" />
            {{ importingId === ex.id ? '导入中…' : '添加到我的脚本' }}
          </button>
        </div>
      </div>
    </div>
    </div>
  </AppFeatureModal>
</template>

<style scoped>
.dev-guide-modal-header {
  background: color-mix(in srgb, var(--sb-accent-solid) 8%, var(--sb-bg-panel));
  box-shadow: inset 3px 0 0 var(--sb-accent-solid);
}

.dev-guide,
.dev-guide :deep(*) {
  user-select: text;
  cursor: text;
}

.dev-guide :deep(.dev-guide-h1) {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--sb-text-primary);
  margin-bottom: 0.75rem;
}
.dev-guide :deep(.dev-guide-h2) {
  font-size: 1rem;
  font-weight: 600;
  color: var(--sb-text-secondary);
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
}
.dev-guide :deep(.dev-guide-h3) {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--sb-text-secondary);
  margin-top: 1rem;
  margin-bottom: 0.375rem;
}
.dev-guide :deep(.dev-guide-p) {
  font-size: 0.8125rem;
  color: var(--sb-text-muted);
  line-height: 1.65;
  margin-bottom: 0.5rem;
}
.dev-guide :deep(.dev-guide-li) {
  font-size: 0.8125rem;
  color: var(--sb-text-muted);
  margin-left: 1.25rem;
  margin-bottom: 0.25rem;
  list-style: disc;
}
.dev-guide :deep(.dev-guide-quote) {
  border-left: 3px solid var(--sb-border);
  padding-left: 0.75rem;
  font-size: 0.8125rem;
  color: var(--sb-text-muted);
  margin: 0.75rem 0;
}
.dev-guide :deep(.dev-guide-code) {
  background: var(--sb-bg-log, rgba(0, 0, 0, 0.3));
  border: 1px solid var(--sb-border-subtle);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  font-family: ui-monospace, monospace;
  color: var(--sb-text-secondary);
  overflow-x: auto;
  margin: 0.5rem 0 0.75rem;
  white-space: pre-wrap;
}
.dev-guide :deep(.dev-guide-inline-code) {
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  background: var(--sb-bg-inset);
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
  color: var(--sb-text-secondary);
}
.dev-guide :deep(.dev-guide-table-wrap) {
  overflow-x: auto;
  margin: 0.75rem 0;
}
.dev-guide :deep(.dev-guide-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}
.dev-guide :deep(.dev-guide-table th),
.dev-guide :deep(.dev-guide-table td) {
  border: 1px solid var(--sb-border-subtle);
  padding: 0.375rem 0.625rem;
  text-align: left;
}
.dev-guide :deep(.dev-guide-table th) {
  background: var(--sb-bg-surface);
  color: var(--sb-text-secondary);
  font-weight: 500;
}
.dev-guide :deep(.dev-guide-table td) {
  color: var(--sb-text-muted);
}
.dev-guide :deep(.dev-guide-spacer) {
  height: 0.25rem;
}

.dev-guide-inline-code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.6875rem;
  background: var(--sb-bg-inset);
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
  color: var(--sb-text-secondary);
}

.dev-guide-forge {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}

.dev-guide-kicker {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--sb-text-faint);
}

.dev-guide-stages {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.dev-guide-stage {
  display: grid;
  grid-template-columns: 1.6rem minmax(0, 1fr);
  gap: 0.55rem;
  position: relative;
}

.dev-guide-stage:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 0.72rem;
  top: 1.15rem;
  bottom: -0.85rem;
  width: 1px;
  background: color-mix(in srgb, var(--sb-accent-solid) 35%, var(--sb-border-subtle));
}

.dev-guide-stage-no {
  font-family: Syne, ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: var(--sb-accent-solid);
  padding-top: 0.1rem;
}

.dev-guide-stage-title {
  font-family: Syne, ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: var(--sb-text-primary);
  line-height: 1.2;
}

.dev-guide-stage-detail {
  margin-top: 0.2rem;
  font-size: 11px;
  line-height: 1.45;
  color: var(--sb-text-muted);
}

.dev-guide-transcript {
  margin-top: 1.25rem;
  padding-top: 0.9rem;
  border-top: 1px dashed var(--sb-border-subtle);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.dev-guide-transcript p {
  font-size: 11px;
  line-height: 1.5;
  color: var(--sb-text-muted);
}

.dev-guide-transcript span {
  display: block;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sb-text-faint);
  margin-bottom: 0.15rem;
}

.dev-guide-brief-title {
  font-family: Syne, ui-sans-serif, system-ui, sans-serif;
  font-size: 1.65rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: var(--sb-text-primary);
  margin-top: 0.35rem;
}

.dev-guide-brief-lead {
  margin-top: 0.65rem;
  max-width: 38rem;
  font-size: 13px;
  line-height: 1.6;
  color: var(--sb-text-muted);
}

.dev-guide-ticket {
  position: relative;
  border: 1px solid var(--sb-border-subtle);
  border-radius: 0.85rem;
  background: var(--sb-bg-log, rgba(0, 0, 0, 0.28));
  overflow: hidden;
}

.dev-guide-ticket::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 14px;
  background: radial-gradient(circle at 0 11px, var(--sb-bg-panel) 6px, transparent 7px) 0 0 / 14px 22px repeat-y;
  pointer-events: none;
}

.dev-guide-ticket-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.8rem 0.55rem 1.15rem;
  border-bottom: 1px dashed var(--sb-border-subtle);
}

.dev-guide-stamp {
  font-family: Syne, ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--sb-accent-solid);
  border: 1.5px solid color-mix(in srgb, var(--sb-accent-solid) 70%, transparent);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  transform: rotate(-2deg);
}

.dev-guide-ticket-meta,
.dev-guide-ticket-toggle {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10px;
  color: var(--sb-text-faint);
}

.dev-guide-ticket-toggle {
  margin-left: auto;
  color: var(--sb-text-secondary);
}

.dev-guide-ticket-toggle:hover {
  color: var(--sb-text-primary);
}

.dev-guide-ticket-body {
  margin: 0;
  padding: 0.85rem 0.9rem 1rem 1.35rem;
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.55;
  color: var(--sb-text-secondary);
  user-select: text;
  cursor: text;
}

.dev-guide-ticket-body.is-expanded {
  max-height: min(52vh, 520px);
}

@media (max-width: 860px) {
  .dev-guide-forge {
    grid-template-columns: 1fr;
  }
}
</style>
