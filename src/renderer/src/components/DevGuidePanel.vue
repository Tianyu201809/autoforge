<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BookOpen, Download, FileCode2, Route, X } from 'lucide-vue-next'
import type { BundledExampleInfo } from '../../../shared/types/script'

const emit = defineEmits<{ close: []; imported: [] }>()

const activeTab = ref<'guide' | 'skillCreate' | 'examples'>('guide')
const markdown = ref('')
const skillCreateMarkdown = ref('')
const examples = ref<BundledExampleInfo[]>([])
const importingId = ref<string | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const [md, skillMd, list] = await Promise.all([
      window.autoforge.devGuide.get(),
      window.autoforge.devGuide.getSkillCreate(),
      window.autoforge.examples.list()
    ])
    markdown.value = md
    skillCreateMarkdown.value = skillMd
    examples.value = list
  } finally {
    loading.value = false
  }
})

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
const skillCreateHtml = computed(() => renderMarkdown(skillCreateMarkdown.value))
</script>
<template>
  <main class="flex-1 flex flex-col min-w-0 sb-bg-base overflow-hidden">
    <div class="flex items-center justify-between px-6 py-4 border-b sb-border-subtle flex-shrink-0">
      <div>
        <h1 class="text-xl font-semibold sb-text-primary">脚本开发指南</h1>
        <p class="text-[13px] sb-text-muted mt-0.5">Autoforge 脚本包规范、API 说明与内置示例</p>
      </div>
      <button type="button" class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-secondary sb-bg-hover" @click="emit('close')">
        <X class="w-4 h-4" :stroke-width="1.5" />
      </button>
    </div>

    <div class="flex border-b sb-border-subtle px-6 flex-shrink-0">
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
        :class="activeTab === 'skillCreate' ? 'font-medium sb-text-primary border-b-2 border-[var(--sb-text-primary)] -mb-px' : 'sb-text-muted hover:sb-text-secondary'"
        @click="activeTab = 'skillCreate'"
      >
        <Route class="w-3.5 h-3.5" :stroke-width="1.5" />
        脚本创建流程
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
    <div v-else-if="activeTab === 'guide'" class="flex-1 overflow-y-auto px-6 py-6">
      <article class="dev-guide max-w-3xl" v-html="guideHtml" />
    </div>

    <!-- 脚本创建流程（autoforge-script-create skill） -->
    <div v-else-if="activeTab === 'skillCreate'" class="flex-1 overflow-y-auto px-6 py-6">
      <article class="dev-guide max-w-3xl" v-html="skillCreateHtml" />
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
  </main>
</template>

<style scoped>
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
</style>
