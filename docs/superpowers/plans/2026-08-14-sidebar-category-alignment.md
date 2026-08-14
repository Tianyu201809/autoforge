# Sidebar Category Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align top-level category rows with the category heading, retain child indentation, and show a pencil for category management.

**Architecture:** `Sidebar.vue` owns both the category list viewport and its management button, so the change remains local to that component. The existing recursive `CategoryTreeNodes` depth calculation stays unchanged; source assertions protect the list viewport classes and the Lucide glyph.

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
