import { randomUUID } from 'crypto'
import { CATEGORY_DEFAULTS } from '../../shared/script-contract'
import {
  BUILTIN_CATEGORY_COLORS,
  getColorPreset,
  type CategoryColorPreset
} from '../../shared/category-colors'
import type { CategoryDefinition, CategoryItem, ScriptMeta } from '../../shared/types/script'

export interface StoredCategory {
  id: string
  key: string
  label: string
  colorPreset: string
}

export interface CategoryOverride {
  key: string
  label?: string
  colorPreset?: string
}

function builtinDefinitions(overrides: CategoryOverride[] = []): CategoryDefinition[] {
  const overrideMap = Object.fromEntries(overrides.map((o) => [o.key, o]))
  return Object.entries(CATEGORY_DEFAULTS).map(([key, def]) => {
    const override = overrideMap[key]
    const presetId = override?.colorPreset ?? BUILTIN_CATEGORY_COLORS[key] ?? 'zinc'
    const preset = getColorPreset(presetId)
    return {
      id: `builtin:${key}`,
      key,
      label: override?.label ?? def.label,
      colorPreset: presetId,
      builtIn: true,
      ...pickStyle(preset)
    }
  })
}

function pickStyle(preset: CategoryColorPreset): Pick<
  CategoryDefinition,
  'dotColor' | 'badgeColor' | 'iconColor' | 'iconBg' | 'iconBorder'
> {
  return {
    dotColor: preset.dotColor,
    badgeColor: preset.badgeColor,
    iconColor: preset.iconColor,
    iconBg: preset.iconBg,
    iconBorder: preset.iconBorder
  }
}

export function mergeCategoryDefinitions(
  custom: StoredCategory[],
  overrides: CategoryOverride[] = []
): CategoryDefinition[] {
  const builtins = builtinDefinitions(overrides)
  const customDefs: CategoryDefinition[] = custom.map((c) => {
    const preset = getColorPreset(c.colorPreset)
    return {
      id: c.id,
      key: c.key,
      label: c.label,
      colorPreset: c.colorPreset,
      builtIn: false,
      ...pickStyle(preset)
    }
  })
  const customKeys = new Set(customDefs.map((c) => c.key))
  return [...builtins.filter((b) => !customKeys.has(b.key)), ...customDefs]
}

export function findCategoryDefinition(
  definitions: CategoryDefinition[],
  key: string
): CategoryDefinition | undefined {
  return definitions.find((d) => d.key === key)
}

export function resolveCategoryForManifest(
  definitions: CategoryDefinition[],
  categoryKey: string,
  categoryLabel?: string
): {
  label: string
  badgeColor: string
  iconColor: string
  iconBg: string
  iconBorder: string
} {
  const def = findCategoryDefinition(definitions, categoryKey)
  const preset = def ? getColorPreset(def.colorPreset) : getColorPreset('zinc')
  const fallback = CATEGORY_DEFAULTS[categoryKey] ?? CATEGORY_DEFAULTS.local
  return {
    label: categoryLabel ?? def?.label ?? fallback.label,
    badgeColor: def?.badgeColor ?? preset.badgeColor,
    iconColor: def?.iconColor ?? preset.iconColor,
    iconBg: def?.iconBg ?? preset.iconBg,
    iconBorder: def?.iconBorder ?? preset.iconBorder
  }
}

export function buildCategorySidebarItems(
  scripts: ScriptMeta[],
  definitions: CategoryDefinition[]
): CategoryItem[] {
  const counts = new Map<string, number>()
  for (const script of scripts) {
    if (script.archived) continue
    counts.set(script.category, (counts.get(script.category) ?? 0) + 1)
  }

  const items: CategoryItem[] = []
  for (const def of definitions) {
    const count = counts.get(def.key) ?? 0
    if (count > 0 || !def.builtIn) {
      items.push({
        id: def.id,
        key: def.key,
        name: def.label,
        color: def.dotColor,
        count
      })
    }
  }

  for (const [key, count] of counts) {
    if (definitions.some((d) => d.key === key)) continue
    items.push({
      id: `orphan:${key}`,
      key,
      name: key,
      color: getColorPreset('zinc').dotColor,
      count
    })
  }

  return items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
}

export function createStoredCategory(label: string, colorPreset: string): StoredCategory {
  const trimmed = label.trim()
  if (!trimmed) throw new Error('分类名称不能为空')
  return {
    id: randomUUID(),
    key: `custom-${randomUUID().slice(0, 8)}`,
    label: trimmed,
    colorPreset: getColorPreset(colorPreset) ? colorPreset : 'teal'
  }
}
