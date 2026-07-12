/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

import type {
  AppConfig,
  AppWindowConfig,
  BrowserStatusInfo,
  PythonStatusInfo,
  CategoryDefinition,
  DependencyInstallResult,
  ExecutionDaySummary,
  ExecutionHistoryPage,
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
} from '../../shared/types/script'
import type { ScriptIcon, ScriptLifecycleEvent } from '../../shared/script-contract'

export interface ScriptListResponse {
  scripts: ScriptItem[]
  stats: ScriptStats
  categories: CategoryItem[]
}

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

export interface WindowModeState extends AppWindowConfig {
  visible: boolean
  globalShortcutRegistered: boolean
}

export interface WindowApi {
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  isPinned: () => Promise<boolean>
  togglePin: () => Promise<boolean>
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
  show: () => Promise<void>
  hide: () => Promise<void>
  toggle: () => Promise<boolean>
  getMode: () => Promise<WindowModeState>
  setMode: (patch: Partial<AppWindowConfig>) => Promise<WindowModeState>
  onModeChange: (callback: (mode: WindowModeState) => void) => () => void
  versions: {
    app: string
    node: string
    electron: string
    env: 'development' | 'production'
  }
}

export interface FloatingBallApi {
  dragStart: (screenX: number, screenY: number) => void
  dragMove: (screenX: number, screenY: number) => void
  dragEnd: (screenX: number, screenY: number, moved: boolean) => Promise<void>
  openMain: () => Promise<void>
  openContextMenu: () => void
}

