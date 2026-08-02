<script setup lang="ts">
import { computed, ref } from 'vue'
import { Eye, EyeOff, X } from 'lucide-vue-next'
import type { ParamOption, ParamValueType } from '../../../shared/script-contract'
import { parseParamAttachments } from '../../../shared/param-attachments'
import { parseCheckboxValue, toggleCheckboxValue } from '../../../shared/param-choices'
import ParamAttachmentField from './ParamAttachmentField.vue'

export interface SchemaFieldDef {
  key: string
  label: string
  description?: string
  required?: boolean
  secret?: boolean
  type?: ParamValueType
  options?: ParamOption[]
  default?: string
}

const props = withDefaults(
  defineProps<{
    modelValue?: string
    def: SchemaFieldDef
    scriptId?: string
    /** 附件缓存目录 scope，默认使用 def.key */
    attachmentStorageKey?: string
    showClear?: boolean
    showKey?: boolean
    attachmentHint?: string
  }>(),
  {
    modelValue: '',
    showClear: false,
    showKey: true,
    attachmentHint: '支持多选；文件会复制到本地缓存，脚本通过 JSON 解析获取路径'
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  clear: []
}>()

const fieldId = computed(() => props.def.key)
const passwordVisible = ref(false)

function updateValue(value: string): void {
  emit('update:modelValue', value)
}

function emptyValue(): string {
  if (props.def.type === 'attachment' || props.def.type === 'checkbox') return '[]'
  if (props.def.type === 'boolean') return 'false'
  return ''
}

function hasValue(): boolean {
  const raw = props.modelValue ?? ''
  if (props.def.type === 'attachment') return parseParamAttachments(raw).length > 0
  if (props.def.type === 'checkbox') return parseCheckboxValue(raw).length > 0
  if (props.def.type === 'boolean') return raw === 'true'
  return raw.trim().length > 0
}

function isCheckboxChecked(value: string): boolean {
  return parseCheckboxValue(props.modelValue).includes(value)
}

function toggleCheckbox(value: string): void {
  updateValue(toggleCheckboxValue(props.modelValue, value))
}

function setBoolean(checked: boolean): void {
  updateValue(checked ? 'true' : 'false')
}

function handleClear(): void {
  updateValue(emptyValue())
  emit('clear')
}

const attachmentKey = computed(() => props.attachmentStorageKey ?? props.def.key)
</script>

<template>
  <div>
    <div v-if="showClear" class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <label class="sb-field-title">
          {{ def.label }}
          <span v-if="def.required" class="text-red-400">*</span>
        </label>
        <p v-if="def.description" class="text-[11px] sb-text-faint mt-0.5">{{ def.description }}</p>
      </div>
      <button
        v-if="hasValue()"
        type="button"
        class="flex-shrink-0 text-[11px] sb-text-muted hover:text-red-400 flex items-center gap-0.5 transition-colors"
        title="清除"
        @click="handleClear"
      >
        <X class="w-3 h-3" :stroke-width="1.5" />
        清除
      </button>
    </div>
    <template v-else>
      <label class="sb-field-title">
        {{ def.label }}
        <span v-if="def.required" class="text-red-400">*</span>
      </label>
      <p v-if="def.description" class="text-[11px] sb-text-faint mt-0.5">{{ def.description }}</p>
    </template>

    <ParamAttachmentField
      v-if="def.type === 'attachment' && scriptId"
      :model-value="modelValue"
      :script-id="scriptId"
      :param-key="attachmentKey"
      @update:model-value="updateValue"
    />
    <textarea
      v-else-if="def.type === 'textarea'"
      :value="modelValue"
      rows="3"
      class="mt-1 w-full px-3 py-2 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input resize-y"
      :placeholder="def.default ? `默认: ${def.default}` : def.required ? '必填' : '可选'"
      @input="updateValue(($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <select
      v-else-if="def.type === 'select'"
      :value="modelValue"
      class="mt-1 w-full h-8 px-2 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input"
      @change="updateValue(($event.target as HTMLSelectElement).value)"
    >
      <option value="">{{ def.required ? '请选择' : '（不选择）' }}</option>
      <option v-for="opt in def.options ?? []" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <div v-else-if="def.type === 'radio'" class="mt-1.5 space-y-1.5">
      <label
        v-for="opt in def.options ?? []"
        :key="opt.value"
        class="flex items-center gap-2 text-[13px] sb-text-secondary cursor-pointer"
      >
        <input
          type="radio"
          :name="`schema-${fieldId}`"
          :value="opt.value"
          :checked="modelValue === opt.value"
          class="accent-[var(--sb-accent)]"
          @change="updateValue(opt.value)"
        />
        {{ opt.label }}
      </label>
    </div>
    <div v-else-if="def.type === 'checkbox'" class="mt-1.5 space-y-1.5">
      <label
        v-for="opt in def.options ?? []"
        :key="opt.value"
        class="flex items-center gap-2 text-[13px] sb-text-secondary cursor-pointer"
      >
        <input
          type="checkbox"
          :checked="isCheckboxChecked(opt.value)"
          class="accent-[var(--sb-accent)]"
          @change="toggleCheckbox(opt.value)"
        />
        {{ opt.label }}
      </label>
    </div>
    <label
      v-else-if="def.type === 'boolean'"
      class="mt-1.5 flex items-center gap-2 text-[13px] sb-text-secondary cursor-pointer"
    >
      <input
        type="checkbox"
        :checked="modelValue === 'true'"
        class="accent-[var(--sb-accent)]"
        @change="setBoolean(($event.target as HTMLInputElement).checked)"
      />
      {{ modelValue === 'true' ? '已开启' : '已关闭' }}
    </label>
    <input
      v-else-if="def.type === 'number'"
      :value="modelValue"
      type="number"
      class="mt-1 w-full h-8 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input"
      :placeholder="def.default ? `默认: ${def.default}` : def.required ? '必填' : '可选'"
      @input="updateValue(($event.target as HTMLInputElement).value)"
    />
    <div v-else class="relative mt-1">
      <input
        :value="modelValue"
        :type="def.secret && !passwordVisible ? 'password' : 'text'"
        class="w-full h-8 px-3 rounded-lg sb-bg-input border sb-border text-[13px] outline-none focus:sb-input"
        :class="def.secret && 'pr-9'"
        :placeholder="def.default ? `默认: ${def.default}` : def.required ? '必填' : '可选'"
        @input="updateValue(($event.target as HTMLInputElement).value)"
      />
      <button
        v-if="def.secret"
        type="button"
        class="absolute right-2 top-1/2 -translate-y-1/2 p-1 sb-text-faint hover:sb-text-secondary transition-colors"
        :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
        :title="passwordVisible ? '隐藏密码' : '显示密码'"
        @click="passwordVisible = !passwordVisible"
      >
        <EyeOff v-if="passwordVisible" class="w-4 h-4" :stroke-width="1.5" />
        <Eye v-else class="w-4 h-4" :stroke-width="1.5" />
      </button>
    </div>
    <p v-if="def.type === 'attachment'" class="mt-1 text-[10px] sb-text-faint">{{ attachmentHint }}</p>
    <p v-if="showKey" class="mt-0.5 text-[10px] sb-text-faint font-mono">{{ def.key }}</p>
  </div>
</template>
