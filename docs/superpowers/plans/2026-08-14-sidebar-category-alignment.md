# Sidebar Category Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align top-level category rows with the category heading, retain child indentation, and show a pencil for category management.

**Architecture:** `Sidebar.vue` owns the category list viewport and management button. `CategoryTreeNodes.vue` owns the category content offset and expansion-control placement, so it will align the root dot at zero while preserving its `depth * 12px` child indentation. Source assertions protect both surfaces.

**Tech Stack:** Vue 3, Tailwind utility classes, lucide-vue-next, Node test runner.

## Global Constraints

- Preserve the existing `depth * 12px` child-category indentation in `CategoryTreeNodes`.
- Keep the category-management button handler and tooltip unchanged.
- Do not change category selection, expansion, context-menu, or manager-modal behavior.

---

### Task 1: Align Category Rows And Clarify Management Action

**Files:**
- Modify: `src/renderer/src/components/Sidebar.vue:3-20,264-285`
- Modify: `src/renderer/src/components/Sidebar.test.mjs`

**Interfaces:**
- Consumes: existing `manageCategories` emitter and `CategoryTreeList` component.
- Produces: a category viewport aligned with its heading and a `Pencil` management glyph.

- [x] **Step 1: Write the failing source assertions**

```js
it('aligns top-level categories and uses a pencil for management', () => {
  assert.match(sidebarSource, /import \{[^}]*Pencil[^}]*\} from 'lucide-vue-next'/)
  assert.doesNotMatch(sidebarSource, /import \{[^}]*Plus[^}]*\} from 'lucide-vue-next'/)
  assert.match(sidebarSource, /<Pencil class="w-3\.5 h-3\.5" :stroke-width="1\.5" \/>/)
  assert.match(sidebarSource, /flex-1 min-h-0 overflow-y-auto overscroll-contain/)
  assert.doesNotMatch(sidebarSource, /overflow-y-auto overscroll-contain -mx-1 px-1/)
})
```

- [x] **Step 2: Confirm the test fails**

Run: `node --test src/renderer/src/components/Sidebar.test.mjs`

Expected: FAIL because the sidebar still imports and renders `Plus`, and the list viewport still has its offset classes.

- [x] **Step 3: Implement the alignment and icon changes**

```vue
<script setup lang="ts">
import {
  // existing imports
  Pencil,
  // existing imports
} from 'lucide-vue-next'
</script>

<button title="管理分类" @click="emit('manageCategories')">
  <Pencil class="w-3.5 h-3.5" :stroke-width="1.5" />
</button>

<div class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
  <CategoryTreeList />
</div>
```

Remove `Plus` from the existing Lucide import. Preserve the button classes, title, handler, and `CategoryTreeList` props/events. Do not change `CategoryTreeNodes.vue`.

- [x] **Step 4: Confirm the focused test passes**

Run: `node --test src/renderer/src/components/Sidebar.test.mjs`

Expected: PASS.

- [x] **Step 5: Run lint and production build**

Run: `npm run lint`

Expected: Exit 0 with no lint errors. Existing warnings may remain.

Run: `npm run build`

Expected: Exit 0.

- [x] **Step 6: Commit**

```powershell
git add src/renderer/src/components/Sidebar.vue src/renderer/src/components/Sidebar.test.mjs
git commit -m "fix: align sidebar category items"
```

### Task 2: Align Category Content With The Heading

**Files:**
- Modify: `src/renderer/src/components/CategoryTreeNodes.vue:28-61`
- Create: `src/renderer/src/components/CategoryTreeNodes.test.mjs`

**Interfaces:**
- Consumes: recursive `depth` and `node.children.length` values from `CategoryTreeNodes`.
- Produces: root category dots aligned at the component's left edge, `12px` child indentation, and a parent-only absolute expansion control.

- [x] **Step 1: Write the failing source assertions**

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const treeSource = readFileSync(new URL('./CategoryTreeNodes.vue', import.meta.url), 'utf8')

test('aligns category content while preserving hierarchy controls', () => {
  assert.match(treeSource, /paddingLeft: `\$\{depth \* 12\}px`/)
  assert.doesNotMatch(treeSource, /paddingLeft: `\$\{8 \+ depth \* 12\}px`/)
  assert.doesNotMatch(treeSource, /class="w-3\.5 h-3\.5 flex items-center justify-center flex-shrink-0"/)
  assert.match(treeSource, /v-if="node\.children\.length"/)
  assert.match(treeSource, /class="absolute w-3\.5 h-3\.5 flex items-center justify-center"/)
  assert.match(treeSource, /left: `\$\{depth \* 12 - 14\}px`/)
})
```

- [x] **Step 2: Confirm the test fails**

Run: `node --test src/renderer/src/components/CategoryTreeNodes.test.mjs`

Expected: FAIL because every node currently has an in-flow `w-3.5` expansion slot and an `8px` root offset.

- [x] **Step 3: Render a parent-only absolute expansion control**

```vue
<button
  class="relative w-full flex items-center gap-1.5 py-1.5 rounded-md text-[13px] transition-colors text-left"
  :style="{ paddingLeft: `${depth * 12}px`, paddingRight: '8px' }"