export interface AutoforgeApi {
  onHubScriptInstalled: (callback: (payload: { scriptId: string; name: string }) => void) => () => void
  scripts: {
    list: () => Promise<ScriptListResponse>
    get: (id: string) => Promise<ScriptItem | null>
    import: (sourcePath: string) => Promise<ScriptItem>
    update: (id: string, patch: Partial<ScriptMeta>) => Promise<ScriptItem | null>
    delete: (id: string) => Promise<boolean>
    toggleStar: (id: string) => Promise<ScriptItem | null>
    toggleArchive: (id: string) => Promise<ScriptItem | null>
    openFileDialog: () => Promise<string | null>
    openDirDialog: () => Promise<string | null>
    openAttachmentDialog: () => Promise<string[] | null>
    stageAttachments: (
      id: string,
      paramKey: string,
      sourcePaths: string[]
    ) => Promise<import('../../shared/param-attachments').ParamAttachmentItem[]>
    removeAttachment: (filePath: string) => Promise<boolean>
    getContent: (id: string) => Promise<ScriptContentInfo | null>
    listFiles: (id: string) => Promise<ScriptWorkspaceFilesInfo | null>
    readFile: (id: string, relativePath: string) => Promise<ScriptFileContent | null>
    writeFile: (id: string, relativePath: string, content: string) => Promise<boolean>
    setContent: (id: string, content: string, manifestContent?: string) => Promise<boolean>
    installDeps: (id: string) => Promise<DependencyInstallResult>
    setEnvConfig: (id: string, envId: string, values: Record<string, string>) => Promise<ScriptItem | null>
    setParams: (id: string, envId: string, values: Record<string, string>) => Promise<ScriptItem | null>
    updateMeta: (
      id: string,
      patch: { name?: string; icon?: ScriptIcon; category?: string; categoryLabel?: string; browser?: { headless?: boolean } }
    ) => Promise<ScriptItem | null>
    setupDropImportZone: (
      element: HTMLElement,
      handlers?: {
        onDone?: (script: ScriptItem) => void
        onError?: (message: string) => void
      }
    ) => () => void
  }
  categories: {
    list: () => Promise<CategoryDefinition[]>
    create: (label: string, colorPreset: string) => Promise<CategoryDefinition>
    update: (id: string, patch: { label?: string; colorPreset?: string }) => Promise<CategoryDefinition | null>
    delete: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  }
  env: {
    list: () => Promise<EnvironmentProfile[]>
    create: (profile: Omit<EnvironmentProfile, 'id'>) => Promise<EnvironmentProfile>
    update: (id: string, patch: Partial<EnvironmentProfile>) => Promise<EnvironmentProfile | null>
    delete: (id: string) => Promise<boolean>
  }
  runner: {
    start: (scriptId: string, envId?: string, params?: Record<string, string>) => Promise<RunSession>
    stop: (sessionId: string) => Promise<RunSession | null>
    listSessions: () => Promise<RunSession[]>
    getSession: (sessionId: string) => Promise<RunSession | undefined>
    onLog: (callback: (line: LogLine) => void) => () => void
    onSession: (callback: (session: RunSession) => void) => () => void
    onLifecycle: (callback: (event: ScriptLifecycleEvent) => void) => () => void
  }
  history: {
    query: (options?: ExecutionHistoryQuery) => Promise<ExecutionDaySummary[]>
    queryPage: (options?: ExecutionHistoryQuery) => Promise<ExecutionHistoryPage>
    forScript: (scriptId: string, limit?: number) => Promise<ExecutionRecord[]>
    todayCount: () => Promise<number>
  }
  config: {
    get: () => Promise<AppConfig>
    set: (config: Partial<AppConfig>) => Promise<AppConfig>
  }
  deps: {
    installGlobal: (
      packageName: string,
      version?: string,
      language?: import('../../shared/script-language').ScriptLanguage
    ) => Promise<DependencyInstallResult>
    listGlobal: (language?: import('../../shared/script-language').ScriptLanguage) => Promise<GlobalDependency[]>
    removeGlobal: (
      packageName: string,
      language?: import('../../shared/script-language').ScriptLanguage
    ) => Promise<DependencyInstallResult>
  }
  examples: {
    list: () => Promise<BundledExampleInfo[]>
    import: (exampleId: string) => Promise<ScriptItem>
  }
  devGuide: {
    get: () => Promise<string>
    getSkillCreate: () => Promise<import('../../shared/types/script').DevGuideSkillCreateInfo>
  }
  system: {
    memory: () => Promise<SystemMemoryInfo>
    browserStatus: () => Promise<BrowserStatusInfo>
    pythonDetect: () => Promise<PythonStatusInfo>
    pickPython: () => Promise<string | null>
    openPath: (targetPath: string) => Promise<boolean>
    openExternal: (url: string) => Promise<boolean>
    userDataPath: () => Promise<string>
    pickExternalEditor: () => Promise<string | null>
    openInExternalEditor: (
      workspacePath: string
    ) => Promise<{ ok: boolean; reason?: string; editorPath?: string }>
  }
  terminal: {
    open: () => Promise<boolean>
    close: () => Promise<boolean>
    togglePin: () => Promise<boolean>
    isOpen: () => Promise<boolean>
    isPinned: () => Promise<boolean>
    onClosed: (callback: () => void) => () => void
  }
  editor: {
    open: (session: EditorSessionPayload) => Promise<boolean>
    close: () => Promise<boolean>
    togglePin: () => Promise<boolean>
    isOpen: () => Promise<boolean>
    isPinned: () => Promise<boolean>
    getSession: () => Promise<EditorSessionPayload | null>
    sync: (payload: EditorSyncPayload) => Promise<boolean>
    notifySaved: (scriptId: string, filePath?: string) => Promise<boolean>
    onInit: (callback: (session: EditorSessionPayload) => void) => () => void
    onSync: (callback: (payload: EditorSyncPayload) => void) => () => void
    onSaved: (callback: (payload: { scriptId: string; filePath?: string }) => void) => () => void
    onClosed: (callback: () => void) => () => void
  }
}

declare global {
  interface Window {
    api: WindowApi
    autoforge: AutoforgeApi
    floatingBall: FloatingBallApi
  }
}

export {}
