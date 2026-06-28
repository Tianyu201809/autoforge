/** 分类颜色预设 — dot 用于侧栏圆点，其余用于标签/图标样式 */

export interface CategoryColorPreset {
  id: string
  label: string
  /** 用于色块预览的实色（不依赖 Tailwind 动态 class） */
  swatchColor: string
  dotColor: string
  badgeColor: string
  iconColor: string
  iconBg: string
  iconBorder: string
}

export const CATEGORY_COLOR_PRESETS: CategoryColorPreset[] = [
  {
    id: 'blue',
    label: '蓝色',
    swatchColor: 'rgb(59 130 246 / 0.8)',
    dotColor: 'bg-blue-500/80',
    badgeColor: 'bg-blue-500/10 text-blue-400 border-blue-500/15',
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    iconBorder: 'border-blue-500/20'
  },
  {
    id: 'violet',
    label: '紫色',
    swatchColor: 'rgb(139 92 246 / 0.8)',
    dotColor: 'bg-violet-500/80',
    badgeColor: 'bg-violet-500/10 text-violet-400 border-violet-500/15',
    iconColor: 'text-violet-400',
    iconBg: 'bg-violet-500/10',
    iconBorder: 'border-violet-500/20'
  },
  {
    id: 'amber',
    label: '琥珀',
    swatchColor: 'rgb(245 158 11 / 0.8)',
    dotColor: 'bg-amber-500/80',
    badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/15',
    iconColor: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
    iconBorder: 'border-amber-500/20'
  },
  {
    id: 'emerald',
    label: '绿色',
    swatchColor: 'rgb(16 185 129 / 0.8)',
    dotColor: 'bg-emerald-500/80',
    badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/15',
    iconColor: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    iconBorder: 'border-emerald-500/20'
  },
  {
    id: 'rose',
    label: '玫红',
    swatchColor: 'rgb(244 63 94 / 0.8)',
    dotColor: 'bg-rose-500/80',
    badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/15',
    iconColor: 'text-rose-400',
    iconBg: 'bg-rose-500/10',
    iconBorder: 'border-rose-500/20'
  },
  {
    id: 'teal',
    label: '青色',
    swatchColor: 'rgb(20 184 166 / 0.8)',
    dotColor: 'bg-teal-500/80',
    badgeColor: 'bg-teal-500/10 text-teal-400 border-teal-500/15',
    iconColor: 'text-teal-400',
    iconBg: 'bg-teal-500/10',
    iconBorder: 'border-teal-500/20'
  },
  {
    id: 'zinc',
    label: '灰色',
    swatchColor: 'rgb(113 113 122 / 0.8)',
    dotColor: 'bg-zinc-500/80',
    badgeColor: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/15',
    iconColor: 'text-zinc-400',
    iconBg: 'bg-zinc-500/10',
    iconBorder: 'border-zinc-500/20'
  }
]

const presetMap = Object.fromEntries(CATEGORY_COLOR_PRESETS.map((p) => [p.id, p]))

export function getColorPreset(id: string): CategoryColorPreset {
  return presetMap[id] ?? presetMap.zinc
}

/** 内置 category key → 颜色预设 id */
export const BUILTIN_CATEGORY_COLORS: Record<string, string> = {
  browser: 'blue',
  local: 'violet',
  scrape: 'amber',
  file: 'emerald',
  system: 'rose'
}
