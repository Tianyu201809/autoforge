# Script Folder Drop Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a theme-aware overlay during script-folder drag and import.

**Architecture:** The existing drop helper tracks nested browser drag events and reports active state to `MainContent`. `App` owns dropped-import loading; `useScriptStore` signals immediately before the executable picker opens.

**Tech Stack:** Vue 3, TypeScript, Tailwind, existing CSS theme variables, Node test runner.

## Global Constraints

- Cover `MainContent` only, keeping title and status bars visible.
- Use existing `--sb-*` variables; add no skin-specific colors.
- Keep prompt and loading panel dimensions stable.
- Preserve dialog import and existing toast behavior.
- Clear loading before executable-entry selection appears.

---

### Task 1: Track Drag State In The Existing Drop Helper

**Files:**
- Modify: `src/renderer/src/lib/script-drop-import.ts`
- Modify: `src/renderer/src/lib/script-drop-import.test.ts`

**Interfaces:**
- Produces: `ScriptDropImportHandlers` with `onPath(sourcePath: string)` and optional `onDragStateChange(active: boolean)`.

- [x] **Step 1: Write the failing test**

```ts
test('tracks nested file drag events and clears state after drop', () => {
  const listeners = new Map<string, EventListener>()
  const states: boolean[] = []
  const element = { addEventListener(n: string, l: EventListener) { listeners.set(n, l) }, removeEventListener(n: string) { listeners.delete(n) } } as unknown as HTMLElement
  const event = { dataTransfer: { files: [{ name: 'script' } as File] }, preventDefault() {}, stopPropagation() {} } as unknown as DragEvent
  const unbind = bindScriptDropImportZone(element, () => 'C:\\scripts\\script', { onPath() {}, onDragStateChange: (active) => states.push(active) })
  listeners.get('dragenter')!(event)
  listeners.get('dragenter')!(event)
  listeners.get('dragleave')!(event)
  listeners.get('drop')!(event)
  assert.deepEqual(states, [true, false])
  unbind()
})
```

- [x] **Step 2: Confirm the test fails**

Run: `node --import tsx --test src/renderer/src/lib/script-drop-import.test.ts`

Expected: FAIL because drag-state callbacks and listeners do not exist.

- [x] **Step 3: Implement nested drag tracking**

```ts
export interface ScriptDropImportHandlers {
  onPath: (sourcePath: string) => void
  onDragStateChange?: (active: boolean) => void
}

let dragDepth = 0
const hasFiles = (event: DragEvent) => Boolean(event.dataTransfer?.files.length)
const onDragEnter = (event: DragEvent) => {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragDepth += 1
  if (dragDepth === 1) handlers.onDragStateChange?.(true)
}
const onDragLeave = (event: DragEvent) => {
  if (!hasFiles(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) handlers.onDragStateChange?.(false)
}
const onDrop = (event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()
  if (dragDepth > 0) handlers.onDragStateChange?.(false)
  dragDepth = 0
  const files = Array.from(event.dataTransfer?.files ?? [])
  const sourcePath = resolveDropImportPath(files.map(resolveFilePath))
  if (sourcePath) handlers.onPath(sourcePath)
}
```

Attach and clean up `dragenter`, `dragover`, `dragleave`, and `drop`. Keep `dragDepth` inside `bindScriptDropImportZone`.

- [x] **Step 4: Confirm helper tests pass**

Run: `node --import tsx --test src/renderer/src/lib/script-drop-import.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/renderer/src/lib/script-drop-import.ts src/renderer/src/lib/script-drop-import.test.ts
git commit -m "feat: track script import drag state"
```

### Task 2: Render A Stable Theme-Aware Overlay

**Files:**
- Modify: `src/renderer/src/components/MainContent.vue`
- Create: `src/renderer/src/components/MainContentDropOverlay.test.mjs`

**Interfaces:**
- Consumes: Task 1 callback and a `dropImporting: boolean` prop.
- Produces: `importPath` event and `dropActive` visual state.

- [x] **Step 1: Write the failing component-source test**

```js
const source = readFileSync(new URL('./MainContent.vue', import.meta.url), 'utf8')
test('renders release and loading drop states', () => {
  assert.match(source, /dropImporting: boolean/)
  assert.match(source, /onDragStateChange: \(active\) => \(dropActive\.value = active\)/)
  assert.match(source, /v-if="dropActive \|\| dropImporting"/)
  assert.match(source, /松开鼠标上传脚本/)
  assert.match(source, /正在上传脚本/)
  assert.match(source, /var\(--sb-accent-solid\)/)
  assert.match(source, /role="status"/)
})
```

Include Node imports for `assert`, `readFileSync`, and `test`, matching existing component-source test style.

- [x] **Step 2: Confirm the test fails**

Run: `node --test src/renderer/src/components/MainContentDropOverlay.test.mjs`

Expected: FAIL because no import prop, state binding, or overlay exists.

- [x] **Step 3: Implement the component state and markup**

