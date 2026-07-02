import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import pkg from '../../package.json'
import { IPC } from '../shared/ipc-channels'
import { bindScriptDropImportZone, type DropImportHandlers } from './script-drop'
import type {
  AppConfig,
  AppWindowConfig,
  BrowserStatusInfo,
  PythonStatusInfo,
  CategoryDefinition,
  DependencyInstallResult,
  ExecutionDaySummary,
  ExecutionHistoryQuery,
  ExecutionRecord,
  EnvironmentProfile,
  GlobalDependency,
  BundledExampleInfo,
  LogLine,
  RunSession,
  ScriptContentInfo,
  ScriptFileContent,
  ScriptItem,
  ScriptMeta,
  ScriptStats,
  ScriptWorkspaceFilesInfo,
  CategoryItem,
  SystemMemoryInfo
} from '../shared/types/script'
import type { ScriptIcon, ScriptLifecycleEvent } from '../shared/script-contract'
import type { ScriptLanguage } from '../shared/script-language'

export interface EditorFileStatePayload {
  content: string
  savedContent: string
  binary: boolean
  loaded: boolean
}

export interface EditorSessionPayload {
  scriptId: string
  scriptName: string
  entryPath: string
  manifestPath: string
  activeFilePath: string
  files: string[]
  fileStates: Record<string, EditorFileStatePayload>
}

export interface EditorSyncPayload {
  scriptId: string
  activeFilePath: string
  filePath: string
  content: string
}

export interface ScriptListResponse {
  scripts: ScriptItem[]
  stats: ScriptStats
  categories: CategoryItem[]
}

const api = {
  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  isPinned: (): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_IS_PINNED),
  togglePin: (): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_TOGGLE_PIN),
  onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximized-changed', handler)
    return () => ipcRenderer.removeListener('window:maximized-changed', handler)
  },
  show: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_SHOW),
  hide: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_HIDE),
  toggle: (): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_TOGGLE),
  getMode: (): Promise<AppWindowConfig & { visible: boolean; globalShortcutRegistered: boolean }> =>
    ipcRenderer.invoke(IPC.WINDOW_GET_MODE),
  setMode: (
    patch: Partial<AppWindowConfig>
  ): Promise<AppWindowConfig & { visible: boolean; globalShortcutRegistered: boolean }> =>
    ipcRenderer.invoke(IPC.WINDOW_SET_MODE, patch),
  onModeChange: (
    callback: (mode: AppWindowConfig & { visible: boolean; globalShortcutRegistered: boolean }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      mode: AppWindowConfig & { visible: boolean; globalShortcutRegistered: boolean }
    ) => callback(mode)
    ipcRenderer.on(IPC.EVENT_WINDOW_MODE, handler)
    return () => ipcRenderer.removeListener(IPC.EVENT_WINDOW_MODE, handler)
  },
  versions: {
    app: pkg.version,
    node: process.versions.node,
    electron: process.versions.electron
  }
}

