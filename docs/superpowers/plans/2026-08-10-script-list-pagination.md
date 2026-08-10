# Script List Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable compact page numbers and direct page input to the script list pagination bar.

**Architecture:** Keep pagination state and final range enforcement in the existing `useScriptStore`. Add pure renderer utilities for visible-page generation and jump-input normalization, then have `MainContent.vue` render those results and emit the existing `update:listPage` event.

**Tech Stack:** Vue 3 Composition API, TypeScript, Tailwind CSS utilities, Node test runner with `tsx`.

## Global Constraints

- Keep the existing page size at 12 scripts.
- Do not change the filtering, sorting, or pagination data flow in `useScriptStore`.
- Do not extract a shared pagination component for other lists.
- Keep first page, last page, current page, and one adjacent page on each side visible when applicable.
- Replace a one-page gap with that page number; use an ellipsis only for gaps of two or more pages.
- Preserve existing previous/next, filter reset, and page-count correction behavior.

---

### Task 1: Pagination Model Utilities

**Files:**
- Create: `src/renderer/src/utils/pagination.ts`
- Create: `src/renderer/src/utils/pagination.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `type PaginationItem = number | 'ellipsis'`
- Produces: `buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[]`
- Produces: `normalizePageInput(value: string, totalPages: number): number | null`

- [ ] **Step 1: Write failing utility tests**

Create `src/renderer/src/utils/pagination.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPaginationItems, normalizePageInput } from './pagination'

describe('buildPaginationItems', () => {
  it('shows every page when the total is five or fewer', () => {
    assert.deepEqual(buildPaginationItems(3, 5), [1, 2, 3, 4, 5])
  })

  it('uses compact items at the beginning, middle, and end', () => {
    assert.deepEqual(buildPaginationItems(1, 10), [1, 2, 'ellipsis', 10])
    assert.deepEqual(buildPaginationItems(5, 10), [1, 'ellipsis', 4, 5, 6, 'ellipsis', 10])
    assert.deepEqual(buildPaginationItems(9, 10), [1, 'ellipsis', 8, 9, 10])
  })

  it('shows a page number instead of hiding a one-page gap', () => {
    assert.deepEqual(buildPaginationItems(3, 6), [1, 2, 3, 4, 5, 6])
    assert.deepEqual(buildPaginationItems(4, 6), [1, 2, 3, 4, 5, 6])
  })
})

describe('normalizePageInput', () => {
  it('accepts integers and clamps them to the available range', () => {
    assert.equal(normalizePageInput('4', 10), 4)
    assert.equal(normalizePageInput('0', 10), 1)
    assert.equal(normalizePageInput('99', 10), 10)
  })

  it('rejects blank, non-numeric, and non-integer values', () => {
    assert.equal(normalizePageInput('', 10), null)
    assert.equal(normalizePageInput('abc', 10), null)
    assert.equal(normalizePageInput('2.5', 10), null)
  })
})
```

Add the test path to `test:unit` in `package.json`:

```json
"test:unit": "node --import tsx --test src/shared/category-tree.test.ts src/shared/instance-slots.test.ts src/main/services/browser-window-launch.test.mjs src/main/services/browser-context-defaults.test.mjs src/main/services/browser-lifecycle.test.mjs src/main/services/python-process-exit.test.mjs src/renderer/src/utils/pagination.test.ts src/renderer/src/components/Sidebar.test.mjs src/renderer/src/components/HistoryContextMenu.test.mjs src/renderer/src/components/DetailPanelHeader.test.mjs"
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --import tsx --test src/renderer/src/utils/pagination.test.ts
```

Expected: FAIL because `./pagination` does not exist.

- [ ] **Step 3: Implement the pure utilities**

Create `src/renderer/src/utils/pagination.ts`:

```ts
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
```

- [ ] **Step 4: Run the focused test and full unit suite**

Run:

```powershell
node --import tsx --test src/renderer/src/utils/pagination.test.ts
npm run test:unit
```

Expected: both commands PASS; the focused run reports 5 passing tests.

- [ ] **Step 5: Commit the tested pagination model**

```powershell
git add -- src/renderer/src/utils/pagination.ts src/renderer/src/utils/pagination.test.ts package.json
git commit -m "test: cover script pagination model"
```

### Task 2: Script List Pagination Controls

**Files:**
- Modify: `src/renderer/src/components/MainContent.vue:2-19`
- Modify: `src/renderer/src/components/MainContent.vue:86-94`
- Modify: `src/renderer/src/components/MainContent.vue:372-399`

**Interfaces:**
- Consumes: `buildPaginationItems(currentPage, totalPages)` and `normalizePageInput(value, totalPages)` from Task 1.
- Consumes: existing `update:listPage` emit and parent `setListPage(page: number)` range enforcement.
- Produces: clickable page buttons, jump-page input, Enter submission, and jump confirmation button.

- [ ] **Step 1: Add pagination state and submission behavior**

Update Vue imports and add the pagination utility import:

```ts
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { buildPaginationItems, normalizePageInput } from '../utils/pagination'
```

After the element refs, add:

```ts
const jumpPageInput = ref(String(props.listPage))
const paginationItems = computed(() => buildPaginationItems(props.listPage, props.listTotalPages))