```ts
// Add this member to the existing MainContent defineProps type.
dropImporting: boolean
const dropActive = ref(false)

unbindDropZone = bindScriptDropImportZone(mainRef.value, window.autoforge.scripts.getDroppedFilePath, {
  onPath: (sourcePath) => emit('importPath', sourcePath),
  onDragStateChange: (active) => (dropActive.value = active)
})
```

Inside the relative main panel add an absolute `v-if="dropActive || dropImporting"` layer with `z-20`, backdrop blur, `sb-bg-base` opacity, `pointer-events-auto`, `role="status"`, and `aria-live="polite"`. Center one fixed-width card: its border and upload icon use `var(--sb-accent-solid)`. Render Lucide `Upload` with `松开鼠标上传脚本` and support text when `dropActive`; render an `animate-spin` ring with `正在上传脚本` and `正在检查并导入文件，请稍候` otherwise. Use identical width and padding in both branches.

- [x] **Step 4: Confirm the test passes**

Run: `node --test src/renderer/src/components/MainContentDropOverlay.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/renderer/src/components/MainContent.vue src/renderer/src/components/MainContentDropOverlay.test.mjs
git commit -m "feat: show script import drop overlay"
```

### Task 3: Bind Loading To Import Completion

**Files:**
- Modify: `src/renderer/src/composables/useScriptStore.ts`
- Modify: `src/renderer/src/App.vue`
- Create: `src/renderer/src/composables/useScriptStoreImport.test.mjs`

**Interfaces:**
- Produces: `importFromPath(sourcePath, { onBeforeExecutableSelection? })` and `dropImporting` root state.

- [x] **Step 1: Write the failing source test**

```js
const store = readFileSync(new URL('./useScriptStore.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
test('clears loading before executable selection and after import', () => {
  assert.match(store, /onBeforeExecutableSelection\?: \(\) => void/)
  assert.match(store, /options\?\.onBeforeExecutableSelection\?\.\(\)/)
  assert.match(app, /const dropImporting = ref\(false\)/)
  assert.match(app, /finally\s*\{\s*dropImporting\.value = false/s)
  assert.match(app, /:drop-importing="dropImporting"/)
})
```

Include Node imports matching Task 2.

- [x] **Step 2: Confirm the test fails**

Run: `node --test src/renderer/src/composables/useScriptStoreImport.test.mjs`

Expected: FAIL because the callback option and dropped-import flag do not exist.

- [x] **Step 3: Coordinate store and root state**

```ts
type ScriptImportOptions = { onBeforeExecutableSelection?: () => void }

async function importFromPath(sourcePath: string, options: ScriptImportOptions = {}): Promise<void> {
  try {
    const inspection = await window.autoforge.scripts.inspectImport(sourcePath)
    let selectedEntry = inspection.kind === 'ready' ? inspection.candidate?.entry : undefined
    if (inspection.kind === 'select-executable') {
      options.onBeforeExecutableSelection?.()
      selectedEntry = (await chooseExecutableEntry(inspection.candidates)) ?? undefined
      if (!selectedEntry) return
    }
    const imported = await window.autoforge.scripts.import(sourcePath, selectedEntry)
    await refresh()
    pushToast({
      type: 'success',
      title: '导入成功',
      message: imported.name ? `已添加「${imported.name}」` : '脚本已添加到列表'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushToast({ type: 'error', title: '导入失败', message })
  }
}

async function handleDroppedImport(sourcePath: string): Promise<void> {
  dropImporting.value = true
  try {
    await importFromPath(sourcePath, { onBeforeExecutableSelection: () => { dropImporting.value = false } })
  } finally {
    dropImporting.value = false
  }
}
```

Declare `const dropImporting = ref(false)` in `App.vue`, pass `:drop-importing="dropImporting"` to `MainContent`, and bind `@import-path="handleDroppedImport"`. Leave `importScript()` calling `await importFromPath(sourcePath)` with no options.

- [x] **Step 4: Confirm the test passes**

Run: `node --test src/renderer/src/composables/useScriptStoreImport.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/renderer/src/composables/useScriptStore.ts src/renderer/src/App.vue src/renderer/src/composables/useScriptStoreImport.test.mjs
git commit -m "feat: show loading during dropped script import"
```

### Task 4: Verify The Renderer Change

**Files:**
- Modify: no predefined source files; only correct defects found by the listed verification commands.

- [x] **Step 1: Run focused tests**

Run: `node --import tsx --test src/renderer/src/lib/script-drop-import.test.ts src/renderer/src/components/MainContentDropOverlay.test.mjs src/renderer/src/composables/useScriptStoreImport.test.mjs`

Expected: PASS.

- [x] **Step 2: Run static checks**

Run: `npm run lint`

Expected: exit code 0 with no lint errors.

- [x] **Step 3: Build the app**

Run: `npm run build`

Expected: exit code 0 with generated Electron artifacts.

- [ ] **Step 4: Verify the visual workflow**

Run: `npm run dev`

Expected: drag-over covers only main content, release becomes loading, success or failure clears loading, and executable selection appears without loading behind it.
