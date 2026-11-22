import { reactive, watch } from 'vue'
import { WORKSPACE_CONTEXT_WIDTH, WORKSPACE_INSPECTOR_WIDTH, WORKSPACE_NAV_WIDTH } from '../constants/layout'

export type WorkspaceView = 'projects' | 'scripts' | 'history' | 'hub' | 'guide' | 'settings'

export interface WorkspaceNavigationState {
  view: WorkspaceView
  activeProjectId: string | null
  activeScriptId: string | null
  navCollapsed: boolean
  contextCollapsed: boolean
  inspectorOpen: boolean
  navWidth: number
  contextWidth: number
  inspectorWidth: number
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'autoforge-workspace-layout'
const VALID_VIEWS = new Set<WorkspaceView>(['projects', 'scripts', 'history', 'hub', 'guide', 'settings'])
const WIDTH_LIMITS = {
  nav: { ...WORKSPACE_NAV_WIDTH, fallback: WORKSPACE_NAV_WIDTH.default },
  context: { ...WORKSPACE_CONTEXT_WIDTH, fallback: WORKSPACE_CONTEXT_WIDTH.default },
  inspector: { ...WORKSPACE_INSPECTOR_WIDTH, fallback: WORKSPACE_INSPECTOR_WIDTH.default }
}

function clampWidth(value: unknown, limits: { min: number; max: number; fallback: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return limits.fallback
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)))
}

function readStored(storage: StorageLike): Partial<WorkspaceNavigationState> {
  try {
    const value = storage.getItem(STORAGE_KEY)
    if (!value) return {}
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Partial<WorkspaceNavigationState>
      : {}
  } catch {
    return {}
  }
}

function browserStorage(): StorageLike {
  if (typeof localStorage !== 'undefined') return localStorage
  return { getItem: () => null, setItem: () => undefined }
}

export function useWorkspaceNavigation(storage: StorageLike = browserStorage()) {
  const stored = readStored(storage)
  const state = reactive<WorkspaceNavigationState>({
    view: stored.view && VALID_VIEWS.has(stored.view) ? stored.view : 'projects',
    activeProjectId: typeof stored.activeProjectId === 'string' ? stored.activeProjectId : null,
    activeScriptId: typeof stored.activeScriptId === 'string' ? stored.activeScriptId : null,
    navCollapsed: stored.navCollapsed !== false,
    contextCollapsed: stored.contextCollapsed === true,
    inspectorOpen: stored.inspectorOpen !== false,
    navWidth: clampWidth(stored.navWidth, WIDTH_LIMITS.nav),
    contextWidth: clampWidth(stored.contextWidth, WIDTH_LIMITS.context),
    inspectorWidth: clampWidth(stored.inspectorWidth, WIDTH_LIMITS.inspector)
  })

  watch(state, (next) => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Layout remains usable when browser storage is unavailable.
    }
  }, { deep: true, flush: 'sync' })

  function setWidths(widths: Partial<Pick<WorkspaceNavigationState, 'navWidth' | 'contextWidth' | 'inspectorWidth'>>): void {
    if (widths.navWidth !== undefined) state.navWidth = clampWidth(widths.navWidth, WIDTH_LIMITS.nav)
    if (widths.contextWidth !== undefined) state.contextWidth = clampWidth(widths.contextWidth, WIDTH_LIMITS.context)
    if (widths.inspectorWidth !== undefined) state.inspectorWidth = clampWidth(widths.inspectorWidth, WIDTH_LIMITS.inspector)
  }

  return {
    state,
    navigate: (view: WorkspaceView) => { state.view = view },
    setActiveProject: (id: string | null) => { state.activeProjectId = id },
    setActiveScript: (id: string | null) => { state.activeScriptId = id },
    setWidths,
    toggleNav: () => { state.navCollapsed = !state.navCollapsed },
    toggleContext: () => { state.contextCollapsed = !state.contextCollapsed },
    toggleInspector: () => { state.inspectorOpen = !state.inspectorOpen }
  }
}
