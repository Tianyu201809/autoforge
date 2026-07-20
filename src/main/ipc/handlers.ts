import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { existsSync, statSync } from 'fs'
import { IPC } from '../../shared/ipc-channels'
import { MANIFEST_FILENAME } from '../../shared/script-contract'
import type { AppConfig, AppWindowConfig, EnvironmentProfile, ExecutionHistoryQuery, PipelineMeta, PipelineNode, ScriptIcon, ScriptMeta } from '../../shared/types/script'
import { getAppUserDataPath } from '../services/app-data-root'
import { findCategoryDefinition } from '../services/category-service'
import { dependencyManager } from '../services/dependency-manager'
import { importBundledExample, listBundledExamples, readDevGuideMarkdown, readDevGuideSkillCreateInfo } from '../services/example-bundles'
import { getBrowserStatus } from '../services/browser-path'
import { detectPythonStatus } from '../services/python-resolver'
import {
  openInExternalEditor,
  resolveExternalEditorPath
} from '../services/external-editor'
import {
  computeStats,
  enrichScriptItem,
  getCategories,
  ScriptRunnerService
} from '../services/script-runner'
import { scriptRegistry } from '../services/script-registry'
import { scriptStore } from '../services/script-store'
import { scriptWorkspace } from '../services/script-workspace'
import { executionHistory } from '../services/execution-history'
import { pipelineStore } from '../services/pipeline-store'
import { PipelineRunnerService } from '../services/pipeline-runner'
import {
  buildScriptExportPlan,
  describeExportPlan,
  exportDisplayName,
  writeScriptExportZip
} from '../services/script-package-exporter'
import { removeParamAttachment, stageParamAttachments } from '../services/script-param-inputs'
import { SchedulerService } from '../services/scheduler'
import {
  closeTerminalWindow,
  isTerminalPinned,
  isTerminalWindowOpen,
  openTerminalWindow,
  toggleTerminalPin
} from '../services/terminal-window'
import {
  broadcastEditorSaved,
  broadcastEditorSync,
  closeEditorWindow,
  getEditorSession,
  isEditorPinned,
  isEditorWindowOpen,
  openEditorWindow,
  toggleEditorPin,
  type EditorSession
} from '../services/editor-window'
import {
  applyWindowMode,
  getWindowModeState,
  hideMainWindow,
  setWindowMode,
  showMainWindow,
  toggleMainWindow
} from '../services/main-window-mode'

