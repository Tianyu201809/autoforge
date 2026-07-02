import { computed, ref, type Ref } from 'vue'
import { MANIFEST_FILENAME } from '../../../shared/script-contract'

/** 仅加载与编辑脚本的 autoforge.json 清单 */
export function useManifestEditor(scriptId: Ref<string>) {
  const content = ref('')
  const savedContent = ref('')
  const loadingFile = ref(false)
  const binary = ref(false)
  const loaded = ref(false)

  const activeContent = computed({
    get: () => content.value,
    set: (value: string) => {
      if (binary.value) return
      content.value = value
    }
  })

  const editDirty = computed(() => loaded.value && !binary.value && content.value !== savedContent.value)
  const isDirty = editDirty
  const editReadonly = computed(() => binary.value)

  async function loadManifest(): Promise<void> {
    loadingFile.value = true
    try {
      const file = await window.autoforge.scripts.readFile(scriptId.value, MANIFEST_FILENAME)
      if (!file) {
        content.value = ''
        savedContent.value = ''
        binary.value = false
        loaded.value = false
        return
      }
      content.value = file.content
      savedContent.value = file.content
      binary.value = file.binary
      loaded.value = true
    } finally {
      loadingFile.value = false
    }
  }

  async function saveManifest(id = scriptId.value): Promise<boolean> {
    if (!loaded.value || binary.value || !editDirty.value) return true
    const ok = await window.autoforge.scripts.writeFile(id, MANIFEST_FILENAME, content.value)
    if (ok && id === scriptId.value) savedContent.value = content.value
    return ok
  }

  function revertManifest(): void {
    if (!loaded.value || binary.value) return
    content.value = savedContent.value
  }

  function reset(): void {
    content.value = ''
    savedContent.value = ''
    binary.value = false
    loaded.value = false
  }

  return {
    activeContent,
    editDirty,
    isDirty,
    editReadonly,
    loadingFile,
    loadManifest,
    saveManifest,
    revertManifest,
    reset
  }
}
