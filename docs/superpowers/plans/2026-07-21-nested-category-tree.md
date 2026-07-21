# Nested Category Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn flat categories into an unlimited adjacency-list tree, filter/count by self+descendants, and shrink the sidebar footer to a short upload button plus an icon row.

**Architecture:** Add nullable `parent_id` on `categories`. Pure tree helpers live in `src/shared/category-tree.ts` (build tree, collect descendant keys, cycle check) and are reused by main and renderer. Repository/store/IPC gain `parentId` and a strict delete gate (no children, no direct scripts). Sidebar renders a tree with context menu; footer becomes compact; manager modal and category pickers become tree-aware.

**Tech Stack:** Electron main + preload IPC, Vue 3 `<script setup>`, TypeScript, sql.js SQLite migrations, existing Toast/UI patterns.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-nested-category-tree-design.md`
- Storage remains `scripts.category` as string **key** (not id).
- Builtin categories: never delete; `parentId` always `null`; rename/color via existing overrides.
- Delete custom category only when it has **no child categories** and **no scripts** with that exact key (do **not** reassign to `local`).
- Clicking a category filters scripts whose `category` is the node key **or any descendant key**; sidebar counts are recursive totals.
- No drag-and-drop reparenting; no depth hard cap; no multi-category scripts; no multi-instance runner work.
- Validate with `npm run lint` (and `npm run build` after UI tasks). There is no existing unit-test runner; Task 2 adds a small `node:test` suite for shared tree helpers only.

## File Map

- Create: `src/main/db/migrations/004-category-parent-id.ts` — `ALTER TABLE categories ADD COLUMN parent_id TEXT`
- Modify: `src/main/db/database.ts` — register migration version 4
- Create: `src/shared/category-tree.ts` — pure `buildCategoryTree`, `collectDescendantKeys`, `wouldCreateCycle`, `indexByKey`
- Create: `src/shared/category-tree.test.ts` — `node:test` coverage for helpers
- Modify: `src/shared/types/script.ts` — `parentId` on `CategoryDefinition` / `CategoryItem` / related
- Modify: `src/main/db/row-mappers.ts` — map `parent_id`
- Modify: `src/main/db/repositories/category-repository.ts` — read/write `parentId`; helpers for children / emptiness
- Modify: `src/main/services/category-service.ts` — `StoredCategory.parentId`; merge builtins with `parentId: null`; recursive sidebar counts; `createStoredCategory(..., parentId?)`
- Modify: `src/main/services/script-store.ts` — create/update/delete with parent + gates
- Modify: `src/main/ipc/handlers.ts` — IPC create/update/delete semantics per spec
- Modify: `src/preload/index.ts` + `src/renderer/src/env.d.ts` — API signatures
- Modify: `src/renderer/src/composables/useScriptStore.ts` — descendant-aware filter
- Create: `src/renderer/src/components/CategoryTreeList.vue` — expandable tree + optional context menu
- Create: `src/renderer/src/components/CategoryTreeSelect.vue` — tree picker for DetailPanel / ScriptCard
- Modify: `src/renderer/src/components/Sidebar.vue` — tree + compact footer
- Modify: `src/renderer/src/components/CategoryManagerModal.vue` — tree management + new delete copy
- Modify: `src/renderer/src/components/DetailPanel.vue` — use `CategoryTreeSelect`
- Modify: `src/renderer/src/components/ScriptCard.vue` — use `CategoryTreeSelect` / tree submenu

---

### Task 1: Schema migration and shared types

**Files:**
- Create: `src/main/db/migrations/004-category-parent-id.ts`
- Modify: `src/main/db/database.ts` (imports + `runMigrations`)
- Modify: `src/shared/types/script.ts` (`CategoryDefinition`, `CategoryItem`)
- Modify: `src/main/services/category-service.ts` (`StoredCategory` interface only in this task if needed for compile; full logic in Task 3)
- Modify: `src/main/db/row-mappers.ts`

**Interfaces:**
- Produces: DB column `parent_id TEXT` (nullable); `CategoryDefinition.parentId: string | null`; `CategoryItem.parentId: string | null`
- Consumes: existing migration registration pattern in `database.ts`

- [ ] **Step 1: Add migration file**

```ts
/** SQLite schema v4 — 分类邻接表父节点 */
export const MIGRATION_004 = `
ALTER TABLE categories ADD COLUMN parent_id TEXT;
`
```

- [ ] **Step 2: Register version 4 in `database.ts`**

Import `MIGRATION_004`. After the `currentVersion < 3` block, add:

```ts
  if (currentVersion < 4) {
    database.exec(MIGRATION_004)
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(4)
  }
