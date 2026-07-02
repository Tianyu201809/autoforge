<script setup lang="ts">
import { onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { CheckCircle2, Plus, Trash2, X, XCircle } from 'lucide-vue-next'
import type { BrowserStatusInfo, EnvironmentProfile } from '../../../shared/types/script'
import { DEFAULT_GLOBAL_SHORTCUT } from '../../../shared/accelerator'
import SkinPicker from './SkinPicker.vue'
import ShortcutRecorder from './ShortcutRecorder.vue'
import { askConfirm } from '../composables/useConfirmDialog'
import { useToast } from '../composables/useToast'

const { pushToast } = useToast()

const appVersion = window.api.versions.app

const emit = defineEmits<{ close: [] }>()

const browserPath = ref('')
const externalEditorPath = ref('')
const logLevel = ref<'INFO' | 'WARN' | 'ERROR'>('INFO')
const trayMode = ref(false)
const floatingMode = ref(false)
const globalShortcutEnabled = ref(true)
const globalShortcut = ref(DEFAULT_GLOBAL_SHORTCUT)
const globalShortcutRegistered = ref(true)
const saving = ref(false)
const saved = ref(false)
const browserStatus = ref<BrowserStatusInfo | null>(null)
const windowModeReady = ref(false)

const environments = ref<EnvironmentProfile[]>([])
const editingEnv = ref<EnvironmentProfile | null>(null)
const envVarKey = ref('')
const envVarValue = ref('')
const savingEnv = ref(false)
const envSaved = ref(false)

let offModeChange: (() => void) | undefined
let syncingFromEvent = false

function syncWindowModeFromState(): void {
  if (!windowModeReady.value || syncingFromEvent) return
  void window.api.setMode({
    trayMode: trayMode.value,
    floatingMode: floatingMode.value,
    globalShortcutEnabled: globalShortcutEnabled.value,
    globalShortcut: globalShortcut.value
  }).then((mode) => {
    globalShortcutRegistered.value = mode.globalShortcutRegistered
  })
}

watch([trayMode, floatingMode, globalShortcutEnabled, globalShortcut], () => {
  syncWindowModeFromState()
})

onMounted(async () => {
  const config = await window.autoforge.config.get()
  browserPath.value = config.browser?.executablePath ?? ''
  externalEditorPath.value = config.externalEditor?.executablePath ?? ''
  logLevel.value = config.logLevel ?? 'INFO'
  trayMode.value = !!config.window?.trayMode
  floatingMode.value = !!config.window?.floatingMode
  globalShortcutEnabled.value = config.window?.globalShortcutEnabled !== false
  globalShortcut.value = config.window?.globalShortcut?.trim() || DEFAULT_GLOBAL_SHORTCUT
  browserStatus.value = await window.autoforge.system.browserStatus()
  environments.value = await window.autoforge.env.list()
  editingEnv.value = environments.value.find((e) => e.isDefault) ?? environments.value[0] ?? null

  offModeChange = window.api.onModeChange((mode) => {
    syncingFromEvent = true
    trayMode.value = !!mode.trayMode
    floatingMode.value = !!mode.floatingMode
    globalShortcutEnabled.value = mode.globalShortcutEnabled !== false
    globalShortcut.value = mode.globalShortcut?.trim() || DEFAULT_GLOBAL_SHORTCUT
    globalShortcutRegistered.value = mode.globalShortcutRegistered
    syncingFromEvent = false
  })

  const mode = await window.api.getMode()
  globalShortcutRegistered.value = mode.globalShortcutRegistered

  windowModeReady.value = true
})

onUnmounted(() => {
  offModeChange?.()
})

async function save(): Promise<void> {
  saving.value = true
  saved.value = false
  try {
    await window.autoforge.config.set({
      browser: { executablePath: browserPath.value || undefined },
      externalEditor: { executablePath: externalEditorPath.value || undefined },
      logLevel: logLevel.value,
      window: {
        trayMode: trayMode.value,
        floatingMode: floatingMode.value,
        globalShortcutEnabled: globalShortcutEnabled.value,
        globalShortcut: globalShortcut.value
      }
    })
    // 窗口行为已在勾选时即时生效，保存时仅持久化其余配置
    saved.value = true
  } catch (err) {
    pushToast({
      type: 'error',
      title: '保存失败',
      message: err instanceof Error ? err.message : '无法保存设置'
    })
  } finally {
    saving.value = false
  }
}

function syncEditingEnv(id?: string): void {
  const targetId = id ?? editingEnv.value?.id
  if (!targetId) {
    editingEnv.value = environments.value[0] ?? null
    return
  }
  editingEnv.value = environments.value.find((e) => e.id === targetId) ?? null
}

function selectEnv(id: string): void {
  if (editingEnv.value?.id !== id) {
    envSaved.value = false
  }
  syncEditingEnv(id)
}

async function saveEnv(): Promise<void> {
  if (!editingEnv.value) return
  const env = toRaw(editingEnv.value)
  const envId = env.id
  savingEnv.value = true
  envSaved.value = false
  try {
    // IPC 需要纯 JSON 对象，Vue reactive Proxy 无法 structured clone
    const updated = await window.autoforge.env.update(envId, {
      name: env.name,
      description: env.description,
      variables: Object.fromEntries(
        Object.entries(env.variables).map(([k, v]) => [k, v ?? ''])
      ),
      isDefault: env.isDefault
    })
    if (!updated) {
      pushToast({ type: 'error', title: '保存失败', message: '无法更新环境配置' })
      return
    }
    environments.value = await window.autoforge.env.list()
    syncEditingEnv(envId)
    envSaved.value = true
  } catch (err) {
    pushToast({
      type: 'error',
      title: '保存失败',
      message: err instanceof Error ? err.message : '无法保存环境'
    })
  } finally {
    savingEnv.value = false
  }
}

async function createEnv(): Promise<void> {
  const env = await window.autoforge.env.create({
    name: `环境 ${environments.value.length + 1}`,
    variables: {},
    isDefault: false
  })
  environments.value = await window.autoforge.env.list()
  syncEditingEnv(env.id)
  envSaved.value = false
}

async function deleteEnv(id: string): Promise<void> {
  const env = environments.value.find((e) => e.id === id)
  const confirmed = await askConfirm({
    title: '删除环境',
    message: env
      ? `确定删除环境「${env.name}」？关联的脚本将回退到默认环境配置。`
      : '确定删除此环境？',
    confirmLabel: '删除',
    variant: 'danger'
  })
  if (!confirmed) return
  await window.autoforge.env.delete(id)
  environments.value = await window.autoforge.env.list()
  syncEditingEnv()
  envSaved.value = false
}

function addEnvVar(): void {
  if (!editingEnv.value || !envVarKey.value.trim()) return
  editingEnv.value.variables[envVarKey.value.trim()] = envVarValue.value
  envVarKey.value = ''
  envVarValue.value = ''
}

function removeEnvVar(key: string): void {
  if (!editingEnv.value) return
  delete editingEnv.value.variables[key]
}

async function openUserDataDir(): Promise<void> {
  const path = await window.autoforge.system.userDataPath()
  await window.autoforge.system.openPath(path)
}

async function browseExternalEditor(): Promise<void> {
  const path = await window.autoforge.system.pickExternalEditor()
  if (path) externalEditorPath.value = path
}
</script>

<template>
  <main class="flex-1 flex flex-col min-w-0 sb-bg-base overflow-y-auto">
    <div class="flex items-center justify-between px-6 py-4 border-b sb-border-subtle">
      <div>
        <h1 class="text-xl font-semibold sb-text-primary">设置</h1>
        <p class="text-[13px] sb-text-muted mt-0.5">外观、运行环境与环境 Profile</p>
      </div>
      <button type="button" class="w-8 h-8 flex items-center justify-center rounded-md sb-text-muted hover:sb-text-secondary sb-bg-hover" @click="emit('close')">
        <X class="w-4 h-4" :stroke-width="1.5" />
      </button>
    </div>

    <div class="max-w-2xl px-6 py-6 space-y-8">
      <!-- 产品版本 -->
      <section class="space-y-3">
        <h2 class="text-[13px] font-medium sb-text-secondary">产品版本</h2>
        <div class="rounded-lg border sb-border sb-bg-surface px-4 py-3 flex items-center justify-between gap-4">
          <div class="min-w-0">
            <p class="text-[13px] sb-text-secondary">Autoforge</p>
            <p class="text-[11px] sb-text-faint mt-0.5">本机自动化脚本锻造与管理桌面应用</p>
          </div>
          <span class="text-[13px] font-mono sb-text-primary shrink-0">v{{ appVersion }}</span>
        </div>
      </section>

      <!-- 窗口行为 -->
      <section class="space-y-3">
        <h2 class="text-[13px] font-medium sb-text-secondary">窗口行为</h2>
        <p class="text-[11px] sb-text-faint">托盘模式适合后台常驻；悬浮球可自由拖动并快速唤起主界面；快捷键可在任意应用中打开主窗口。</p>
        <div class="rounded-lg border sb-border sb-bg-surface p-4 space-y-3">
          <label class="flex items-start gap-2 text-[13px] sb-text-secondary cursor-pointer">
            <input v-model="trayMode" type="checkbox" class="rounded mt-0.5" />
            <span>
              托盘模式
              <span class="block text-[11px] sb-text-faint mt-0.5">关闭窗口时隐藏到系统托盘，程序继续在后台运行</span>
            </span>
          </label>
          <label class="flex items-start gap-2 text-[13px] sb-text-secondary cursor-pointer">
            <input v-model="floatingMode" type="checkbox" class="rounded mt-0.5" />
            <span>
              悬浮球
              <span class="block text-[11px] sb-text-faint mt-0.5">在桌面显示圆形悬浮球，可拖动到任意位置，点击打开主界面；标题栏也可快速开关</span>
            </span>
          </label>
          <label class="flex items-start gap-2 text-[13px] sb-text-secondary cursor-pointer">
            <input v-model="globalShortcutEnabled" type="checkbox" class="rounded mt-0.5" />
            <span>
              全局快捷键
              <span class="block text-[11px] sb-text-faint mt-0.5">在任意应用中按下快捷键，快速显示主界面</span>
            </span>
          </label>
          <div v-if="globalShortcutEnabled" class="pl-6 space-y-2">
            <label class="block text-[12px] sb-text-muted">快捷键组合</label>
            <ShortcutRecorder v-model="globalShortcut" />
            <p class="text-[11px] sb-text-faint">点击输入框后按下新的组合键；按 Esc 取消录制</p>
            <p v-if="!globalShortcutRegistered" class="text-[11px] text-amber-400">
              当前快捷键无法注册，可能已被其他程序占用，请尝试其他组合
            </p>
          </div>
        </div>
      </section>

      <!-- 外观 -->
      <section class="space-y-3">
        <h2 class="text-[13px] font-medium sb-text-secondary">外观皮肤</h2>
        <p class="text-[11px] sb-text-faint">选择整体配色风格；标题栏太阳 / 月亮图标可在同系列深浅皮肤间快速切换</p>
        <SkinPicker />
      </section>

      <!-- 环境 Profile -->
      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-[13px] font-medium sb-text-secondary">环境 Profile</h2>
          <button type="button" class="flex items-center gap-1 text-[12px] sb-text-muted hover:sb-text-secondary" @click="createEnv">
            <Plus class="w-3.5 h-3.5" :stroke-width="1.5" />
            新建
          </button>
        </div>
        <p class="text-[11px] sb-text-faint">创建开发 / 测试 / 生产等环境，供脚本通过 ctx.env 读取。填写常用片段可使用标题栏「小记」快速填入输入框。</p>

        <div class="flex gap-2 flex-wrap">
          <button
            v-for="env in environments"
            :key="env.id"
            type="button"
            class="px-3 py-1.5 rounded-lg text-[12px] border transition-colors"
            :class="editingEnv?.id === env.id ? 'sb-bg-inset sb-border sb-text-primary' : 'sb-border sb-text-muted hover:border-[var(--sb-text-faint)]'"
            @click="selectEnv(env.id)"
          >
            {{ env.name }}
            <span v-if="env.isDefault" class="sb-text-faint ml-1">(默认)</span>
          </button>
        </div>

        <div v-if="editingEnv" class="rounded-lg border sb-border sb-bg-surface p-4 space-y-3">
          <div>
            <label class="text-[12px] sb-text-muted">名称</label>
            <input v-model="editingEnv.name" class="mt-1 w-full h-9 px-3 rounded-lg sb-input border text-[13px] outline-none" />
          </div>
          <label class="flex items-center gap-2 text-[12px] sb-text-muted">
            <input v-model="editingEnv.isDefault" type="checkbox" class="rounded" />
            设为默认环境
          </label>

          <div>
            <label class="text-[12px] sb-text-muted">环境变量</label>
            <div class="mt-2 space-y-1.5">
              <div v-for="(val, key) in editingEnv.variables" :key="key" class="flex items-center gap-2">
                <span class="text-[12px] font-mono sb-text-muted flex-1 truncate">{{ key }}</span>
                <span class="text-[12px] sb-text-faint flex-1 truncate">{{ val ? '••••' : '(空)' }}</span>
                <button type="button" class="sb-text-faint hover:text-red-400" @click="removeEnvVar(String(key))">
                  <Trash2 class="w-3.5 h-3.5" :stroke-width="1.5" />
                </button>
              </div>
            </div>
            <div class="mt-2 flex gap-2">
              <input v-model="envVarKey" placeholder="KEY" class="flex-1 h-8 px-3 rounded-lg sb-input border text-[12px] font-mono outline-none" />
              <input v-model="envVarValue" placeholder="VALUE" class="flex-1 h-8 px-3 rounded-lg sb-input border text-[12px] outline-none" />
              <button type="button" class="h-8 px-3 rounded-lg sb-bg-inset sb-text-secondary text-[12px]" @click="addEnvVar">添加</button>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button
              type="button"
              class="h-8 px-4 rounded-lg sb-btn-accent text-[12px] font-medium disabled:opacity-50"
              :disabled="savingEnv"
              @click="saveEnv"
            >
              {{ savingEnv ? '保存中…' : '保存环境' }}
            </button>
            <p v-if="envSaved" class="text-[12px] text-emerald-400">环境已保存</p>
            <button
              v-if="environments.length > 1"
              type="button"
              class="h-8 px-4 rounded-lg text-red-400 text-[12px] border sb-border"
              @click="deleteEnv(editingEnv.id)"
            >
              删除
            </button>
          </div>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-[13px] font-medium sb-text-secondary">外部编辑器</h2>
        <p class="text-[11px] sb-text-faint">在脚本详情「编辑」页点击「外部编辑器」时，用所选程序打开脚本工作区目录（如 VS Code、Cursor、WebStorm）。</p>
        <div>
          <label class="text-[12px] sb-text-muted">编辑器路径</label>
          <div class="mt-1 flex gap-2">
            <input
              v-model="externalEditorPath"
              placeholder="留空则在首次使用时选择"
              class="flex-1 min-w-0 h-9 px-3 rounded-lg sb-input border text-[13px] font-mono outline-none"
            />
            <button
              type="button"
              class="h-9 px-3 rounded-lg text-[12px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors flex-shrink-0"
              @click="browseExternalEditor"
            >
              浏览…
            </button>
          </div>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-[13px] font-medium sb-text-secondary">浏览器（SDK 使用）</h2>
        <div v-if="browserStatus" class="rounded-lg border sb-border sb-bg-surface p-3 space-y-2">
          <div class="flex items-center gap-2 text-[12px]">
            <CheckCircle2 v-if="browserStatus.bundled" class="w-3.5 h-3.5 text-emerald-400" :stroke-width="1.5" />
            <XCircle v-else class="w-3.5 h-3.5 text-amber-400" :stroke-width="1.5" />
            <span :class="browserStatus.bundled ? 'text-emerald-400' : 'text-amber-400'">
              {{ browserStatus.bundled ? '内置 Chromium 已就绪' : '未检测到内置 Chromium' }}
            </span>
          </div>
        </div>
        <div>
          <label class="text-[12px] sb-text-muted">浏览器路径（可选）</label>
          <input v-model="browserPath" placeholder="留空自动检测" class="mt-1 w-full h-9 px-3 rounded-lg sb-input border text-[13px] font-mono outline-none" />
          <p class="mt-1 text-[11px] sb-text-faint">无头模式请在各脚本的详情面板或 autoforge.json 中单独配置</p>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-[13px] font-medium sb-text-secondary">日志</h2>
        <select v-model="logLevel" class="h-9 px-3 rounded-lg sb-input border text-[13px] outline-none">
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>
        <button type="button" class="text-[12px] sb-text-muted hover:sb-text-secondary underline" @click="openUserDataDir">
          打开数据目录
        </button>
      </section>

      <button
        type="button"
        class="h-9 px-4 rounded-lg sb-btn-accent text-[13px] font-medium disabled:opacity-50"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? '保存中…' : '保存设置' }}
      </button>
      <p v-if="saved" class="text-[12px] text-emerald-400">已保存</p>
    </div>
  </main>
</template>
