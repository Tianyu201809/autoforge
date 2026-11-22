export const MAIN_SIDEBAR_WIDTH_KEY = 'autoforge-main-sidebar-width'
export const MAIN_SIDEBAR_DEFAULT_WIDTH = 224
export const MAIN_SIDEBAR_MIN_WIDTH = 180
export const MAIN_SIDEBAR_MAX_WIDTH = 400

export const WORKSPACE_NAV_WIDTH = { min: 160, max: 240, default: 200 } as const
export const WORKSPACE_CONTEXT_WIDTH = { min: 200, max: 360, default: 252 } as const
export const WORKSPACE_INSPECTOR_WIDTH = { min: 260, max: 440, default: 320 } as const

/** 读取主侧边栏宽度（用于布局约束计算） */
export function getStoredMainSidebarWidth(): number {
  const stored = Number(localStorage.getItem(MAIN_SIDEBAR_WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) return stored
  return MAIN_SIDEBAR_DEFAULT_WIDTH
}

/** 将主侧边栏宽度限制在合理范围内 */
export function clampMainSidebarWidth(width: number): number {
  return Math.min(MAIN_SIDEBAR_MAX_WIDTH, Math.max(MAIN_SIDEBAR_MIN_WIDTH, width))
}
