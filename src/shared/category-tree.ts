export interface CategoryTreeNode<T extends { id: string; key: string; parentId: string | null }> {
  category: T
  children: CategoryTreeNode<T>[]
}

export function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

export function indexByKey<T extends { key: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.key, item]))
}

function sortLabel<T extends { key: string; label?: string; name?: string }>(a: T, b: T): number {
  const aLabel = a.label ?? a.name ?? a.key
  const bLabel = b.label ?? b.name ?? b.key
  return aLabel.localeCompare(bLabel, 'zh-CN')
}

export function buildCategoryTree<T extends { id: string; key: string; parentId: string | null }>(
  items: T[]
): CategoryTreeNode<T>[] {
  const byId = indexById(items)
  const childrenMap = new Map<string | null, T[]>()

  for (const item of items) {
    const parentId = item.parentId && byId.has(item.parentId) ? item.parentId : null
    const list = childrenMap.get(parentId) ?? []
    list.push(item)
    childrenMap.set(parentId, list)
  }

  function build(parentId: string | null): CategoryTreeNode<T>[] {
    const children = (childrenMap.get(parentId) ?? []).slice().sort(sortLabel)
    return children.map((category) => ({
      category,
      children: build(category.id)
    }))
  }

  return build(null)
}

export function collectDescendantKeys<T extends { id: string; key: string; parentId: string | null }>(
  items: T[],
  rootKey: string
): string[] {
  const root = items.find((item) => item.key === rootKey)
  if (!root) return []

  const byParent = new Map<string, T[]>()
  for (const item of items) {
    if (!item.parentId) continue
    const list = byParent.get(item.parentId) ?? []
    list.push(item)
    byParent.set(item.parentId, list)
  }

  const keys: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    keys.push(node.key)
    const children = byParent.get(node.id) ?? []
    for (const child of children) stack.push(child)
  }
  return keys
}

export function wouldCreateCycle(
  items: { id: string; parentId: string | null }[],
  nodeId: string,
  newParentId: string | null
): boolean {
  if (newParentId === null) return false
  if (newParentId === nodeId) return true

  const byId = indexById(items)
  let current: string | null = newParentId
  const seen = new Set<string>()
  while (current) {
    if (current === nodeId) return true
    if (seen.has(current)) return true
    seen.add(current)
    current = byId.get(current)?.parentId ?? null
  }
  return false
}

export function sumRecursiveCounts(
  items: { id: string; key: string; parentId: string | null }[],
  directCounts: Map<string, number>
): Map<string, number> {
  const tree = buildCategoryTree(items)
  const totals = new Map<string, number>()

  function walk(node: CategoryTreeNode<{ id: string; key: string; parentId: string | null }>): number {
    let total = directCounts.get(node.category.key) ?? 0
    for (const child of node.children) {
      total += walk(child)
    }
    totals.set(node.category.key, total)
    return total
  }

  for (const root of tree) walk(root)
  return totals
}
