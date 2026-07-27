# Browser Content Fills Maximized Window Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep headed script browsers maximized and make their page content use the actual window viewport by default.

**Architecture:** Wrap Playwright browser context/page creation at the Autoforge SDK boundary. Inject a null viewport only for headed sessions without explicit viewport or device-emulation options; leave headless and explicit emulation unchanged.

**Tech Stack:** TypeScript, Node.js test runner, Playwright Core, Python asyncio, unittest

## Global Constraints

- Preserve the existing `--start-maximized` Chromium launch argument.
- Inject window-sized viewport defaults only for headed sessions.
- Preserve explicit viewport, screen, mobile, and device-scale options.
- Keep public script SDK methods and browser fallback order unchanged.

---

### Task 1: JavaScript context defaults

**Files:**
- Create: `src/main/services/browser-context-defaults.ts`
- Create: `src/main/services/browser-context-defaults.test.mjs`
- Modify: `src/main/services/script-sdk.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `withBrowserContextDefaults(options, headless): BrowserContextOptions`
- Produces: `applyBrowserContextDefaults(browser, headless): void`
- Consumes: Playwright `Browser.newContext()`; `Browser.newPage()` dynamically reuses the wrapped method.

- [ ] **Step 1: Write failing default-option tests**

```js
assert.deepEqual(withBrowserContextDefaults(undefined, false), { viewport: null })
assert.deepEqual(withBrowserContextDefaults(undefined, true), {})
assert.deepEqual(withBrowserContextDefaults({ viewport: { width: 800, height: 600 } }, false), {
  viewport: { width: 800, height: 600 }
})
```

- [ ] **Step 2: Verify tests fail before implementation**

Run: `node --experimental-strip-types --test src/main/services/browser-context-defaults.test.mjs`

Expected: FAIL because `browser-context-defaults.ts` does not exist.

- [ ] **Step 3: Implement and apply JavaScript defaults**

```ts
export function withBrowserContextDefaults(options, headless) {
  const resolved = { ...options }
  if (!headless && !usesViewportEmulation(resolved)) resolved.viewport = null
  return resolved
}
```

Wrap the browser instance's `newContext` method immediately after launch and before returning it from `createScriptSdk`.

- [ ] **Step 4: Run JavaScript tests**

Run: `node --experimental-strip-types --test src/main/services/browser-context-defaults.test.mjs`

Expected: PASS for default, headless, explicit viewport, screen, mobile, device scale, and wrapper forwarding cases.

### Task 2: Python context and page defaults

**Files:**
- Create: `resources/python/tests/test_browser_viewport.py`
- Modify: `resources/python/autoforge_runtime/browser.py`

**Interfaces:**
- Produces: `_with_browser_context_defaults(kwargs, headless)`
- Produces: `_apply_browser_context_defaults(browser, headless)` wrapping both `new_context()` and `new_page()`.

- [ ] **Step 1: Write failing Python tests**

```python
self.assertEqual(_with_browser_context_defaults({}, False), {"viewport": None})
self.assertEqual(_with_browser_context_defaults({}, True), {})
self.assertEqual(
    _with_browser_context_defaults({"viewport": {"width": 800, "height": 600}}, False),
    {"viewport": {"width": 800, "height": 600}},
)
```

- [ ] **Step 2: Verify Python tests fail**

Run: `py -3 -m unittest discover -s resources/python/tests -p "test_browser_viewport.py"`

Expected: FAIL because viewport-default helpers do not exist.

- [ ] **Step 3: Implement and apply Python defaults**

Wrap both async `new_context(**kwargs)` and `new_page(**kwargs)` methods after Playwright launches the browser and before returning it.

- [ ] **Step 4: Run focused and production validation**

Run: `node --experimental-strip-types --test src/main/services/browser-context-defaults.test.mjs`

Run: `py -3 -m unittest discover -s resources/python/tests -p "test_*.py"`

Run: `npm run build`

Expected: all focused tests and production build pass.
