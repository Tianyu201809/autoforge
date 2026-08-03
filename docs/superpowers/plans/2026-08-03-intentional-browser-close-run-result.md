# Intentional Browser Close Run Result Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve script return values when JavaScript or Python scripts explicitly close their Playwright browser while retaining automatic stop for unexpected browser disconnects.

**Architecture:** Classify every Playwright browser disconnect as `intentional` or `unexpected` at the SDK boundary. The runner keeps its existing stop callback, but JavaScript invokes it only for unexpected disconnects; Python exposes only unexpected disconnects to `_await_with_abort()`.

**Tech Stack:** TypeScript, Node.js test runner, Playwright Core, Python 3 `unittest`, Electron.

## Global Constraints

- Do not change the run-result UI, return-value format, or execution-history schema.
- Preserve automatic script stopping when the browser is closed externally or exits unexpectedly.
- Treat a script call to `browser.close()` as normal execution, including when non-browser work follows it.
- Keep JavaScript and Python close semantics aligned.
- Do not modify user scripts or historical records.
- Do not create commits unless the user explicitly requests them.

---

### Task 1: Classify JavaScript Browser Disconnects

**Files:**
- Modify: `src/main/services/browser-lifecycle.ts`
- Modify: `src/main/services/browser-lifecycle.test.mjs`
- Modify: `src/main/services/script-sdk.ts`

**Interfaces:**
- Consumes: Playwright-compatible browser methods `once('disconnected', listener)` and `close(options?)`.
- Produces: `BrowserDisconnectKind = 'intentional' | 'unexpected'` and `attachBrowserDisconnectHandler(browser, onDisconnected, schedule?)` whose callback receives that kind.

- [ ] **Step 1: Write failing lifecycle tests**

Replace the existing test cases with coverage for both close sources:

```javascript
it('classifies a script-requested close as intentional', async () => {
  const browser = new EventEmitter()
  const scheduled = []
  const kinds = []
  browser.close = async () => browser.emit('disconnected')

  attachBrowserDisconnectHandler(browser, (kind) => kinds.push(kind), (callback) => scheduled.push(callback))

  await browser.close()
  scheduled[0]()
  assert.deepEqual(kinds, ['intentional'])
})

it('classifies an external disconnect as unexpected', () => {
  const browser = new EventEmitter()
  const scheduled = []
  const kinds = []
  browser.close = async () => undefined

  attachBrowserDisconnectHandler(browser, (kind) => kinds.push(kind), (callback) => scheduled.push(callback))

  browser.emit('disconnected')
  scheduled[0]()
  assert.deepEqual(kinds, ['unexpected'])
})
```

Retain the existing assertion that repeated `disconnected` events schedule only one callback.

- [ ] **Step 2: Run the JavaScript lifecycle test and verify failure**

Run:

```powershell
node --import tsx --test src/main/services/browser-lifecycle.test.mjs
```

Expected: FAIL because the current callback receives no disconnect kind and `browser.close()` is not wrapped.

- [ ] **Step 3: Implement close-source classification**

Update `browser-lifecycle.ts` to wrap the browser's public `close()` method while preserving arguments and `this` binding:

```typescript
export type BrowserDisconnectKind = 'intentional' | 'unexpected'

export interface BrowserDisconnectEmitter {
  once(event: 'disconnected', listener: () => void): unknown
  close(options?: { reason?: string }): Promise<void>
}

export function attachBrowserDisconnectHandler(
  browser: BrowserDisconnectEmitter,
  onDisconnected: (kind: BrowserDisconnectKind) => void,
  schedule: (callback: () => void) => void = setImmediate
): void {
  let intentionalClose = false
  const originalClose = browser.close.bind(browser)
  browser.close = async (options) => {
    intentionalClose = true
    await originalClose(options)
  }
  browser.once('disconnected', () => {
    schedule(() => onDisconnected(intentionalClose ? 'intentional' : 'unexpected'))
  })
}
```

- [ ] **Step 4: Stop the runner only for unexpected disconnects**

Update the `script-sdk.ts` callback so both kinds clear `browserRef`, but only unexpected disconnects invoke the runner stop callback:

```typescript
attachBrowserDisconnectHandler(browser, (kind) => {
  browserRef = null
  if (kind === 'unexpected') onBrowserDisconnected()
})
```

- [ ] **Step 5: Run focused JavaScript tests**

Run:

```powershell
node --import tsx --test src/main/services/browser-lifecycle.test.mjs src/main/services/browser-context-defaults.test.mjs src/main/services/browser-window-launch.test.mjs
```

Expected: all tests PASS; intentional close reports `intentional`, external close reports `unexpected`, and window defaults remain unchanged.

---

### Task 2: Align Python Browser Close Semantics

**Files:**
- Modify: `resources/python/autoforge_runtime/browser.py`
- Modify: `resources/python/tests/test_browser_disconnect.py`

**Interfaces:**
- Consumes: Playwright Python Browser methods `on('disconnected', callback)` and async `close()`.
- Produces: `BrowserSdk._attach_browser_lifecycle(browser)`; `BrowserSdk.disconnected` becomes true only for unexpected disconnects.

- [ ] **Step 1: Write failing Python lifecycle tests**

Add a minimal fake browser and two tests:

```python
class FakeBrowser:
    def __init__(self) -> None:
        self.listeners = {}

    def on(self, event, callback) -> None:
        self.listeners[event] = callback

    async def close(self) -> None:
        self.listeners["disconnected"](self)

    def disconnect_externally(self) -> None:
        self.listeners["disconnected"](self)


class BrowserDisconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_close_is_not_recorded_as_disconnect(self) -> None:
        browser_sdk = BrowserSdk({}, FakeSignal())
        browser = FakeBrowser()
        browser_sdk._attach_browser_lifecycle(browser)

        await browser.close()

        self.assertFalse(browser_sdk.disconnected)

    async def test_external_close_is_recorded_as_disconnect(self) -> None:
        browser_sdk = BrowserSdk({}, FakeSignal())
        browser = FakeBrowser()
        browser_sdk._attach_browser_lifecycle(browser)

        browser.disconnect_externally()

        self.assertTrue(browser_sdk.disconnected)
```

- [ ] **Step 2: Run the Python lifecycle test and verify failure**

Run:

```powershell
py -3 -m unittest discover -s resources/python/tests -p test_browser_disconnect.py -v
```

Expected: ERROR because `_attach_browser_lifecycle` does not exist.

- [ ] **Step 3: Implement Python close-source classification**

Add `_intentional_close` state and a focused lifecycle wrapper to `BrowserSdk`:

```python
def _attach_browser_lifecycle(self, browser: Any) -> None:
    self._browser = browser
    self._intentional_close = False
    original_close = browser.close

    async def close(*args, **kwargs):
        self._intentional_close = True
        try:
            return await original_close(*args, **kwargs)
        finally:
            if self._browser is browser:
                self._browser = None

    browser.close = close
    browser.on("disconnected", self._handle_disconnected)

def _handle_disconnected(self, _browser: Any = None) -> None:
    if not self._intentional_close:
        self._disconnected = True
```

Initialize `_intentional_close = False` in `__init__`, replace the launch-time direct assignment/listener with `_attach_browser_lifecycle(browser)`, and keep `BrowserSdk.close()` using the wrapped browser method.

- [ ] **Step 4: Run focused Python tests**

Run:

```powershell
py -3 -m unittest discover -s resources/python/tests -p "test_browser_*.py" -v
```

Expected: all browser lifecycle and viewport tests PASS, including external disconnect cancellation and intentional close preservation.

---

### Task 3: Verify the Complete Regression Surface

**Files:**
- Verify: `src/main/services/script-runner.ts`
- Verify: `src/renderer/src/components/DetailPanel.vue`
- Verify: `docs/superpowers/specs/2026-08-03-intentional-browser-close-run-result-design.md`

**Interfaces:**
- Consumes: lifecycle behavior implemented by Tasks 1 and 2.
- Produces: a buildable application where explicit browser close reaches `completeSession(result)` and the existing detail panel displays the returned object.

- [ ] **Step 1: Run the project unit suite**

Run:

```powershell
npm run test:unit
```

Expected: all configured Node unit tests PASS.

- [ ] **Step 2: Run production build validation**

Run:

```powershell
npm run build
```

Expected: Electron Vite main, preload, and renderer builds complete without TypeScript or bundling errors.

- [ ] **Step 3: Inspect the final diff**

Run:

```powershell
git diff --check
git status --short
git diff -- src/main/services/browser-lifecycle.ts src/main/services/browser-lifecycle.test.mjs src/main/services/script-sdk.ts resources/python/autoforge_runtime/browser.py resources/python/tests/test_browser_disconnect.py
```

Expected: no whitespace errors; only the approved lifecycle, test, specification, and plan files are changed.