let runner: ScriptRunnerService
let pipelineRunner: PipelineRunnerService
let scheduler: SchedulerService

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  runner = new ScriptRunnerService(getWindow)
  pipelineRunner = new PipelineRunnerService(getWindow, runner)
  scheduler = new SchedulerService((scriptId) =>
    runner.start(scriptId, undefined, undefined, { trigger: 'scheduled' })
  )

  ipcMain.handle(IPC.SCRIPTS_LIST, () => {
    const sessions = runner.listSessions()
    const items = scriptRegistry.listAll().map((meta) => enrichScriptItem(meta, sessions))
    return {
      scripts: items,
      stats: computeStats(items),
      categories: getCategories(items)
    }
  })

  ipcMain.handle(IPC.SCRIPTS_GET, (_event, id: string) => {
    const meta = scriptRegistry.getById(id)
    if (!meta) return null
    return enrichScriptItem(meta, runner.listSessions())
  })

  ipcMain.handle(IPC.SCRIPTS_IMPORT, (_event, sourcePath: string) => {
    const script = scriptRegistry.importFromPath(sourcePath)
    scheduler.reload(scriptRegistry.listAll())
    return enrichScriptItem(script, runner.listSessions())
  })

  ipcMain.handle(IPC.SCRIPTS_EXPORT_ZIP, async (_event, id: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) throw new Error('脚本不存在')
    const manifest = scriptWorkspace.readManifest(script.workspacePath)
    const plan = buildScriptExportPlan(script, manifest)
    const win = getWindow()
    const saveResult = await dialog.showSaveDialog(win ?? undefined, {
      title: '导出脚本 ZIP',
      defaultPath: plan.defaultFileName,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    })
    if (saveResult.canceled || !saveResult.filePath) return null
    writeScriptExportZip(script, plan, saveResult.filePath)
    return {
      path: saveResult.filePath,
      fileName: exportDisplayName(saveResult.filePath),
      fileCount: plan.files.length,
      totalBytes: plan.totalBytes
    }
  })

  ipcMain.handle(IPC.SCRIPTS_EXPORT_PREVIEW, (_event, id: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) throw new Error('脚本不存在')
    const manifest = scriptWorkspace.readManifest(script.workspacePath)
    const plan = buildScriptExportPlan(script, manifest)
    return {
      fileCount: plan.files.length,
      totalBytes: plan.totalBytes,
      message: `${describeExportPlan(plan)}\n\n请确认动态加载的模板或资源已在 autoforge.json 的 export.include 中声明。`
    }
  })

  ipcMain.handle(IPC.SCRIPTS_UPDATE, (_event, id: string, patch: Partial<ScriptMeta>) => {
    const updated = scriptRegistry.update(id, patch)
    if (!updated) return null
    scheduler.reload(scriptRegistry.listAll())
    return enrichScriptItem(updated, runner.listSessions())
  })

  ipcMain.handle(IPC.SCRIPTS_DELETE, (_event, id: string) => {
    const scriptId = typeof id === 'string' ? id.trim() : ''
    if (!scriptId) return false
    runner.stopAllForScript(scriptId)
    const ok = scriptRegistry.delete(scriptId)
    if (ok) scheduler.reload(scriptRegistry.listAll())
    return ok
  })

  ipcMain.handle(IPC.SCRIPTS_TOGGLE_STAR, (_event, id: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) return null
    const updated = scriptRegistry.update(id, { starred: !script.starred })
    return updated ? enrichScriptItem(updated, runner.listSessions()) : null
  })

  ipcMain.handle(IPC.SCRIPTS_TOGGLE_ARCHIVE, (_event, id: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) return null
    const updated = scriptRegistry.update(id, { archived: !script.archived })
    return updated ? enrichScriptItem(updated, runner.listSessions()) : null
  })

  ipcMain.handle(IPC.SCRIPTS_OPEN_FILE_DIALOG, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: '脚本文件', extensions: ['js', 'mjs', 'cjs', 'py'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SCRIPTS_OPEN_DIR_DIALOG, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SCRIPTS_OPEN_ATTACHMENT_DIALOG, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths
  })

  ipcMain.handle(
    IPC.SCRIPTS_STAGE_ATTACHMENTS,
    (_event, scriptId: string, paramKey: string, sourcePaths: string[]) => {
      return stageParamAttachments(scriptId, paramKey, sourcePaths)
    }
  )

  ipcMain.handle(IPC.SCRIPTS_REMOVE_ATTACHMENT, (_event, filePath: string) => {
    return removeParamAttachment(filePath)
  })

  ipcMain.handle(IPC.SCRIPTS_GET_CONTENT, (_event, id: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) return null
    return {
      entryPath: script.entry,
      content: scriptWorkspace.readEntryContent(script),
      manifestPath: MANIFEST_FILENAME,
      manifestContent: scriptWorkspace.readManifestContent(script)
    }
  })

  ipcMain.handle(IPC.SCRIPTS_LIST_FILES, (_event, id: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) return null
    return {
      entryPath: script.entry,
      manifestPath: MANIFEST_FILENAME,
      files: scriptWorkspace.listWorkspaceFiles(script)
    }
  })

  ipcMain.handle(IPC.SCRIPTS_READ_FILE, (_event, id: string, relativePath: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) return null
    try {
      return scriptWorkspace.readWorkspaceFile(script, relativePath)
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.SCRIPTS_WRITE_FILE, (_event, id: string, relativePath: string, content: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) return false
    scriptWorkspace.writeWorkspaceFile(script, relativePath, content)
    if (relativePath === MANIFEST_FILENAME || relativePath === 'scriptbox.json') {
      const manifest = scriptWorkspace.readManifest(script.workspacePath)
      const metaPatch = scriptWorkspace.manifestToMeta(id, manifest)
      scriptRegistry.update(id, metaPatch)
    }
    return true
  })

  ipcMain.handle(IPC.SCRIPTS_SET_CONTENT, (_event, id: string, content: string, manifestContent?: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) return false
    scriptWorkspace.writeEntryContent(script, content)
    if (manifestContent) {
      scriptWorkspace.writeManifestContent(script, manifestContent)
      const manifest = scriptWorkspace.readManifest(script.workspacePath)
      const metaPatch = scriptWorkspace.manifestToMeta(id, manifest)
      scriptRegistry.update(id, metaPatch)
    }
    return true
  })

  ipcMain.handle(IPC.SCRIPTS_INSTALL_DEPS, async (_event, id: string) => {
    const script = scriptRegistry.getById(id)
    if (!script) return { ok: false, stdout: '', stderr: '脚本不存在' }
    return dependencyManager.installScriptDeps(script.workspacePath, script.language, { force: true })
  })

  ipcMain.handle(IPC.SCRIPTS_SET_ENV_CONFIG, (_event, id: string, envId: string, values: Record<string, string>) => {
    const plainValues = JSON.parse(JSON.stringify(values)) as Record<string, string>
    const updated = scriptStore.setScriptEnvConfig(id, envId, plainValues)
    if (!updated) return null
    return enrichScriptItem(updated, runner.listSessions())
  })

  ipcMain.handle(IPC.SCRIPTS_SET_PARAMS, (_event, id: string, envId: string, values: Record<string, string>) => {
    const plainValues = JSON.parse(JSON.stringify(values)) as Record<string, string>
    const updated = scriptStore.setScriptParams(id, envId, plainValues)
    if (!updated) return null
    return enrichScriptItem(updated, runner.listSessions())
  })

  ipcMain.handle(
    IPC.SCRIPTS_UPDATE_META,
    (_event, id: string, patch: { name?: string; icon?: ScriptIcon; category?: string; categoryLabel?: string; browser?: { headless?: boolean } }) => {
      const script = scriptRegistry.getById(id)
      if (!script) throw new Error('脚本不存在')
      const definitions = scriptStore.getCategoryDefinitions()
      let categoryLabel = patch.categoryLabel
      if (patch.category !== undefined && categoryLabel === undefined) {
        const def = findCategoryDefinition(definitions, patch.category)
        categoryLabel = def?.label
      }
      const manifest = scriptWorkspace.updateManifestMeta(script, {
        name: patch.name,
        icon: patch.icon,
        category: patch.category,
        categoryLabel,
        browser: patch.browser
      })
      const metaPatch = scriptWorkspace.manifestToMeta(id, manifest, definitions)
      const updated = scriptRegistry.update(id, metaPatch)
      if (!updated) throw new Error('无法更新脚本元数据')
      return enrichScriptItem(updated, runner.listSessions())
    }
  )

  ipcMain.handle(IPC.CATEGORIES_LIST, () => scriptStore.getCategoryDefinitions())

  ipcMain.handle(IPC.CATEGORIES_CREATE, (_event, label: string, colorPreset: string) => {
    return scriptStore.addCategory(label, colorPreset)
  })

  ipcMain.handle(
    IPC.CATEGORIES_UPDATE,
    (_event, id: string, patch: { label?: string; colorPreset?: string }) => {
      const updated = scriptStore.updateCategory(id, patch)
      if (!updated) return null

      const definitions = scriptStore.getCategoryDefinitions()
      if (patch.label) {
        for (const script of scriptRegistry.listAll()) {
          if (script.category !== updated.key) continue
          const manifest = scriptWorkspace.updateManifestMeta(script, { categoryLabel: patch.label })
          const metaPatch = scriptWorkspace.manifestToMeta(script.id, manifest, definitions)
          scriptRegistry.update(script.id, metaPatch)
        }
      } else if (patch.colorPreset) {
        for (const script of scriptRegistry.listAll()) {
          if (script.category !== updated.key) continue
          const manifest = scriptWorkspace.readManifest(script.workspacePath)
          const metaPatch = scriptWorkspace.manifestToMeta(script.id, manifest, definitions)
          scriptRegistry.update(script.id, metaPatch)
        }
      }
      return updated
    }
  )

  ipcMain.handle(IPC.CATEGORIES_DELETE, (_event, id: string) => {
    const definitions = scriptStore.getCategoryDefinitions()
    const target = definitions.find((c) => c.id === id)
    if (!target) return { ok: false, error: '分类不存在' }
    if (target.builtIn) return { ok: false, error: '内置分类不可删除' }

    const fallback = findCategoryDefinition(definitions, 'local')!
    for (const script of scriptRegistry.listAll()) {
      if (script.category !== target.key) continue
      const manifest = scriptWorkspace.updateManifestMeta(script, {
        category: 'local',
        categoryLabel: fallback.label
      })
      const metaPatch = scriptWorkspace.manifestToMeta(script.id, manifest, definitions)
      scriptRegistry.update(script.id, metaPatch)
    }

    const result = scriptStore.deleteCategory(id)
    if (!result.ok) return result
    return { ok: true }
  })

  ipcMain.handle(IPC.ENV_LIST, () => scriptStore.getEnvironments())

  ipcMain.handle(IPC.ENV_CREATE, (_event, profile: Omit<EnvironmentProfile, 'id'>) => {
    return scriptStore.addEnvironment(profile)
  })

  ipcMain.handle(IPC.ENV_UPDATE, (_event, id: string, patch: Partial<EnvironmentProfile>) => {
    return scriptStore.updateEnvironment(id, patch)
  })

  ipcMain.handle(IPC.ENV_DELETE, (_event, id: string) => {
    return scriptStore.deleteEnvironment(id)
  })

  ipcMain.handle(
    IPC.RUNNER_START,
    async (_event, scriptId: string, envId?: string, params?: Record<string, string>) => {
      const plainParams = params ? (JSON.parse(JSON.stringify(params)) as Record<string, string>) : undefined
      return runner.start(scriptId, envId, plainParams)
    }
  )

  ipcMain.handle(IPC.RUNNER_STOP, (_event, sessionId: string) => {
    return runner.stop(sessionId)
  })

  ipcMain.handle(IPC.RUNNER_LIST_SESSIONS, () => {
    return runner.listSessions()
  })

  ipcMain.handle(IPC.RUNNER_GET_SESSION, (_event, sessionId: string) => {
    return runner.getSession(sessionId)
  })

  ipcMain.handle(IPC.PIPELINES_LIST, () => pipelineStore.list())
  ipcMain.handle(IPC.PIPELINES_GET, (_event, id: string) => pipelineStore.get(id) ?? null)
  ipcMain.handle(
    IPC.PIPELINES_CREATE,
    (_event, input: { name: string; description?: string; nodes: PipelineNode[] }) => pipelineStore.create(input)
  )
  ipcMain.handle(
    IPC.PIPELINES_UPDATE,
    (_event, id: string, patch: Partial<Pick<PipelineMeta, 'name' | 'description' | 'nodes' | 'starred' | 'archived'>>) =>
      pipelineStore.update(id, patch)
  )
  ipcMain.handle(IPC.PIPELINES_DELETE, (_event, id: string) => pipelineStore.delete(id))
  ipcMain.handle(
    IPC.PIPELINES_SET_VALUES,
    (_event, id: string, envId: string, values: { config?: Record<string, string>; params?: Record<string, string> }) =>
      pipelineStore.setValues(id, envId, values)
  )
  ipcMain.handle(
    IPC.PIPELINES_START,
    (_event, id: string, envId?: string, params?: Record<string, string>) => pipelineRunner.start(id, envId, params)
  )
  ipcMain.handle(IPC.PIPELINES_STOP, (_event, sessionId: string) => pipelineRunner.stop(sessionId))
  ipcMain.handle(IPC.PIPELINES_LIST_SESSIONS, () => pipelineRunner.listSessions())
  ipcMain.handle(IPC.PIPELINES_GET_SESSION, (_event, sessionId: string) => pipelineRunner.getSession(sessionId))

  ipcMain.handle(IPC.HISTORY_QUERY, (_event, query?: ExecutionHistoryQuery) => {
    return executionHistory.query(query)
  })

  ipcMain.handle(IPC.HISTORY_QUERY_PAGE, (_event, query?: ExecutionHistoryQuery) => {
    return executionHistory.queryPage(query)
  })

  ipcMain.handle(IPC.HISTORY_FOR_SCRIPT, (_event, scriptId: string, limit?: number) => {
    return executionHistory.listForScript(scriptId, limit)
  })

  ipcMain.handle(IPC.HISTORY_TODAY_COUNT, () => {
    return executionHistory.getTodayCount()
  })

  ipcMain.handle(IPC.CONFIG_GET, () => {
    return scriptStore.getConfig()
  })

  ipcMain.handle(IPC.CONFIG_SET, (_event, config: Partial<AppConfig>) => {
    const saved = scriptStore.setConfig(config)
    if (config.window) {
      applyWindowMode()
    }
    return saved
  })

  ipcMain.handle(IPC.WINDOW_SHOW, () => {
    showMainWindow()
  })

  ipcMain.handle(IPC.WINDOW_HIDE, () => {
    hideMainWindow()
  })

  ipcMain.handle(IPC.WINDOW_TOGGLE, () => toggleMainWindow())

  ipcMain.handle(IPC.WINDOW_GET_MODE, () => getWindowModeState())

  ipcMain.handle(IPC.WINDOW_SET_MODE, (_event, patch: AppWindowConfig) => {
    setWindowMode(patch)
    return getWindowModeState()
  })

  ipcMain.handle(
    IPC.DEPS_INSTALL_GLOBAL,
    async (_event, packageName: string, version?: string, language?: import('../../shared/script-language').ScriptLanguage) => {
      return dependencyManager.installGlobal(packageName, version, language ?? 'javascript')
    }
  )

  ipcMain.handle(
    IPC.DEPS_LIST_GLOBAL,
    (_event, language?: import('../../shared/script-language').ScriptLanguage) => {
      return dependencyManager.listGlobal(language ?? 'javascript')
    }
  )

  ipcMain.handle(
    IPC.DEPS_REMOVE_GLOBAL,
    async (_event, packageName: string, language?: import('../../shared/script-language').ScriptLanguage) => {
      return dependencyManager.removeGlobal(packageName, language ?? 'javascript')
    }
  )

  ipcMain.handle(IPC.EXAMPLES_LIST, () => listBundledExamples())

  ipcMain.handle(IPC.EXAMPLES_IMPORT, (_event, exampleId: string) => {
    const meta = importBundledExample(exampleId)
    const script = scriptStore.addScript(meta)
    scheduler.reload(scriptRegistry.listAll())
    return enrichScriptItem(script, runner.listSessions())
  })

  ipcMain.handle(IPC.DEV_GUIDE_GET, () => readDevGuideMarkdown())

  ipcMain.handle(IPC.DEV_GUIDE_SKILL_CREATE_GET, () => readDevGuideSkillCreateInfo())

  ipcMain.handle(IPC.SYSTEM_MEMORY, () => {
    const mem = process.memoryUsage()
    return {
      workingSetSize: mem.rss,
      peakWorkingSetSize: mem.rss
    }
  })

  ipcMain.handle(IPC.SYSTEM_BROWSER_STATUS, () => {
    const status = getBrowserStatus()
    return {
      bundled: status.bundled,
      browsersPath: status.path,
      executable: status.executable,
      installed: status.installed.map((b) => ({ id: b.id, label: b.label, path: b.path }))
    }
  })

  ipcMain.handle(IPC.SYSTEM_OPEN_PATH, async (_event, targetPath: string) => {
    if (!targetPath || !existsSync(targetPath)) return false
    if (statSync(targetPath).isDirectory()) {
      await shell.openPath(targetPath)
    } else {
      shell.showItemInFolder(targetPath)
    }
    return true
  })

  ipcMain.handle(IPC.SYSTEM_OPEN_EXTERNAL, async (_event, url: string) => {
    if (typeof url !== 'string' || !url.trim()) return false
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    try {
      await shell.openExternal(parsed.toString())
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.SYSTEM_USER_DATA_PATH, () => getAppUserDataPath())

  ipcMain.handle(IPC.SYSTEM_PYTHON_DETECT, () => {
    return detectPythonStatus(scriptStore.getConfig().python)
  })

  ipcMain.handle(IPC.SYSTEM_PICK_PYTHON, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Python', extensions: ['exe'] }]
          : [{ name: 'Python', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SYSTEM_PICK_EXTERNAL_EDITOR, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: '可执行文件', extensions: ['exe', 'cmd', 'bat', 'com'] }]
          : [{ name: '应用程序', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SYSTEM_OPEN_IN_EXTERNAL_EDITOR, async (_event, workspacePath: string) => {
    if (!workspacePath || !existsSync(workspacePath)) {
      return { ok: false, reason: 'invalid-path' as const }
    }

    let editorPath = resolveExternalEditorPath(scriptStore.getConfig())
    if (!editorPath) {
      const win = getWindow()
      const result = await dialog.showOpenDialog(win ?? undefined, {
        properties: ['openFile'],
        filters:
          process.platform === 'win32'
            ? [{ name: '可执行文件', extensions: ['exe', 'cmd', 'bat', 'com'] }]
            : [{ name: '应用程序', extensions: ['*'] }]
      })
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, reason: 'cancelled' as const }
      }
      editorPath = result.filePaths[0]
      scriptStore.setConfig({ externalEditor: { executablePath: editorPath } })
    }

    const opened = openInExternalEditor(workspacePath, editorPath)
    if (!opened.ok) return opened
    return { ok: true, editorPath: opened.editorPath }
  })

  ipcMain.handle(IPC.TERMINAL_OPEN, () => {
    openTerminalWindow()
    return true
  })

  ipcMain.handle(IPC.TERMINAL_CLOSE, () => {
    closeTerminalWindow()
    return true
  })

  ipcMain.handle(IPC.TERMINAL_TOGGLE_PIN, () => toggleTerminalPin())

  ipcMain.handle(IPC.TERMINAL_IS_OPEN, () => isTerminalWindowOpen())

  ipcMain.handle(IPC.TERMINAL_IS_PINNED, () => isTerminalPinned())

  ipcMain.handle(IPC.EDITOR_OPEN, (_event, payload: EditorSession) => {
    openEditorWindow(payload)
    return true
  })

  ipcMain.handle(IPC.EDITOR_CLOSE, () => {
    closeEditorWindow()
    return true
  })

  ipcMain.handle(IPC.EDITOR_TOGGLE_PIN, () => toggleEditorPin())

  ipcMain.handle(IPC.EDITOR_IS_OPEN, () => isEditorWindowOpen())

  ipcMain.handle(IPC.EDITOR_IS_PINNED, () => isEditorPinned())

  ipcMain.handle(IPC.EDITOR_GET_SESSION, () => getEditorSession())

  ipcMain.handle(
    IPC.EDITOR_SYNC,
    (
      _event,
      payload: { scriptId: string; activeFilePath: string; filePath: string; content: string }
    ) => {
      broadcastEditorSync(payload)
      return true
    }
  )

  ipcMain.handle(IPC.EDITOR_NOTIFY_SAVED, (_event, scriptId: string, filePath?: string) => {
    broadcastEditorSaved(scriptId, filePath)
    return true
  })

  scriptRegistry.refreshFromWorkspace()
  scheduler.reload(scriptRegistry.listAll())
}

export function getRunner(): ScriptRunnerService {
  return runner
}