```

- [ ] **Step 3: Extend shared types**

On `CategoryDefinition` add:

```ts
  /** 父分类 id；内置恒为 null；顶层自定义为 null */
  parentId: string | null
```

On `CategoryItem` add:

```ts
  parentId: string | null
```

- [ ] **Step 4: Map `parent_id` in `rowToStoredCategory`**

Update `StoredCategory` in `category-service.ts`:

```ts
export interface StoredCategory {
  id: string
  key: string
  label: string
  colorPreset: string
  parentId: string | null
}
```

Update mapper:

```ts
export function rowToStoredCategory(row: {
  id: string
  key: string
  label: string
  color_preset: string
  parent_id?: string | null
}): StoredCategory {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    colorPreset: row.color_preset,
    parentId: row.parent_id ?? null
  }
}
```

Temporarily set `parentId: null` on every `CategoryDefinition` constructed in `builtinDefinitions` / `mergeCategoryDefinitions`. Update `insertCategory` to write `parent_id` (use `category.parentId ?? null`) and `createStoredCategory` to include `parentId: null` so mid-plan builds still run before Task 3 adds full parent validation.

- [ ] **Step 5: Lint**

Run: `npm run lint`  
Expected: no new errors related to these files.

- [ ] **Step 6: Commit**

```bash
git add src/main/db/migrations/004-category-parent-id.ts src/main/db/database.ts src/shared/types/script.ts src/main/db/row-mappers.ts src/main/services/category-service.ts
git commit -m "feat: add category parent_id schema and types"
```

---

### Task 2: Shared category-tree helpers (+ tests)

**Files:**
- Create: `src/shared/category-tree.ts`
- Create: `src/shared/category-tree.test.ts`
- Modify: `package.json` — add script `"test:unit": "node --import tsx --test src/shared/category-tree.test.ts"` and devDependency `tsx` if missing

**Interfaces:**
- Produces (all pure, no Electron):

```ts
export interface CategoryTreeNode<T extends { id: string; key: string; parentId: string | null }> {
  category: T
  children: CategoryTreeNode<T>[]
}

export function indexById<T extends { id: string }>(items: T[]): Map<string, T>
export function indexByKey<T extends { key: string }>(items: T[]): Map<string, T>
export function buildCategoryTree<T extends { id: string; key: string; parentId: string | null }>(
  items: T[]
): CategoryTreeNode<T>[]
export function collectDescendantKeys<T extends { id: string; key: string; parentId: string | null }>(
  items: T[],
  rootKey: string
): string[]  // includes rootKey
export function wouldCreateCycle(
  items: { id: string; parentId: string | null }[],
  nodeId: string,
  newParentId: string | null
): boolean
export function sumRecursiveCounts(
  items: { id: string; key: string; parentId: string | null }[],
  directCounts: Map<string, number>
): Map<string, number>  // key -> recursive total
```

- [ ] **Step 1: Implement `src/shared/category-tree.ts`**

Behavior notes:
- `buildCategoryTree`: orphan `parentId` (missing parent) treated as root; stable sort children by label if present (`label` or `name`), else `key`.
- `collectDescendantKeys`: BFS/DFS from the node matching `rootKey`; if key missing, return `[]`.
- `wouldCreateCycle`: if `newParentId === null` → false; if `newParentId === nodeId` → true; walk parents from `newParentId` upward; if `nodeId` appears → true.
- `sumRecursiveCounts`: for each node, total = direct(key) + sum(children totals).

- [ ] **Step 2: Write `category-tree.test.ts` with `node:test`**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCategoryTree,
  collectDescendantKeys,
  wouldCreateCycle,
  sumRecursiveCounts
} from './category-tree'

type Cat = { id: string; key: string; parentId: string | null; label: string }

const sample: Cat[] = [
  { id: 'a', key: 'browser', parentId: null, label: '浏览器' },
  { id: 'b', key: 'resume', parentId: 'a', label: '简历' },
  { id: 'c', key: 'deep', parentId: 'b', label: '深层' },
  { id: 'd', key: 'local', parentId: null, label: '本地' }
]

describe('category-tree', () => {
  it('buildCategoryTree nests children', () => {
    const tree = buildCategoryTree(sample)
    assert.equal(tree.length, 2)
    const browser = tree.find((n) => n.category.key === 'browser')!
    assert.equal(browser.children.length, 1)
    assert.equal(browser.children[0].children[0].category.key, 'deep')
  })

  it('collectDescendantKeys includes self and descendants', () => {
    assert.deepEqual(collectDescendantKeys(sample, 'browser').sort(), ['browser', 'deep', 'resume'].sort())
    assert.deepEqual(collectDescendantKeys(sample, 'deep'), ['deep'])
  })

  it('wouldCreateCycle detects loops', () => {
    assert.equal(wouldCreateCycle(sample, 'a', 'c'), true)
    assert.equal(wouldCreateCycle(sample, 'c', 'd'), false)
    assert.equal(wouldCreateCycle(sample, 'c', null), false)
  })

  it('sumRecursiveCounts rolls up', () => {
    const direct = new Map([
      ['browser', 1],
      ['resume', 2],
      ['deep', 3],
      ['local', 4]
    ])
    const totals = sumRecursiveCounts(sample, direct)
    assert.equal(totals.get('browser'), 6)
    assert.equal(totals.get('resume'), 5)
    assert.equal(totals.get('deep'), 3)
    assert.equal(totals.get('local'), 4)
  })
})
```

