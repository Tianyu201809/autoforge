# Dropped Script Selection And Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign dropped scripts to the current category context and select them in a visible list view.

**Architecture:** The store accepts an optional category key, persists it after import, and returns `ScriptItem | null`. `App` captures the current category before awaiting import, restores a view that exposes the new item, navigates to its page, and selects it.

**Tech Stack:** Vue 3 composition API, TypeScript, Electron preload API, Node test runner.

## Global Constraints

- Apply category and selection only to folder/package drop imports.
- Use the exact active category key, or `local` when no category is active.
- Preserve the active category while clearing filters that would hide the new script.
- In non-category views switch to `all`, clear search and list filters, then select the script.
- Failed imports and cancelled executable selection retain current view and selection.

---

### Task 1: Return A Categorized Import Result

**Files:**
- Modify: `src/renderer/src/composables/useScriptStore.ts`
- Modify: `src/renderer/src/composables/useScriptStoreImport.test.mjs`

**Interfaces:**
- Produces: `importFromPath(sourcePath: string, options?: ScriptImportOptions): Promise<ScriptItem | null>`.
- `ScriptImportOptions`: `onBeforeExecutableSelection?: () => void`, `categoryKey?: string`.

- [x] **Step 1: Write the failing source assertions**

```js
assert.match(store, /categoryKey\?: string/)
assert.match(store, /Promise<ScriptItem \| null>/)
assert.match(store, /scripts\.updateMeta\(imported\.id, \{ category: options\.categoryKey \}\)/)
assert.match(store, /return categorized/)
assert.match(store, /return null/)
```

- [x] **Step 2: Confirm the test fails**

Run: `node --test src/renderer/src/composables/useScriptStoreImport.test.mjs`

Expected: FAIL because category options and nullable results do not exist.

- [x] **Step 3: Implement the nullable categorized result**

```ts
type ScriptImportOptions = {
  onBeforeExecutableSelection?: () => void
  categoryKey?: string
}

async function importFromPath(sourcePath: string, options: ScriptImportOptions = {}): Promise<ScriptItem | null> {
  try {
    const imported = await window.autoforge.scripts.import(sourcePath, selectedEntry)
    const categorized = options.categoryKey === undefined
      ? imported
      : await window.autoforge.scripts.updateMeta(imported.id, { category: options.categoryKey })
    if (!categorized) throw new Error('导入成功，但未能设置脚本分类')
    await refresh()
    pushToast({ type: 'success', title: '导入成功', message: categorized.name ? `已添加「${categorized.name}」` : '脚本已添加到列表' })
    return categorized
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushToast({ type: 'error', title: '导入失败', message })
    return null
  }
}
```

Keep inspection and executable-picker statements before the import statement unchanged.

- [x] **Step 4: Confirm the test passes**

Run: `node --test src/renderer/src/composables/useScriptStoreImport.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/renderer/src/composables/useScriptStore.ts src/renderer/src/composables/useScriptStoreImport.test.mjs
git commit -m "feat: return categorized dropped imports"
```

### Task 2: Restore A Visible View And Select The Result

**Files:**
- Modify: `src/renderer/src/App.vue`
- Create: `src/renderer/src/AppDroppedImportSelection.test.mjs`

**Interfaces:**
- Consumes: `ScriptItem | null` import result and `activeCategoryKey`.
- Produces: selection of successful dropped imports only.

- [x] **Step 1: Write the failing source assertions**

```js
assert.match(source, /activeCategoryKey/)
assert.match(source, /categoryKey: categoryKey \?\? 'local'/)
assert.match(source, /if \(!imported\) return/)
assert.match(source, /setNavFilter\('all'\)/)
assert.match(source, /searchQuery\.value = ''/)
assert.match(source, /resetListFilter\(\)/)
assert.match(source, /setListPage\(Math\.floor\(importedIndex \/ listPageSize\.value\) \+ 1\)/)
assert.match(source, /selectScript\(imported\)/)
```

- [x] **Step 2: Confirm the test fails**

Run: `node --test src/renderer/src/AppDroppedImportSelection.test.mjs`

Expected: FAIL because the handler does not capture category or select a result.

- [x] **Step 3: Implement selection and view restoration**

```ts
async function handleDroppedImport(sourcePath: string): Promise<void> {
  const categoryKey = activeCategoryKey.value
  dropImporting.value = true
  try {
    const imported = await importFromPath(sourcePath, {
      categoryKey: categoryKey ?? 'local',
      onBeforeExecutableSelection: () => { dropImporting.value = false }
    })
    if (!imported) return
    setNavFilter('all')
    searchQuery.value = ''
    if (categoryKey) {
      setListFilter({ status: 'all', categoryKey, starredOnly: false, scheduledOnly: false })
    } else {
      resetListFilter()
    }
    const importedIndex = filteredScripts.value.findIndex((script) => script.id === imported.id)
    if (importedIndex >= 0) setListPage(Math.floor(importedIndex / listPageSize.value) + 1)
    selectScript(imported)
  } finally {
    dropImporting.value = false
  }
}
```

Destructure `activeCategoryKey` and `listPageSize` from `useScriptStore`.

- [x] **Step 4: Confirm the test passes**

Run: `node --test src/renderer/src/AppDroppedImportSelection.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/renderer/src/App.vue src/renderer/src/AppDroppedImportSelection.test.mjs
git commit -m "feat: select dropped scripts in their category"
```

### Task 3: Verify The Dropped Import Flow

**Files:**
- Modify: no source changes expected.

- [x] **Step 1: Run focused tests**

Run: `node --import tsx --test src/renderer/src/lib/script-drop-import.test.ts src/renderer/src/composables/useScriptStoreImport.test.mjs src/renderer/src/AppDroppedImportSelection.test.mjs`

Expected: PASS.

- [x] **Step 2: Run lint and production build**

Run: `npm run lint; npm run build`

Expected: lint exits with no errors and the production build exits with code 0.
