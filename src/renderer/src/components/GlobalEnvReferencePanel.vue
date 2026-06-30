<script setup lang="ts">
import { computed } from 'vue'
import { Link2 } from 'lucide-vue-next'
import type { EnvVarDefinition } from '../../../shared/script-contract'
import type { EnvironmentProfile } from '../../../shared/types/script'
import {
  formatEnvPreview,
  listGlobalEnvReferences,
  listUnmappedGlobalEnvKeys
} from '../../../shared/env-resolution'

const props = defineProps<{
  profile: EnvironmentProfile | null
  schema: EnvVarDefinition[]
  scriptConfig: Record<string, string>
  currentValues: Record<string, string>
}>()

const emit = defineEmits<{
  apply: [key: string]
  'apply-all': []
}>()

const referenceItems = computed(() =>
  listGlobalEnvReferences(props.schema, props.profile?.variables, props.scriptConfig, props.currentValues)
)

const unmappedKeys = computed(() => listUnmappedGlobalEnvKeys(props.schema, props.profile?.variables))

const pendingCount = computed(() => referenceItems.value.filter((item) => !item.matched).length)

const hasContent = computed(() => referenceItems.value.length > 0 || unmappedKeys.value.length > 0)
</script>

<template>
  <div v-if="hasContent" class="rounded-lg border sb-border sb-bg-surface p-3 space-y-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="text-[12px] font-medium sb-text-secondary">全局环境变量</h3>
        <p class="text-[11px] sb-text-faint mt-0.5">
          <template v-if="profile">
            来自「{{ profile.name }}」环境 Profile，可一键引用到当前脚本配置
          </template>
          <template v-else>选择运行环境后可引用全局变量</template>
        </p>
      </div>
      <button
        v-if="pendingCount > 0"
        type="button"
        class="flex-shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium text-sky-400/90 border border-sky-500/25 bg-sky-500/10 hover:bg-sky-500/15 transition-colors"
        @click="emit('apply-all')"
      >
        <Link2 class="w-3 h-3" :stroke-width="1.5" />
        引用全部 ({{ pendingCount }})
      </button>
    </div>

    <div v-if="referenceItems.length" class="space-y-1">
      <div
        v-for="item in referenceItems"
        :key="item.key"
        class="flex items-center gap-2 px-2 py-1.5 rounded-md"
        :class="item.matched ? 'sb-bg-inset' : 'hover:sb-bg-hover'"
      >
        <span class="text-[11px] font-mono sb-text-muted w-24 flex-shrink-0 truncate" :title="item.key">{{ item.key }}</span>
        <span class="text-[11px] sb-text-faint flex-1 truncate" :title="item.secret ? undefined : item.globalValue">
          {{ formatEnvPreview(item.globalValue, item.secret) }}
        </span>
        <span
          v-if="item.matched"
          class="text-[10px] px-1.5 py-0.5 rounded border text-sky-400/80 border-sky-500/20 bg-sky-500/5 flex-shrink-0"
        >
          已引用
        </span>
        <span
          v-else-if="item.overridden"
          class="text-[10px] px-1.5 py-0.5 rounded border sb-text-faint sb-border-subtle flex-shrink-0"
          title="当前脚本已保存独立值，引用将覆盖"
        >
          已覆盖
        </span>
        <button
          v-if="!item.matched"
          type="button"
          class="flex-shrink-0 text-[11px] text-sky-400/90 hover:text-sky-400 transition-colors"
          @click="emit('apply', item.key)"
        >
          引用
        </button>
      </div>
    </div>

    <div v-if="unmappedKeys.length" class="pt-2 border-t sb-border-subtle space-y-1.5">
      <p class="text-[11px] sb-text-faint">
        以下全局变量未在当前脚本 <code class="sb-text-muted">env</code> schema 中声明，需在 autoforge.json 添加后可用：
      </p>
      <div v-for="item in unmappedKeys" :key="item.key" class="flex items-center gap-2 px-2 py-1">
        <span class="text-[11px] font-mono sb-text-muted">{{ item.key }}</span>
        <span class="text-[11px] sb-text-faint truncate">{{ formatEnvPreview(item.value) }}</span>
      </div>
    </div>
  </div>
</template>