- [ ] **Step 3: Add `tsx` and npm script if needed**

```bash
npm install -D tsx
```

In `package.json` scripts:

```json
"test:unit": "node --import tsx --test src/shared/category-tree.test.ts"
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`  
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/category-tree.ts src/shared/category-tree.test.ts package.json package-lock.json
git commit -m "feat: add shared category tree helpers and unit tests"
```

---

### Task 3: Repository + category-service + script-store

**Files:**
- Modify: `src/main/db/repositories/category-repository.ts`
- Modify: `src/main/services/category-service.ts`
- Modify: `src/main/services/script-store.ts`
- Modify: `src/main/db/repositories/script-repository.ts` (only if a `hasScriptsInCategory(key)` helper is cleaner than `countByCategory`)

**Interfaces:**
- Consumes: `StoredCategory.parentId`, shared tree helpers
- Produces:
  - `insertCategory` persists `parent_id`
  - `updateCategory(id, { label?, colorPreset?, parentId? })`
  - `listChildCategories(parentId: string): StoredCategory[]`
  - `mergeCategoryDefinitions` sets builtin `parentId: null` and custom from row
  - `buildCategorySidebarItems` uses `sumRecursiveCounts` and sets `CategoryItem.parentId`
  - `createStoredCategory(label, colorPreset, parentId?: string | null)`
  - `ScriptStore.addCategory(label, colorPreset, parentId?: string | null)`
  - `ScriptStore.updateCategory(id, patch)` validates parent + cycle; builtins reject `parentId` changes
  - `ScriptStore.deleteCategory` returns error if children or `countByCategory(key) > 0` (no reassign)

- [ ] **Step 1: Update repository SQL**

`insertCategory`:

```ts
this.db
  .prepare(
    'INSERT INTO categories (id, key, label, color_preset, parent_id) VALUES (?, ?, ?, ?, ?)'
  )
  .run(category.id, category.key, category.label, category.colorPreset, category.parentId)
