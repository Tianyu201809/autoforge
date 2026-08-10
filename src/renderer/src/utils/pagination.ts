export type PaginationItem = number | 'ellipsis'

export function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  const safeTotal = Math.max(1, Math.trunc(totalPages))
  const safeCurrent = Math.min(Math.max(1, Math.trunc(currentPage)), safeTotal)
  const visiblePages = new Set([1, safeTotal, safeCurrent - 1, safeCurrent, safeCurrent + 1])
  const pages = [...visiblePages]
    .filter((page) => page >= 1 && page <= safeTotal)
    .sort((a, b) => a - b)
  const items: PaginationItem[] = []

  for (const page of pages) {
    const previous = items.at(-1)
    if (typeof previous === 'number') {
      const gap = page - previous
      if (gap === 2) items.push(previous + 1)
      if (gap > 2) items.push('ellipsis')
    }
    items.push(page)
  }

  return items
}

export function normalizePageInput(value: string, totalPages: number): number | null {
  if (!value.trim()) return null
  const page = Number(value)
  if (!Number.isInteger(page) || !Number.isFinite(page)) return null
  return Math.min(Math.max(1, page), Math.max(1, Math.trunc(totalPages)))
}
