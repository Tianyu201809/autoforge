# Maximized Script Browser Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current session. Subagents are not required for this focused change.

**Goal:** Make headed Chromium-family browsers launched by Autoforge scripts start maximized.

**Architecture:** Add a pure helper that derives browser window launch arguments from engine and headless state. Reuse it in the JavaScript Playwright launcher and serialize the same arguments into the Python runtime configuration.

**Tech Stack:** TypeScript, Node.js test runner, Playwright Core, Python Playwright runtime

## Global Constraints

- Add `--start-maximized` only for headed Chromium-family launches.
- Do not change Firefox, headless mode, SDK signatures, fallback order, or script viewport options.
- Keep JavaScript and Python launch behavior aligned.

---

### Task 1: Browser window launch arguments

**Files:**
- Create: `src/main/services/browser-window-launch.ts`
- Create: `src/main/services/browser-window-launch.test.mjs`
- Modify: `src/main/services/browser-path.ts`
- Modify: `resources/python/autoforge_runtime/browser.py`
- Modify: `package.json`

**Interfaces:**
- Produces: `getBrowserWindowLaunchArgs(engine: 'chromium' | 'firefox', headless: boolean): string[]`
- Consumes: `BrowserLaunchPlan.engine`, `BrowserLaunchPlan.headless`, and Python browser configuration

- [ ] **Step 1: Write the failing unit tests**

```ts
assert.deepEqual(getBrowserWindowLaunchArgs('chromium', false), ['--start-maximized'])
assert.deepEqual(getBrowserWindowLaunchArgs('chromium', true), [])
assert.deepEqual(getBrowserWindowLaunchArgs('firefox', false), [])
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --experimental-strip-types --test src/main/services/browser-window-launch.test.mjs`

Expected: FAIL because `browser-window-launch.ts` does not exist.

- [ ] **Step 3: Implement the pure argument helper**

```ts
export function getBrowserWindowLaunchArgs(
  engine: 'chromium' | 'firefox',
  headless: boolean
): string[] {
  return engine === 'chromium' && !headless ? ['--start-maximized'] : []
}
```

- [ ] **Step 4: Connect both runtime launch paths**

In `browser-path.ts`, pass the helper result as Playwright `args` and include it in `PythonBrowserLaunchConfig`. In `browser.py`, copy a validated list from the serialized configuration into `launch_kwargs['args']`.

- [ ] **Step 5: Register and run unit tests**

Run: `npm run test:unit`

Expected: all unit tests pass, including the three browser window cases.

- [ ] **Step 6: Run production build**

Run: `npm run build`

Expected: Electron Vite build completes without TypeScript or bundling errors.
