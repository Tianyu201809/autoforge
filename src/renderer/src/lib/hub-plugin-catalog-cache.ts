import type { HubPlugin, HubTeam } from '../../../shared/hub-types'

export type CatalogSnapshot = {
  items: HubPlugin[]
  categoryCounts: Record<string, number>
}

export type CatalogFilterState = { q: string; category: string }

/**
 * Catalog data is kept at module scope so it survives panel visibility toggles
 * and component remounts. Team data is additionally partitioned by team id.
 */
export const hubPluginCatalogCache = {
  marketplace: new Map<string, CatalogSnapshot>(),
  personal: new Map<string, CatalogSnapshot>(),
  team: new Map<string, Map<string, CatalogSnapshot>>(),
  teams: null as HubTeam[] | null,
  filters: {
    marketplace: { q: '', category: '' } as CatalogFilterState,
    personal: { q: '', category: '' } as CatalogFilterState,
    team: new Map<string, CatalogFilterState>()
  }
}