```

`updateCategory` patch type:

```ts
patch: { label?: string; colorPreset?: string; parentId?: string | null }
```

Include `parent_id = ?` in UPDATE when `parentId` is provided (use `!== undefined` so `null` clears parent).

Add:

```ts
listChildren(parentId: string): StoredCategory[] {
  const rows = this.db
    .prepare('SELECT * FROM categories WHERE parent_id = ? ORDER BY label ASC')
    .all(parentId)
  return rows.map((row) => rowToStoredCategory(row as any))
}
```

- [ ] **Step 2: Update `createStoredCategory` and merge**

```ts
export function createStoredCategory(
  label: string,
  colorPreset: string,
  parentId: string | null = null
): StoredCategory {
  const trimmed = label.trim()
  if (!trimmed) throw new Error('分类名称不能为空')
  return {
    id: randomUUID(),
    key: `custom-${randomUUID().slice(0, 8)}`,
    label: trimmed,
    colorPreset: getColorPreset(colorPreset) ? colorPreset : 'teal',
    parentId
  }
}
```

In `builtinDefinitions`, set `parentId: null`. In custom map, set `parentId: c.parentId ?? null`.

- [ ] **Step 3: Recursive sidebar counts**

Rewrite `buildCategorySidebarItems` to:
1. Build direct counts map (unchanged, skip archived).
2. Call `sumRecursiveCounts(definitionsMapped, directCounts)` where definitionsMapped use `id`/`key`/`parentId` from merged definitions (builtins + custom + orphans with `parentId: null`).
3. Push items with recursive `count` and `parentId`.
4. Keep “hide empty builtins” using recursive count `> 0 || !builtIn`.
5. Sort: prefer tree order later in UI; for the flat `CategoryItem[]` API keep sort by recursive count then name (Sidebar will re-tree).

- [ ] **Step 4: Wire `script-store` create/update/delete**

`addCategory(label, colorPreset, parentId?: string | null)`:
- If `parentId` set: resolve parent among merged definitions **or** stored custom rows by **id**; reject if missing; builtins are valid parents (use builtin id `builtin:…` only in memory — **stored parent_id must reference a row in `categories.id` OR we store parent by key?**).

**Important design lock (follow this exactly):**  
`parent_id` stores the **parent category `id`**. Builtins are not rows in `categories`. Therefore:
- When parent is builtin, store `parent_id` as the builtin synthetic id string `builtin:<key>` **without** a FK, OR require custom parents only.

**Chosen rule for this plan:** `parent_id` is a free-form TEXT id string:
- Builtin parent → `parent_id = 'builtin:<key>'` (e.g. `builtin:browser`)
- Custom parent → `parent_id = <uuid>`
- Top-level → `NULL`

Validation: parent id must exist in `mergeCategoryDefinitions(...).map(d => d.id)`.

`updateCategory`:
- Builtin id (`builtin:` prefix): only label/color via override; if `patch.parentId !== undefined`, return error / ignore and keep null.
- Custom: if `parentId` in patch, run `wouldCreateCycle` on merged id/parentId list; reject with throw or null + store error path.

`deleteCategory(id)`:
```ts
if (id.startsWith('builtin:')) return { ok: false, error: '内置分类不可删除' }
const existing = repos.categories.listCategories().find((c) => c.id === id)
if (!existing) return { ok: false, error: '分类不存在' }
if (repos.categories.listChildren(id).length > 0) {
  return { ok: false, error: '请先删除子分类，并移走该分类下的脚本' }
}
if (repos.scripts.countByCategory(existing.key) > 0) {
  return { ok: false, error: '请先删除子分类，并移走该分类下的脚本' }
}
repos.categories.deleteCategory(id)
return { ok: true, key: existing.key }
```

- [ ] **Step 5: Lint**

Run: `npm run lint`  
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/db/repositories/category-repository.ts src/main/services/category-service.ts src/main/services/script-store.ts
git commit -m "feat: persist category parentId and enforce delete gates"
```

---

### Task 4: IPC + preload + renderer typings

**Files:**
- Modify: `src/main/ipc/handlers.ts` (CATEGORIES_CREATE / UPDATE / DELETE)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

**Interfaces:**
- Produces:

```ts
categories.create(label: string, colorPreset: string, parentId?: string | null): Promise<CategoryDefinition>
categories.update(id: string, patch: { label?: string; colorPreset?: string; parentId?: string | null }): Promise<CategoryDefinition | null>
categories.delete(id: string): Promise<{ ok: true } | { ok: false; error: string }>
```

- [ ] **Step 1: Update handlers**

CREATE: pass optional third arg `parentId` into `scriptStore.addCategory`.

UPDATE: extend patch type with `parentId?: string | null`. Keep existing manifest rewrite when label/color change. If update returns null, return null.

DELETE: **remove** the reassign-to-`local` loop. Call `scriptStore.deleteCategory(id)` and return its `{ ok, error }` result to the renderer. Do not delete if not ok.

- [ ] **Step 2: Update preload + `env.d.ts`** to match the signatures above.

- [ ] **Step 3: Lint**

Run: `npm run lint`  
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/handlers.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: expose category parentId over IPC"
```

---

### Task 5: Renderer filter by descendants

**Files:**
- Modify: `src/renderer/src/composables/useScriptStore.ts`

**Interfaces:**
- Consumes: `categoryDefinitions` (must include `parentId`) already loaded via `categories.list()`, and `activeCategoryKey`
- Produces: filter using `collectDescendantKeys(categoryDefinitions, catKey)`

- [ ] **Step 1: Change filter**

Replace exact match:

```ts
list = list.filter((s) => s.category === catKey)
```

with:

```ts
import { collectDescendantKeys } from '../../../shared/category-tree'

