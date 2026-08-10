# File Path Drop Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let eligible text inputs and textareas receive absolute local paths when files or folders are dropped on them.

**Architecture:** Keep Electron-specific `webUtils.getPathForFile()` access in `src/preload/script-drop.ts`. Expose one capability-scoped binding from preload, then mount a Vue directive on the app root that observes `document.body` and binds only safe editable text controls, including controls rendered through Vue Teleport; theme CSS supplies the hover feedback.

**Tech Stack:** Electron preload bridge, Vue 3 directive API, TypeScript, Tailwind/theme CSS, Node test runner with `tsx`.

## Global Constraints

- Do not write into search, `number`, `checkbox`, `radio`, `file`, `password`, hidden, date/time, disabled, or read-only controls.
- Do not alter selects, Cron controls, search controls, attachments, or script import behavior.
- Only write absolute path strings; never read, upload, move, copy, or import dropped files.
- Preserve drop order and join multiple paths with `\n`.
- Dispatch a bubbling native `input` event after writing, so existing Vue `v-model` and `@input` handlers update.
- Use existing `webUtils.getPathForFile()` in preload; no new IPC channel or main-process handler.

---

### Task 1: Preload Path-Drop Binding

**Files:**
- Modify: `src/preload/script-drop.ts`
- Modify: `src/preload/index.ts:1-5,169-171`
- Modify: `src/renderer/src/env.d.ts:102-155`
- Test: `src/preload/script-drop.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `bindFilePathDropTarget(element: HTMLInputElement | HTMLTextAreaElement): () => void`
- Produces: `window.autoforge.files.setupPathDropTarget(element): () => void`
- Consumes: Electron `webUtils.getPathForFile(file)`.

- [ ] **Step 1: Write failing preload tests**

Create `src/preload/script-drop.test.ts` with a testable event-binding factory. Mock the path resolver rather than Electron:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bindFilePathDropTarget } from './script-drop'

describe('bindFilePathDropTarget', () => {
  it('writes dropped paths in order and dispatches a bubbling input event', () => {
    const listeners = new Map<string, EventListener>()
    const events: Event[] = []
    const element = {
      value: '',
      classList: { add() {}, remove() {} },
      addEventListener(name: string, listener: EventListener) { listeners.set(name, listener) },
      removeEventListener() {},
      dispatchEvent(event: Event) { events.push(event); return true }
    } as unknown as HTMLInputElement
    const unbind = bindFilePathDropTarget(element, () => ['C:\\one.txt', 'C:\\two.txt'])

    listeners.get('drop')!(new DragEvent('drop'))
    assert.equal(element.value, 'C:\\one.txt\nC:\\two.txt')
    assert.equal(events[0]?.type, 'input')
    assert.equal(events[0]?.bubbles, true)
    unbind()
  })

  it('does not modify the element when no path is resolved', () => {
    const listeners = new Map<string, EventListener>()
    const element = {
      value: 'keep',
      classList: { add() {}, remove() {} },
      addEventListener(name: string, listener: EventListener) { listeners.set(name, listener) },
      removeEventListener() {},
      dispatchEvent() { return true }
    } as unknown as HTMLInputElement
    bindFilePathDropTarget(element, () => [])

    listeners.get('drop')!({ preventDefault() {}, stopPropagation() {} } as unknown as DragEvent)
    assert.equal(element.value, 'keep')
  })

  it('adds and removes the drag feedback class only for file drops', () => {
    const listeners = new Map<string, EventListener>()
    const classes = new Set<string>()
    const element = {
      value: '',
      classList: { add(value: string) { classes.add(value) }, remove(value: string) { classes.delete(value) } },
      addEventListener(name: string, listener: EventListener) { listeners.set(name, listener) },
      removeEventListener() {},
      dispatchEvent() { return true }
    } as unknown as HTMLInputElement
    bindFilePathDropTarget(element, () => ['C:\\one.txt'])

    listeners.get('dragover')!({ preventDefault() {}, dataTransfer: null } as unknown as DragEvent)
    assert.equal(classes.has('is-file-path-drop-target'), true)
    listeners.get('dragleave')!(new Event('dragleave'))
    assert.equal(classes.has('is-file-path-drop-target'), false)
  })
})
```

