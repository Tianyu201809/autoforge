import { computed, ref, type Ref } from 'vue'
import { MANIFEST_FILENAME } from '../../../shared/script-contract'
import type { ScriptFileContent, ScriptWorkspaceFilesInfo } from '../../../shared/types/script'

export interface ScriptFileState {
  content: string
  savedContent: string
  binary: boolean
  loaded: boolean
}

export function languageForPath(path: string): 'javascript' | 'json' {
  if (path.endsWith('.json')) return 'json'
  return 'javascript'
}

export function useScriptFileEditor(scriptId: Ref<string>, entryPath: Ref<string>) {
  const files = ref<string[]>([])
  const manifestPath = ref(MANIFEST_FILENAME)
  const activePath = ref('')
  const fileStates = ref<Record<string, ScriptFileState>>({})
  const loading = ref(false)
  const loadingFile = ref(false)

  const activeState = computed(() => fileStates.value[activePath.value])

  const activeContent = computed({
    get: () => activeState.value?.content ?? '',
    set: (value: string) => {
      const path = activePath.value
      const state = fileStates.value[path]
      if (!state || state.binary) return
      fileStates.value[path] = { ...state, content: value }
    }
  })

  const editDirty = computed(() => {
    const state = activeState.value
    if (!state?.loaded || state.binary) return false
    return state.content !== state.savedContent
  })

  const isAnyDirty = computed(() =>
    Object.values(fileStates.value).some(
      (state) => state.loaded && !state.binary && state.content !== state.savedContent
    )
  )

  const editLanguage = computed(() => languageForPath(activePath.value))
  const editReadonly = computed(() => activeState.value?.binary ?? false)

  function isFileDirty(path: string): boolean {
    const state = fileStates.value[path]
    if (!state?.loaded || state.binary) return false
    return state.content !== state.savedContent
  }

  function ensureFileState(path: string, patch: Partial<ScriptFileState>): void {
    const prev = fileStates.value[path]
    fileStates.value[path] = {
      content: patch.content ?? prev?.content ?? '',
      savedContent: patch.savedContent ?? prev?.savedContent ?? '',
      binary: patch.binary ?? prev?.binary ?? false,
      loaded: patch.loaded ?? prev?.loaded ?? false
    }
  }

  async function loadFileList(): Promise<void> {
    loading.value = true
    try {
      const info = await window.autoforge.scripts.listFiles(scriptId.value)
      if (!info) return
      files.value = info.files
      manifestPath.value = info.manifestPath
      const initial = info.files.includes(entryPath.value)
        ? entryPath.value
        : info.files[0] ?? entryPath.value
      if (!activePath.value || !info.files.includes(activePath.value)) {
        activePath.value = initial
      }
      for (const path of info.files) {
        if (!fileStates.value[path]) {
          ensureFileState(path, { loaded: false })
        }
      }
      await selectFile(activePath.value)
    } finally {
      loading.value = false
    }
  }

  async function selectFile(path: string): Promise<void> {
    if (!path) return
    activePath.value = path
    const state = fileStates.value[path]
    if (state?.loaded) return

    loadingFile.value = true
    try {
      const file = await window.autoforge.scripts.readFile(scriptId.value, path)
      if (!file) return
      applyFileContent(file)
    } finally {
      loadingFile.value = false
    }
  }

  function applyFileContent(file: ScriptFileContent): void {
    ensureFileState(file.path, {
      content: file.content,
      savedContent: file.content,
      binary: file.binary,
      loaded: true
    })
  }

  async function saveActiveFile(): Promise<boolean> {
    const path = activePath.value
    const state = fileStates.value[path]
    if (!state?.loaded || state.binary || !editDirty.value) return true
    return saveFile(path, state.content, scriptId.value)
  }

  async function saveFile(path: string, content: string, id = scriptId.value): Promise<boolean> {
    const state = fileStates.value[path]
    if (!state?.loaded || state.binary) return true
    const ok = await window.autoforge.scripts.writeFile(id, path, content)
    if (ok) {
      fileStates.value[path] = { ...state, content, savedContent: content }
    }
    return ok
  }

  function getDirtyPaths(): string[] {
    return Object.entries(fileStates.value)
      .filter(([, state]) => state.loaded && !state.binary && state.content !== state.savedContent)
      .map(([path]) => path)
  }

  async function saveAllDirtyFiles(id = scriptId.value): Promise<boolean> {
    let allOk = true
    for (const path of getDirtyPaths()) {
      const state = fileStates.value[path]
      if (!state) continue
      const ok = await saveFile(path, state.content, id)
      if (!ok) allOk = false
    }
    return allOk
  }

  function revertAllDirty(): void {
    for (const [path, state] of Object.entries(fileStates.value)) {
      if (state.loaded && !state.binary && state.content !== state.savedContent) {
        fileStates.value[path] = { ...state, content: state.savedContent }
      }
    }
  }

  function getSnapshot(activeOnly = false): {
    files: string[]
    manifestPath: string
    activeFilePath: string
    fileStates: Record<string, ScriptFileState>
  } {
    if (!activeOnly) {
      return {
        files: [...files.value],
        manifestPath: manifestPath.value,
        activeFilePath: activePath.value,
        fileStates: JSON.parse(JSON.stringify(fileStates.value)) as Record<string, ScriptFileState>
      }
    }
    const path = activePath.value
    const state = fileStates.value[path]
    return {
      files: [...files.value],
      manifestPath: manifestPath.value,
      activeFilePath: path,
      fileStates: state ? { [path]: { ...state } } : {}
    }
  }

  function applySnapshot(snapshot: {
    files?: string[]
    manifestPath?: string
    activeFilePath?: string
    fileStates?: Record<string, ScriptFileState>
  }): void {
    if (snapshot.files) files.value = snapshot.files
    if (snapshot.manifestPath) manifestPath.value = snapshot.manifestPath
    if (snapshot.fileStates) {
      for (const [path, state] of Object.entries(snapshot.fileStates)) {
        ensureFileState(path, state)
      }
    }
    if (snapshot.activeFilePath) activePath.value = snapshot.activeFilePath
  }

  function mergeFileFromSync(path: string, content: string): void {
    const state = fileStates.value[path]
    if (!state) {
      ensureFileState(path, { content, savedContent: content, binary: false, loaded: true })
      return
    }
    const dirty = state.content !== state.savedContent
    if (!dirty || path === activePath.value) {
      fileStates.value[path] = { ...state, content, loaded: true }
    }
  }

  function markSaved(path: string, content?: string): void {
    const state = fileStates.value[path]
    if (!state) return
    const nextContent = content ?? state.content
    fileStates.value[path] = {
      ...state,
      content: nextContent,
      savedContent: nextContent,
      loaded: true
    }
  }

  function reset(): void {
    files.value = []
    manifestPath.value = MANIFEST_FILENAME
    activePath.value = ''
    fileStates.value = {}
  }

  return {
    files,
    manifestPath,
    activePath,
    fileStates,
    loading,
    loadingFile,
    activeContent,
    editDirty,
    isAnyDirty,
    editLanguage,
    editReadonly,
    isFileDirty,
    loadFileList,
    selectFile,
    applyFileContent,
    saveActiveFile,
    saveAllDirtyFiles,
    getDirtyPaths,
    revertAllDirty,
    getSnapshot,
    applySnapshot,
    mergeFileFromSync,
    markSaved,
    reset
  }
}
