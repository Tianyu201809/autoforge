<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Save } from 'lucide-vue-next'
import CodeEditor from './components/CodeEditor.vue'
import PopoutTitleBar from './components/PopoutTitleBar.vue'
import ScriptWorkspaceSidebar from './components/ScriptWorkspaceSidebar.vue'
import type { EditorSessionPayload } from './env.d.ts'
import { useScriptFileEditor } from './composables/useScriptFileEditor'
import { useToast } from './composables/useToast'

const { pushToast } = useToast()

const session = ref<EditorSessionPayload | null>(null)
const pinned = ref(false)
const saving = ref(false)

const scriptIdRef = computed(() => session.value?.scriptId ?? '')
const entryPathRef = computed(() => session.value?.entryPath ?? '')
const {
  files: workspaceFiles,
  activePath: activeFilePath,
  activeContent,
  editDirty,
  editLanguage,
  editReadonly,
  loadingFile,
  selectFile,
  saveActiveFile,
  applySnapshot,
  isFileDirty
} = useScriptFileEditor(scriptIdRef, entryPathRef)

const editorBreadcrumb = computed(() =>
  session.value ? `编辑 · ${session.value.scriptName}` : '编辑'
)

function applySession(next: EditorSessionPayload): void {
  session.value = next
  applySnapshot({
    files: next.files,
    manifestPath: next.manifestPath,
    activeFilePath: next.activeFilePath,
    fileStates: next.fileStates
  })
}

function syncToMain(): void {
  if (!session.value || editReadonly.value) return
  void window.autoforge.editor.sync({
    scriptId: session.value.scriptId,
    activeFilePath: activeFilePath.value,
    filePath: activeFilePath.value,
    content: activeContent.value
  })
}

let syncTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSync(): void {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(syncToMain, 120)
}

watch(activeContent, scheduleSync)
watch(activeFilePath, syncToMain)

let unsubInit: (() => void) | undefined

onMounted(async () => {
  pinned.value = await window.autoforge.editor.isPinned()
  const existing = await window.autoforge.editor.getSession()
  if (existing) applySession(existing)

  unsubInit = window.autoforge.editor.onInit((next) => {
    applySession(next)
  })
})

onUnmounted(() => {
  unsubInit?.()
  clearTimeout(syncTimer)
})

async function togglePin(): Promise<void> {
  pinned.value = await window.autoforge.editor.togglePin()
}

async function dockBack(): Promise<void> {
  syncToMain()
  await window.autoforge.editor.close()
}

async function saveScript(): Promise<void> {
  if (!session.value || !editDirty.value || editReadonly.value) return
  saving.value = true
  const path = activeFilePath.value
  try {
    const ok = await saveActiveFile()
    if (ok) {
      await window.autoforge.editor.notifySaved(session.value.scriptId, path)
      pushToast({ type: 'success', title: '已保存', message: path })
    } else {
      pushToast({ type: 'error', title: '保存失败', message: `无法保存 ${path}` })
    }
  } catch (err) {
    pushToast({
      type: 'error',
      title: '保存失败',
      message: err instanceof Error ? err.message : `无法保存 ${path}`
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-full sb-bg-panel">
    <PopoutTitleBar
      :breadcrumb="editorBreadcrumb"
      :pinned="pinned"
      @toggle-pin="togglePin"
      @dock="dockBack"
    />

    <div class="flex-1 flex min-h-0">
      <ScriptWorkspaceSidebar
        variant="flush"
        expanded-width-class="w-44"
        storage-key="autoforge-editor-workspace-sidebar"
        title="工作区文件"
        :files="workspaceFiles"
        :active-path="activeFilePath"
        :is-dirty="isFileDirty"
        @select="(path) => void selectFile(path)"
      />

      <div class="flex-1 flex flex-col p-3 gap-2 min-h-0 min-w-0">
        <div v-if="loadingFile" class="text-[12px] sb-text-faint px-1">加载文件中…</div>
        <CodeEditor
          v-model="activeContent"
          :filename="activeFilePath"
          :language="editLanguage"
          :dirty="editDirty"
          :placeholder="editReadonly ? '此文件为二进制格式，无法在编辑器中修改' : '// 在此编辑文件…'"
          standalone
        />
        <button
          type="button"
          class="flex items-center justify-center gap-1.5 h-8 rounded-lg sb-btn-accent text-[13px] font-medium hover:opacity-90 transition-colors disabled:opacity-50 flex-shrink-0"
          :disabled="saving || !editDirty || editReadonly"
          @click="saveScript"
        >
          <Save class="w-3.5 h-3.5" :stroke-width="1.5" />
          {{ saving ? '保存中…' : editDirty ? '保存更改' : '已保存' }}
        </button>
      </div>
    </div>
  </div>
</template>