Add `src/preload/script-drop.test.ts` to `test:unit` in `package.json`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --import tsx --test src/preload/script-drop.test.ts
```

Expected: FAIL because the exported path-drop binding does not exist.

- [ ] **Step 3: Extract collection and add the binding**

In `src/preload/script-drop.ts`, keep `collectDropPaths(event)` as the single `webUtils` wrapper and export a binding that accepts an optional resolver for tests:

```ts
export type DropPathResolver = (event: DragEvent) => string[]

export function bindFilePathDropTarget(
  element: HTMLInputElement | HTMLTextAreaElement,
  resolvePaths: DropPathResolver = collectDropPaths
): () => void {
  const clearFeedback = (): void => element.classList.remove('is-file-path-drop-target')
  const onDragOver = (event: DragEvent): void => {
    if (!resolvePaths(event).length) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    element.classList.add('is-file-path-drop-target')
  }
  const onDragLeave = (): void => clearFeedback()
  const onDrop = (event: DragEvent): void => {
    const paths = resolvePaths(event)
    clearFeedback()
    if (!paths.length) return
    event.preventDefault()
    event.stopPropagation()
    element.value = paths.join('\n')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
  element.addEventListener('dragover', onDragOver)
  element.addEventListener('dragleave', onDragLeave)
  element.addEventListener('drop', onDrop)
  return () => {
    clearFeedback()
    element.removeEventListener('dragover', onDragOver)
    element.removeEventListener('dragleave', onDragLeave)
    element.removeEventListener('drop', onDrop)
  }
}
```

In `src/preload/index.ts`, import `bindFilePathDropTarget` and expose it without IPC:

```ts
files: {
  setupPathDropTarget: (element: HTMLInputElement | HTMLTextAreaElement): (() => void) =>
    bindFilePathDropTarget(element)
},
```

Add the matching `files.setupPathDropTarget` declaration to `AutoforgeApi` in `src/renderer/src/env.d.ts`.

- [ ] **Step 4: Run focused and complete unit tests**

Run:

```powershell
node --import tsx --test src/preload/script-drop.test.ts
npm run test:unit
```

Expected: focused tests pass for writing, no-path behavior, feedback cleanup, and existing unit suite passes.

- [ ] **Step 5: Commit preload capability**

```powershell
git add -- src/preload/script-drop.ts src/preload/script-drop.test.ts src/preload/index.ts src/renderer/src/env.d.ts package.json
git commit -m "feat: expose file path drop targets"
```

### Task 2: Global Vue Directive and Feedback Style

**Files:**
- Create: `src/renderer/src/directives/file-path-drop.ts`
- Create: `src/renderer/src/directives/file-path-drop.test.ts`
- Modify: `src/renderer/src/main.ts:1-16`
- Modify: `src/renderer/src/assets/main.css`
- Modify: `package.json`

**Interfaces:**
- Consumes: `window.autoforge.files.setupPathDropTarget(element): () => void` from Task 1.
- Produces: `filePathDropDirective` with `mounted` and `unmounted` hooks.
- Produces: app-root template directive `v-file-path-drop`, registered as `file-path-drop`, which observes `document.body` so it also covers Teleport content.

- [ ] **Step 1: Write failing directive tests**

Create `src/renderer/src/directives/file-path-drop.test.ts`:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isFilePathDropTarget } from './file-path-drop'

describe('isFilePathDropTarget', () => {
  it('accepts editable text inputs and textareas', () => {
    assert.equal(isFilePathDropTarget({ tagName: 'INPUT', type: 'text', disabled: false, readOnly: false } as HTMLInputElement), true)
    assert.equal(isFilePathDropTarget({ tagName: 'TEXTAREA', disabled: false, readOnly: false } as HTMLTextAreaElement), true)
  })

  it('rejects non-text, disabled, and readonly controls', () => {
    assert.equal(isFilePathDropTarget({ tagName: 'INPUT', type: 'number', disabled: false, readOnly: false } as HTMLInputElement), false)
    assert.equal(isFilePathDropTarget({ tagName: 'INPUT', type: 'search', disabled: false, readOnly: false } as HTMLInputElement), false)
    assert.equal(isFilePathDropTarget({ tagName: 'INPUT', type: 'password', disabled: false, readOnly: false } as HTMLInputElement), false)
    assert.equal(isFilePathDropTarget({ tagName: 'INPUT', type: 'text', disabled: true, readOnly: false } as HTMLInputElement), false)
    assert.equal(isFilePathDropTarget({ tagName: 'TEXTAREA', disabled: false, readOnly: true } as HTMLTextAreaElement), false)
  })
})
```

Add this test to `test:unit`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --import tsx --test src/renderer/src/directives/file-path-drop.test.ts
```

Expected: FAIL because `./file-path-drop` does not exist.

- [ ] **Step 3: Implement target filtering and lifecycle binding**

Create `src/renderer/src/directives/file-path-drop.ts`:

```ts
import type { Directive } from 'vue'

type TextControl = HTMLInputElement | HTMLTextAreaElement
const unbinders = new WeakMap<TextControl, () => void>()
const observers = new WeakMap<HTMLElement, MutationObserver>()
const supportedInputTypes = new Set(['text', 'url', 'email', 'tel'])

export function isFilePathDropTarget(element: Element): element is TextControl {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
  return element instanceof HTMLInputElement
    && !element.disabled
    && !element.readOnly
    && supportedInputTypes.has(element.type)
}

export const filePathDropDirective: Directive<TextControl> = {
  mounted(root) {
    const bind = (element: Element): void => {
      if (!isFilePathDropTarget(element) || unbinders.has(element)) return
      unbinders.set(element, window.autoforge.files.setupPathDropTarget(element))
    }
    const scan = (node: Node): void => {
      if (!(node instanceof Element)) return
      bind(node)
      node.querySelectorAll('input, textarea').forEach(bind)
    }
    document.body.querySelectorAll('input, textarea').forEach(bind)
    const observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(scan)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    observers.set(root, observer)
  },
  unmounted(root) {
    observers.get(root)?.disconnect()
    observers.delete(root)
    document.body.querySelectorAll('input, textarea').forEach((element) => {
      const control = element as TextControl
      unbinders.get(control)?.()
      unbinders.delete(control)
    })
  }
}
```

Register the directive before mounting in `src/renderer/src/main.ts` and add `v-file-path-drop` to the existing root element in `src/renderer/src/App.vue`:

```ts
import { filePathDropDirective } from './directives/file-path-drop'

const app = createApp(App)
app.directive('file-path-drop', filePathDropDirective)
app.mount('#app')
```

```vue
<div v-file-path-drop class="flex flex-col h-full">
```

The body observer automatically binds eligible inputs in the main hierarchy and all `Teleport to="body"` modals. It ignores search controls, numeric inputs, password inputs, attachment widgets, checkbox/radio inputs, selects, and Cron component controls. Add the feedback styling to `src/renderer/src/assets/main.css`:

```css
.is-file-path-drop-target {
  border-color: var(--sb-accent-solid) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--sb-accent-solid) 18%, transparent);
}
```

- [ ] **Step 4: Run tests, lint, and production build**

Run:

```powershell
npm run test:unit
npm run lint
npm run build
```

Expected: all commands exit 0; no new warnings reference the directive, `main.ts`, or touched templates.

- [ ] **Step 5: Manually verify text form fields**

Launch the development app and drag one file, then multiple files, onto:

- A script parameter text field and textarea.
- An editable environment-variable value field.

Verify the controls receive absolute paths, multiple paths are separated by newlines, existing form values update, feedback clears after drop, and password/numeric/search fields remain unchanged. Repeat one valid target in both dark and light themes and at narrow width.

- [ ] **Step 6: Commit renderer integration**

```powershell
git add -- src/renderer/src/directives/file-path-drop.ts src/renderer/src/directives/file-path-drop.test.ts src/renderer/src/main.ts src/renderer/src/App.vue src/renderer/src/assets/main.css package.json
git commit -m "feat: accept file paths in text inputs"
```