>
  <span
    v-if="node.children.length"
    class="absolute w-3.5 h-3.5 flex items-center justify-center"
    :style="{ left: `${depth * 12 - 14}px` }"
    @click="emit('toggle', node.category.id, $event)"
  >
    <!-- existing ChevronDown/ChevronRight conditional rendering -->
  </span>
  <!-- existing dot, label, and count -->
</button>
```

Remove the unconditional expansion-control span. Preserve the current `ChevronDown` and `ChevronRight` conditions, `@click` handler, selection handler, context-menu handler, dot, label, count, and recursion.

- [x] **Step 4: Confirm the focused test passes**

Run: `node --test src/renderer/src/components/CategoryTreeNodes.test.mjs src/renderer/src/components/Sidebar.test.mjs`

Expected: PASS.

- [x] **Step 5: Run lint and production build**

Run: `npm run lint`

Expected: Exit 0 with no lint errors. Existing warnings may remain.

Run: `npm run build`

Expected: Exit 0.

- [x] **Step 6: Commit**

```powershell
git add src/renderer/src/components/CategoryTreeNodes.vue src/renderer/src/components/CategoryTreeNodes.test.mjs
git commit -m "fix: align category tree content"
```

### Task 3: Match Category And Navigation Background Widths

**Files:**
- Modify: `src/renderer/src/components/Sidebar.vue:276`
- Modify: `src/renderer/src/components/Sidebar.test.mjs`
- Modify: `src/renderer/src/components/CategoryTreeNodes.vue:36-45`
- Modify: `src/renderer/src/components/CategoryTreeNodes.test.mjs`

**Interfaces:**
- Consumes: the `px-3` category-section gutter and the `px-2` primary-navigation gutter.
- Produces: category row backgrounds that use the same `8px` sidebar gutter as primary navigation without moving category content.

- [x] **Step 1: Write the failing source assertions**

Add the sidebar assertion, then replace the category-tree root-padding and expansion-position assertions with the compensated values:

```js
assert.match(sidebarSource, /overflow-y-auto overscroll-contain -mx-1/)
assert.match(treeSource, /paddingLeft: `\$\{4 \+ depth \* 12\}px`/)
assert.match(treeSource, /left: `\$\{depth \* 12 - 10\}px`/)
```

Remove the previous zero-based padding assertion and the `-14px` expansion-position assertion. Keep the assertion that rejects the original `8 + depth * 12` padding.

- [x] **Step 2: Confirm the tests fail**

Run: `node --test src/renderer/src/components/CategoryTreeNodes.test.mjs src/renderer/src/components/Sidebar.test.mjs`

Expected: FAIL because the category list currently has no negative horizontal margin and its content has no corresponding `4px` compensation.

- [x] **Step 3: Expand the background and compensate category content**

In `Sidebar.vue`, use:

```vue
<div class="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1">
```

In `CategoryTreeNodes.vue`, use:

```vue
:style="{ paddingLeft: `${4 + depth * 12}px`, paddingRight: '8px' }"
```

For the absolute expansion control, use:

```vue
:style="{ left: `${depth * 12 - 10}px` }"
```

Do not alter vertical sizing, border radius, colors, category content, selection behavior, or recursion.

- [x] **Step 4: Confirm the focused tests pass**

Run: `node --test src/renderer/src/components/CategoryTreeNodes.test.mjs src/renderer/src/components/Sidebar.test.mjs`

Expected: PASS.

- [x] **Step 5: Run lint and production build**

Run: `npm run lint`

Expected: Exit 0 with no lint errors. Existing warnings may remain.

Run: `npm run build`

Expected: Exit 0.

- [x] **Step 6: Commit**

```powershell
git add src/renderer/src/components/Sidebar.vue src/renderer/src/components/Sidebar.test.mjs src/renderer/src/components/CategoryTreeNodes.vue src/renderer/src/components/CategoryTreeNodes.test.mjs
git commit -m "fix: match sidebar selection widths"
```
