import { ref, type Ref } from 'vue'
import {
  applyImageDataUrls,
  collectRelativeImageSrcs,
  renderScriptReadmeMarkdown
} from '../lib/script-readme-markdown'

export const SCRIPT_README_EMPTY_MESSAGE = '暂无说明文档'
export const SCRIPT_README_FILENAME = 'README.md'

export function useScriptReadme(scriptId: Ref<string>) {
  const loading = ref(false)
  const empty = ref(true)
  const html = ref('')
  let loadGeneration = 0

  function isCurrentLoad(capturedScriptId: string, capturedGeneration: number): boolean {
    return scriptId.value === capturedScriptId && loadGeneration === capturedGeneration
  }

  function reset(): void {
    loading.value = false
    empty.value = true
    html.value = ''
  }

  async function load(): Promise<void> {
    const capturedScriptId = scriptId.value
    const capturedGeneration = ++loadGeneration
    loading.value = true
    empty.value = true
    html.value = ''
    try {
      const file = await window.autoforge.scripts.readFile(capturedScriptId, SCRIPT_README_FILENAME)
      if (!isCurrentLoad(capturedScriptId, capturedGeneration)) return
      if (!file || file.binary || !file.content?.trim()) {
        return
      }

      let rendered = renderScriptReadmeMarkdown(file.content)
      const relSrcs = collectRelativeImageSrcs(rendered)
      const dataUrls: Record<string, string> = {}

      await Promise.all(
        relSrcs.map(async (rel) => {
          try {
            const asset = await window.autoforge.scripts.readFile(capturedScriptId, rel)
            if (!isCurrentLoad(capturedScriptId, capturedGeneration)) return
            if (asset?.encoding === 'base64' && asset.mimeType && asset.content) {
              dataUrls[rel] = `data:${asset.mimeType};base64,${asset.content}`
            }
          } catch {
            /* Single image failures should not block the README body. */
          }
        })
      )
      if (!isCurrentLoad(capturedScriptId, capturedGeneration)) return

      if (Object.keys(dataUrls).length) {
        rendered = applyImageDataUrls(rendered, dataUrls)
      }

      html.value = rendered
      empty.value = !rendered.trim()
    } catch {
      if (!isCurrentLoad(capturedScriptId, capturedGeneration)) return
      empty.value = true
      html.value = ''
    } finally {
      if (isCurrentLoad(capturedScriptId, capturedGeneration)) {
        loading.value = false
      }
    }
  }

  return { loading, empty, html, load, reset }
}