const autoforge = {
  scripts: {
    list: (): Promise<ScriptListResponse> => ipcRenderer.invoke(IPC.SCRIPTS_LIST),
    get: (id: string): Promise<ScriptItem | null> => ipcRenderer.invoke(IPC.SCRIPTS_GET, id),
    import: (sourcePath: string): Promise<ScriptItem> => ipcRenderer.invoke(IPC.SCRIPTS_IMPORT, sourcePath),
    update: (id: string, patch: Partial<ScriptMeta>): Promise<ScriptItem | null> =>
      ipcRenderer.invoke(IPC.SCRIPTS_UPDATE, id, patch),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.SCRIPTS_DELETE, id),
    toggleStar: (id: string): Promise<ScriptItem | null> => ipcRenderer.invoke(IPC.SCRIPTS_TOGGLE_STAR, id),
    toggleArchive: (id: string): Promise<ScriptItem | null> =>
      ipcRenderer.invoke(IPC.SCRIPTS_TOGGLE_ARCHIVE, id),
    openFileDialog: (): Promise<string | null> => ipcRenderer.invoke(IPC.SCRIPTS_OPEN_FILE_DIALOG),
    openDirDialog: (): Promise<string | null> => ipcRenderer.invoke(IPC.SCRIPTS_OPEN_DIR_DIALOG),
    openAttachmentDialog: (): Promise<string[] | null> =>
      ipcRenderer.invoke(IPC.SCRIPTS_OPEN_ATTACHMENT_DIALOG),
    stageAttachments: (
      id: string,
      paramKey: string,
      sourcePaths: string[]
    ): Promise<import('../shared/param-attachments').ParamAttachmentItem[]> =>
      ipcRenderer.invoke(IPC.SCRIPTS_STAGE_ATTACHMENTS, id, paramKey, sourcePaths),
    removeAttachment: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.SCRIPTS_REMOVE_ATTACHMENT, filePath),
    getContent: (id: string): Promise<ScriptContentInfo | null> =>
      ipcRenderer.invoke(IPC.SCRIPTS_GET_CONTENT, id),
    listFiles: (id: string): Promise<ScriptWorkspaceFilesInfo | null> =>
      ipcRenderer.invoke(IPC.SCRIPTS_LIST_FILES, id),
    readFile: (id: string, relativePath: string): Promise<ScriptFileContent | null> =>
      ipcRenderer.invoke(IPC.SCRIPTS_READ_FILE, id, relativePath),
    writeFile: (id: string, relativePath: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.SCRIPTS_WRITE_FILE, id, relativePath, content),
    setContent: (id: string, content: string, manifestContent?: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.SCRIPTS_SET_CONTENT, id, content, manifestContent),
    installDeps: (id: string): Promise<DependencyInstallResult> =>
      ipcRenderer.invoke(IPC.SCRIPTS_INSTALL_DEPS, id),
    setEnvConfig: (id: string, envId: string, values: Record<string, string>): Promise<ScriptItem | null> =>
      ipcRenderer.invoke(IPC.SCRIPTS_SET_ENV_CONFIG, id, envId, values),
    setParams: (id: string, envId: string, values: Record<string, string>): Promise<ScriptItem | null> =>
      ipcRenderer.invoke(IPC.SCRIPTS_SET_PARAMS, id, envId, values),
    updateMeta: (
      id: string,
      patch: { name?: string; icon?: ScriptIcon; category?: string; categoryLabel?: string; browser?: { headless?: boolean } }
    ): Promise<ScriptItem | null> => ipcRenderer.invoke(IPC.SCRIPTS_UPDATE_META, id, patch),
    setupDropImportZone: (element: HTMLElement, handlers?: DropImportHandlers): (() => void) =>
      bindScriptDropImportZone(element, handlers),
  },
  categories: {
    list: (): Promise<CategoryDefinition[]> => ipcRenderer.invoke(IPC.CATEGORIES_LIST),
    create: (label: string, colorPreset: string): Promise<CategoryDefinition> =>
      ipcRenderer.invoke(IPC.CATEGORIES_CREATE, label, colorPreset),
    update: (
      id: string,
      patch: { label?: string; colorPreset?: string }
    ): Promise<CategoryDefinition | null> => ipcRenderer.invoke(IPC.CATEGORIES_UPDATE, id, patch),
    delete: (id: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.CATEGORIES_DELETE, id)
  },
  env: {
    list: (): Promise<EnvironmentProfile[]> => ipcRenderer.invoke(IPC.ENV_LIST),
    create: (profile: Omit<EnvironmentProfile, 'id'>): Promise<EnvironmentProfile> =>
      ipcRenderer.invoke(IPC.ENV_CREATE, profile),
    update: (id: string, patch: Partial<EnvironmentProfile>): Promise<EnvironmentProfile | null> =>
      ipcRenderer.invoke(IPC.ENV_UPDATE, id, patch),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.ENV_DELETE, id)
  },
  runner: {
    start: (scriptId: string, envId?: string, params?: Record<string, string>): Promise<RunSession> =>
      ipcRenderer.invoke(IPC.RUNNER_START, scriptId, envId, params),
    stop: (sessionId: string): Promise<RunSession | null> => ipcRenderer.invoke(IPC.RUNNER_STOP, sessionId),
    listSessions: (): Promise<RunSession[]> => ipcRenderer.invoke(IPC.RUNNER_LIST_SESSIONS),
    getSession: (sessionId: string): Promise<RunSession | undefined> =>
      ipcRenderer.invoke(IPC.RUNNER_GET_SESSION, sessionId),
    onLog: (callback: (line: LogLine) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, line: LogLine): void => callback(line)
      ipcRenderer.on(IPC.EVENT_LOG, handler)
      return () => ipcRenderer.removeListener(IPC.EVENT_LOG, handler)
    },
    onSession: (callback: (session: RunSession) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, session: RunSession): void => callback(session)
      ipcRenderer.on(IPC.EVENT_SESSION, handler)
      return () => ipcRenderer.removeListener(IPC.EVENT_SESSION, handler)
    },
    onLifecycle: (callback: (event: ScriptLifecycleEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, ev: ScriptLifecycleEvent): void => callback(ev)
      ipcRenderer.on(IPC.EVENT_LIFECYCLE, handler)
      return () => ipcRenderer.removeListener(IPC.EVENT_LIFECYCLE, handler)
    }
  },
  history: {
    query: (options?: ExecutionHistoryQuery): Promise<ExecutionDaySummary[]> =>
      ipcRenderer.invoke(IPC.HISTORY_QUERY, options),
    forScript: (scriptId: string, limit?: number): Promise<ExecutionRecord[]> =>
      ipcRenderer.invoke(IPC.HISTORY_FOR_SCRIPT, scriptId, limit),
    todayCount: (): Promise<number> => ipcRenderer.invoke(IPC.HISTORY_TODAY_COUNT)
  },
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.CONFIG_GET),
    set: (config: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke(IPC.CONFIG_SET, config)
  },
  deps: {
    installGlobal: (
      packageName: string,
      version?: string,
      language?: ScriptLanguage
    ): Promise<DependencyInstallResult> =>
      ipcRenderer.invoke(IPC.DEPS_INSTALL_GLOBAL, packageName, version, language),
    listGlobal: (language?: ScriptLanguage): Promise<GlobalDependency[]> =>
      ipcRenderer.invoke(IPC.DEPS_LIST_GLOBAL, language),
    removeGlobal: (packageName: string, language?: ScriptLanguage): Promise<DependencyInstallResult> =>
      ipcRenderer.invoke(IPC.DEPS_REMOVE_GLOBAL, packageName, language)
  },
  examples: {
    list: (): Promise<BundledExampleInfo[]> => ipcRenderer.invoke(IPC.EXAMPLES_LIST),
    import: (exampleId: string): Promise<ScriptItem> => ipcRenderer.invoke(IPC.EXAMPLES_IMPORT, exampleId)
  },
  devGuide: {
    get: (): Promise<string> => ipcRenderer.invoke(IPC.DEV_GUIDE_GET)
  },
  system: {
    memory: (): Promise<SystemMemoryInfo> => ipcRenderer.invoke(IPC.SYSTEM_MEMORY),
    browserStatus: (): Promise<BrowserStatusInfo> => ipcRenderer.invoke(IPC.SYSTEM_BROWSER_STATUS),
    pythonDetect: (): Promise<PythonStatusInfo> => ipcRenderer.invoke(IPC.SYSTEM_PYTHON_DETECT),
    pickPython: (): Promise<string | null> => ipcRenderer.invoke(IPC.SYSTEM_PICK_PYTHON),
    openPath: (targetPath: string): Promise<boolean> => ipcRenderer.invoke(IPC.SYSTEM_OPEN_PATH, targetPath),
    userDataPath: (): Promise<string> => ipcRenderer.invoke(IPC.SYSTEM_USER_DATA_PATH),
    pickExternalEditor: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SYSTEM_PICK_EXTERNAL_EDITOR),
    openInExternalEditor: (
      workspacePath: string
    ): Promise<{ ok: boolean; reason?: string; editorPath?: string }> =>
      ipcRenderer.invoke(IPC.SYSTEM_OPEN_IN_EXTERNAL_EDITOR, workspacePath)
  },
  terminal: {
    open: (): Promise<boolean> => ipcRenderer.invoke(IPC.TERMINAL_OPEN),
    close: (): Promise<boolean> => ipcRenderer.invoke(IPC.TERMINAL_CLOSE),
    togglePin: (): Promise<boolean> => ipcRenderer.invoke(IPC.TERMINAL_TOGGLE_PIN),
    isOpen: (): Promise<boolean> => ipcRenderer.invoke(IPC.TERMINAL_IS_OPEN),
    isPinned: (): Promise<boolean> => ipcRenderer.invoke(IPC.TERMINAL_IS_PINNED),
    onClosed: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on(IPC.EVENT_TERMINAL_CLOSED, handler)
      return () => ipcRenderer.removeListener(IPC.EVENT_TERMINAL_CLOSED, handler)
    }
  },
  editor: {
    open: (session: EditorSessionPayload): Promise<boolean> => ipcRenderer.invoke(IPC.EDITOR_OPEN, session),
    close: (): Promise<boolean> => ipcRenderer.invoke(IPC.EDITOR_CLOSE),
    togglePin: (): Promise<boolean> => ipcRenderer.invoke(IPC.EDITOR_TOGGLE_PIN),
    isOpen: (): Promise<boolean> => ipcRenderer.invoke(IPC.EDITOR_IS_OPEN),
    isPinned: (): Promise<boolean> => ipcRenderer.invoke(IPC.EDITOR_IS_PINNED),
    getSession: (): Promise<EditorSessionPayload | null> => ipcRenderer.invoke(IPC.EDITOR_GET_SESSION),
    sync: (payload: EditorSyncPayload): Promise<boolean> => ipcRenderer.invoke(IPC.EDITOR_SYNC, payload),
    notifySaved: (scriptId: string, filePath?: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.EDITOR_NOTIFY_SAVED, scriptId, filePath),
    onInit: (callback: (session: EditorSessionPayload) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, session: EditorSessionPayload): void => callback(session)
      ipcRenderer.on(IPC.EVENT_EDITOR_INIT, handler)
      return () => ipcRenderer.removeListener(IPC.EVENT_EDITOR_INIT, handler)
    },
    onSync: (callback: (payload: EditorSyncPayload) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: EditorSyncPayload): void => callback(payload)
      ipcRenderer.on(IPC.EVENT_EDITOR_SYNC, handler)
      return () => ipcRenderer.removeListener(IPC.EVENT_EDITOR_SYNC, handler)
    },
    onSaved: (callback: (payload: { scriptId: string; filePath?: string }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: { scriptId: string; filePath?: string }): void =>
        callback(payload)
      ipcRenderer.on(IPC.EVENT_EDITOR_SAVED, handler)
      return () => ipcRenderer.removeListener(IPC.EVENT_EDITOR_SAVED, handler)
    },
    onClosed: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on(IPC.EVENT_EDITOR_CLOSED, handler)
      return () => ipcRenderer.removeListener(IPC.EVENT_EDITOR_CLOSED, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('autoforge', autoforge)

const floatingBall = {
  dragStart: (screenX: number, screenY: number): void => {
    ipcRenderer.send('floating-ball:drag-start', screenX, screenY)
  },
  dragMove: (screenX: number, screenY: number): void => {
    ipcRenderer.send('floating-ball:drag-move', screenX, screenY)
  },
  dragEnd: (screenX: number, screenY: number, moved: boolean): Promise<void> =>
    ipcRenderer.invoke('floating-ball:drag-end', screenX, screenY, !!moved),
  openMain: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_SHOW),
  openContextMenu: (): void => {
    ipcRenderer.send('floating-ball:context-menu')
  }
}

contextBridge.exposeInMainWorld('floatingBall', floatingBall)