const keys = new Set(collectDescendantKeys(categoryDefinitions.value, catKey))
if (keys.size === 0) {
  list = list.filter((s) => s.category === catKey)
} else {
  list = list.filter((s) => keys.has(s.category))
}
```

Ensure `categoryDefinitions` is a `ref`/`computed` already on the store; if only scripts carry sidebar `CategoryItem[]`, also keep definitions in store (already present as `categories` / `categoryDefinitions` — use the definitions list that includes all nodes, not only sidebar-visible ones).

- [ ] **Step 2: Manual sanity** (after app can boot with Task 3–4): parent filter includes child scripts.

- [ ] **Step 3: Lint + commit**

```bash
git add src/renderer/src/composables/useScriptStore.ts
git commit -m "feat: filter scripts by category subtree"
```

---

### Task 6: `CategoryTreeList` + Sidebar tree + context menu

**Files:**
- Create: `src/renderer/src/components/CategoryTreeList.vue`
- Modify: `src/renderer/src/components/Sidebar.vue`

**Interfaces:**
- Props for `CategoryTreeList`: `items: CategoryItem[]`, `activeKey: string | null`, `enableContextMenu?: boolean`
- Emits: `select(key: string)`, `createChild(parent: CategoryItem)`, `rename(item: CategoryItem)`, `delete(item: CategoryItem)`
- Expand state key: `autoforge.sidebar.categoryExpanded` in `localStorage` as `Record<string, boolean>` (by category id)

- [ ] **Step 1: Implement `CategoryTreeList.vue`**

- Build tree with `buildCategoryTree(items)`.
- Render recursively: chevron for nodes with children; color dot; name; count.
- Click row → `select`.
- Chevron click toggles expand without selecting (stopPropagation).
- If `enableContextMenu`: `@contextmenu.prevent` open a small fixed menu with 新建子分类 / 重命名 / 删除.
- For builtin delete: still show 删除 but handler/parent should no-op or hide delete when `id.startsWith('builtin:')` — hide delete for builtins.

- [ ] **Step 2: Wire Sidebar categories section**

Replace flat `v-for` with:

```vue
<CategoryTreeList
  :items="categories"
  :active-key="activeCategoryKey ?? null"
  enable-context-menu
  @select="(key) => emit('category', key)"
  @create-child="onCreateChild"
  @rename="onRename"
  @delete="onDelete"
/>
```

Implement handlers:
- `onCreateChild`: prompt (window prompt or tiny inline modal already used in manager) for label → `categories.create(label, 'teal', parent.id)` → emit refresh via existing App refresh path. Prefer emitting new events `categoryCreate` / `categoryRename` / `categoryDelete` up to `App.vue` if Sidebar should stay dumb — **preferred:** emit events and let App/useScriptStore refresh.

Add emits:

```ts
categoryCreate: [payload: { parentId: string; label: string }]
categoryRename: [payload: { id: string; label: string }]
categoryDelete: [id: string]
```

Wire in `App.vue` to call preload APIs + `refresh` + Toast on `{ ok: false }`.

- [ ] **Step 3: Lint**

Run: `npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/CategoryTreeList.vue src/renderer/src/components/Sidebar.vue src/renderer/src/App.vue
git commit -m "feat: render sidebar categories as a tree with context menu"
```

---

### Task 7: Compact sidebar footer

**Files:**
- Modify: `src/renderer/src/components/Sidebar.vue` (footer block only)

**Interfaces:**
- Same emits/handlers as today; visual only

- [ ] **Step 1: Replace footer markup**

Keep full-width upload button but reduce padding (`py-1.5` / `text-[12px]`).

Replace the four full-width text rows with one flex row of icon buttons:

```vue
<div class="flex items-center justify-around gap-1 pt-1">
  <button type="button" class="…" title="进入 AutoforgeHub" @click="openAutoforgeHub">
    <Store class="w-4 h-4" />
  </button>
  <button type="button" class="…" title="脚本开发指南" @click="emit('devGuide')">
    <BookOpen class="w-4 h-4" />
  </button>
  <button type="button" class="…" title="执行历史" @click="emit('executionHistory')">
    <History class="w-4 h-4" />
  </button>
  <button type="button" class="…" title="设置" @click="emit('settings')">
    <Settings class="w-4 h-4" />
  </button>
