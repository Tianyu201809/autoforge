<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileText, Paperclip, Trash2, Upload } from 'lucide-vue-next'
import {
  parseParamAttachments,
  serializeParamAttachments,
  type ParamAttachmentItem
} from '../../../shared/param-attachments'

const props = defineProps<{
  modelValue: string
  scriptId: string
  paramKey: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const uploading = ref(false)

const items = computed({
  get: () => parseParamAttachments(props.modelValue),
  set: (next: ParamAttachmentItem[]) => {
    emit('update:modelValue', serializeParamAttachments(next))
  }
})

function formatSize(bytes?: number): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function addFiles(): Promise<void> {
  if (uploading.value) return
  const selected = await window.autoforge.scripts.openAttachmentDialog()
  if (!selected?.length) return

  uploading.value = true
  try {
    const staged = await window.autoforge.scripts.stageAttachments(
      props.scriptId,
      props.paramKey,
      selected
    )
    if (!staged.length) return
    items.value = [...items.value, ...staged]
  } finally {
    uploading.value = false
  }
}

function removeItem(item: ParamAttachmentItem): void {
  items.value = items.value.filter((entry) => entry.path !== item.path)
}
</script>

<template>
  <div class="mt-1 space-y-2">
    <ul v-if="items.length" class="space-y-1.5">
      <li
        v-for="item in items"
        :key="item.path"
        class="flex items-center gap-2 px-2.5 py-2 rounded-lg border sb-border-subtle sb-bg-surface"
      >
        <FileText class="w-3.5 h-3.5 flex-shrink-0 sb-text-faint" :stroke-width="1.5" />
        <div class="flex-1 min-w-0">
          <p class="text-[12px] sb-text-secondary truncate" :title="item.name">{{ item.name }}</p>
          <p v-if="item.size != null" class="text-[10px] sb-text-faint">{{ formatSize(item.size) }}</p>
        </div>
        <button
          type="button"
          class="w-7 h-7 flex items-center justify-center rounded-md sb-text-muted hover:text-red-400 hover:sb-bg-inset transition-colors flex-shrink-0"
          title="移除"
          @click="removeItem(item)"
        >
          <Trash2 class="w-3.5 h-3.5" :stroke-width="1.5" />
        </button>
      </li>
    </ul>

    <p v-else class="text-[11px] sb-text-faint px-1">尚未添加附件</p>

    <button
      type="button"
      class="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg border border-dashed sb-border-subtle sb-bg-input text-[12px] sb-text-muted hover:sb-text-secondary hover:border-[var(--sb-border)] transition-colors disabled:opacity-50"
      :disabled="uploading"
      @click="addFiles"
    >
      <Upload v-if="!uploading" class="w-3.5 h-3.5" :stroke-width="1.5" />
      <Paperclip v-else class="w-3.5 h-3.5 animate-pulse" :stroke-width="1.5" />
      {{ uploading ? '上传中…' : '选择文件' }}
    </button>
    <p class="text-[10px] sb-text-faint">支持多选；文件会复制到本地缓存，脚本通过 JSON 解析 ctx.params 获取路径</p>
  </div>
</template>