watch(
  () => props.listPage,
  (page) => {
    jumpPageInput.value = String(page)
  }
)

function goToPage(page: number): void {
  if (page !== props.listPage) emit('update:listPage', page)
}

function submitJumpPage(): void {
  const page = normalizePageInput(jumpPageInput.value, props.listTotalPages)
  if (page === null) {
    jumpPageInput.value = String(props.listPage)
    return
  }
  jumpPageInput.value = String(page)
  goToPage(page)
}
```

- [ ] **Step 2: Render clickable page items and direct jump controls**

Replace the existing footer action container with a wrapping action region that retains previous/next buttons, inserts page items, and adds the jump form:

```vue
<div class="flex items-center justify-end gap-1.5 flex-wrap">
  <button
    type="button"
    aria-label="上一页"
    class="flex items-center gap-0.5 h-7 px-2.5 rounded-md text-[12px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-40"
    :disabled="listPage <= 1"
    @click="goToPage(listPage - 1)"
  >
    <ChevronLeft class="w-3.5 h-3.5" :stroke-width="1.5" />
    上一页
  </button>

  <div class="flex items-center gap-1" aria-label="脚本列表分页">
    <template v-for="(item, index) in paginationItems" :key="`${item}-${index}`">
      <span
        v-if="item === 'ellipsis'"
        class="w-7 text-center text-[12px] sb-text-faint"
        aria-hidden="true"
      >
        ...
      </span>
      <button
        v-else
        type="button"
        class="h-7 w-7 rounded-md border text-[12px] tabular-nums transition-colors disabled:opacity-100"
        :class="item === listPage
          ? 'sb-bg-inset border-[var(--sb-accent-solid)] text-[var(--sb-accent-solid)] font-medium'
          : 'sb-border sb-text-muted hover:sb-text-secondary hover:sb-bg-hover'"
        :aria-current="item === listPage ? 'page' : undefined"
        :aria-label="`第 ${item} 页`"
        :disabled="item === listPage"
        @click="goToPage(item)"
      >
        {{ item }}
      </button>
    </template>
  </div>

  <button
    type="button"
    aria-label="下一页"
    class="flex items-center gap-0.5 h-7 px-2.5 rounded-md text-[12px] sb-text-muted border sb-border hover:sb-text-secondary hover:sb-bg-hover transition-colors disabled:opacity-40"
    :disabled="listPage >= listTotalPages"
    @click="goToPage(listPage + 1)"
  >
    下一页
    <ChevronRight class="w-3.5 h-3.5" :stroke-width="1.5" />
  </button>

  <form class="ml-1 flex items-center gap-1" @submit.prevent="submitJumpPage">
    <label for="script-list-jump-page" class="text-[12px] sb-text-muted">跳至</label>
    <input
      id="script-list-jump-page"
      v-model="jumpPageInput"
      type="number"
      inputmode="numeric"
      step="1"
      min="1"
      :max="listTotalPages"
      class="h-7 w-14 rounded-md border sb-border sb-bg-input px-1.5 text-center text-[12px] tabular-nums outline-none focus:sb-input"
      aria-label="跳转页码"
    />
    <span class="text-[12px] sb-text-muted">页</span>
    <button
      type="submit"
      class="h-7 px-2.5 rounded-md border sb-border sb-text-muted text-[12px] hover:sb-text-secondary hover:sb-bg-hover transition-colors"
    >
      跳转
    </button>
  </form>
</div>
```

Change the footer root to permit wrapping without overlap:

```vue
class="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 px-5 py-2 border-t sb-border-subtle"
```

- [ ] **Step 3: Run lint, unit tests, and production build**

Run:

```powershell
npm run lint
npm run test:unit
npm run build
```

Expected: all commands exit 0. Existing warnings are acceptable only if they predate these changes; no new warnings may reference `pagination.ts` or `MainContent.vue`.

- [ ] **Step 4: Verify desktop and narrow layouts**

Run the local development server, open the app with enough scripts to produce at least 10 pages, and verify at desktop width and a narrow window:

- Current page has a clear active style and `aria-current="page"`.
- Beginning, middle, and ending page windows match the utility tests.
- Clicking a page, pressing Enter in the input, and clicking “跳转” all change pages.
- Inputs `0`, `99`, blank, and `2.5` follow the specification.
- The footer wraps without overlapping or clipping controls.

- [ ] **Step 5: Commit the component integration**

```powershell
git add -- src/renderer/src/components/MainContent.vue
git commit -m "feat: add script list page navigation"
```