</div>
```

Use existing `title` tooltips (native) unless the app already has a tooltip component — prefer native `title` for YAGNI.

- [ ] **Step 2: Visual check in `npm run dev`** — footer ~half height; icons still work.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Sidebar.vue
git commit -m "ui: compact sidebar footer into upload + icon row"
```

---

### Task 8: Category manager modal (tree)

**Files:**
- Modify: `src/renderer/src/components/CategoryManagerModal.vue`

**Interfaces:**
- Consumes new create/update/delete APIs
- Create form gains optional parent (default null / selected node)
- Delete confirm copy: **不再**说「脚本将移至本地程序」；改为「仅当没有子分类且没有脚本挂在此分类时可删除」

- [ ] **Step 1: Render categories with `CategoryTreeList` or indented tree** (context menu optional here; keep explicit edit/delete buttons).

- [ ] **Step 2: Create flow**

When a row is selected, “新建子分类” sets `parentId` to that row’s id; otherwise top-level. Call:

```ts
await window.autoforge.categories.create(name, colorPreset, parentId)
```

- [ ] **Step 3: Update delete UX**

On failure show Toast/`alert` with `result.error`. On success `emit('refresh')`.

- [ ] **Step 4: Lint + commit**

```bash
git add src/renderer/src/components/CategoryManagerModal.vue
git commit -m "feat: tree-based category manager with strict delete"
```

---

### Task 9: Tree pickers in DetailPanel + ScriptCard

**Files:**
- Create: `src/renderer/src/components/CategoryTreeSelect.vue`
- Modify: `src/renderer/src/components/DetailPanel.vue`
- Modify: `src/renderer/src/components/ScriptCard.vue`

**Interfaces:**
- Props: `modelValue: string` (category **key**), `definitions: CategoryDefinition[]`
- Emits: `update:modelValue` with key
- Any node selectable

- [ ] **Step 1: Implement `CategoryTreeSelect.vue`**

Dropdown button showing current label; panel lists tree from `buildCategoryTree(definitions)`; click sets key and closes.

- [ ] **Step 2: Replace DetailPanel `<select>`** with:

```vue
<CategoryTreeSelect v-model="detailCategory" :definitions="categoryDefinitions ?? []" />
```

- [ ] **Step 3: Replace ScriptCard flat submenu list** with the same tree select / inline tree (keep hover submenu timing; render indented tree buttons calling existing `applyCategory(key)`).

- [ ] **Step 4: Lint + build**

Run: `npm run lint`  
Run: `npm run build`  
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/CategoryTreeSelect.vue src/renderer/src/components/DetailPanel.vue src/renderer/src/components/ScriptCard.vue
git commit -m "feat: tree category pickers in detail panel and cards"
```

---

### Task 10: End-to-end verification checklist

**Files:** none (manual)

- [ ] **Step 1: Run app** `npm run dev`

- [ ] **Step 2: Verify checklist**

1. Fresh/migrated DB: all categories top-level; counts match pre-change for flat data.
2. Create child under builtin → appears nested; parent recursive count increases.
3. Click parent → scripts in children visible.
4. Right-click rename builtin → override label updates.
5. Delete custom with child → error Toast; after moving scripts + deleting child → success.
6. Footer icons open Hub / guide / history / settings; upload still works.
7. DetailPanel + ScriptCard can assign a nested category key.
8. `npm run test:unit` still passes; `npm run lint` + `npm run build` pass.

- [ ] **Step 3: Final commit only if verification fixed stray issues**; otherwise done.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `parent_id` adjacency list | 1, 3 |
| Any node scripts + children; builtins as parents | 3, 6, 8, 9 |
| Builtin undeletable; parentId fixed null | 3 |
| Filter + recursive counts | 2, 3, 5 |
| Context menu create/rename/delete | 6 |
| Delete gate (no reassign) | 3, 4, 8 |
| Compact footer A | 7 |
| Manager + pickers tree | 8, 9 |
| Cycle / missing parent errors | 2, 3 |
| No drag-drop / multi-instance | Global Constraints |

**Placeholder scan:** none intentional.  
**Type consistency:** `parentId` is category **id** string (`builtin:<key>` or uuid); filter/collect uses **key**; pickers v-model **key**.
