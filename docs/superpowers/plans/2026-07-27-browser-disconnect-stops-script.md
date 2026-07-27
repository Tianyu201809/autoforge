# Browser Disconnect Stops Script Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a running Autoforge session when its Playwright browser is closed while preserving successful final cleanup.

**Architecture:** JavaScript browser disconnects are deferred one event-loop turn and routed to the existing session `stop()` method. Python records the disconnect in its browser SDK, resolves the race against user-coroutine completion in the bootstrap loop, exits with cancellation code `130`, and maps that code to the existing aborted outcome.

**Tech Stack:** TypeScript, Node.js test runner, Playwright Core, Python asyncio, unittest

## Global Constraints

- A browser disconnect stops the session only while it is still running.
- A script that closes the browser in final cleanup and returns successfully remains successful.
- Browser-driven termination uses existing `stopped` state and execution-history behavior.
- JavaScript and Python behavior remain aligned without changing public SDK signatures exposed to scripts.

---

### Task 1: JavaScript browser disconnect lifecycle

**Files:**
- Create: `src/main/services/browser-lifecycle.ts`
- Create: `src/main/services/browser-lifecycle.test.mjs`
- Modify: `src/main/services/script-sdk.ts`
- Modify: `src/main/services/script-runner.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `attachBrowserDisconnectHandler(browser, onDisconnected, schedule?)`
- Produces: optional internal `onBrowserDisconnected` callback on `createScriptSdk(...)`
- Consumes: existing `ScriptRunnerService.stop(sessionId)`

- [ ] **Step 1: Write the failing lifecycle test**

```js
const scheduled = []
attachBrowserDisconnectHandler(browser, onDisconnected, (callback) => scheduled.push(callback))
browser.emit('disconnected')
assert.equal(calls, 0)
scheduled[0]()
assert.equal(calls, 1)
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --experimental-strip-types --test src/main/services/browser-lifecycle.test.mjs`

Expected: FAIL because `browser-lifecycle.ts` does not exist.

- [ ] **Step 3: Implement deferred disconnect notification**

```ts
export function attachBrowserDisconnectHandler(
  browser: BrowserDisconnectEmitter,
  onDisconnected: () => void,
  schedule: (callback: () => void) => void = setImmediate
): void {
  browser.once('disconnected', () => schedule(onDisconnected))
}
```

- [ ] **Step 4: Route the notification to session stop**

Pass `() => this.stop(session.id)` from `ScriptRunnerService` into `createScriptSdk`. On disconnect, clear the SDK browser reference and invoke the callback through the deferred helper.

- [ ] **Step 5: Run the focused test**

Run: `node --experimental-strip-types --test src/main/services/browser-lifecycle.test.mjs`

Expected: PASS.

### Task 2: Python disconnect cancellation

**Files:**
- Create: `resources/python/tests/test_browser_disconnect.py`
- Create: `src/main/services/python-process-exit.ts`
- Create: `src/main/services/python-process-exit.test.mjs`
- Modify: `resources/python/autoforge_runtime/browser.py`
- Modify: `resources/python/autoforge_runtime/bootstrap.py`
- Modify: `src/main/services/python-script-runner.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `BrowserSdk.disconnected: bool`
- Produces: `_await_with_abort(ctx, coro)` cancellation on browser disconnect
- Produces: `isPythonCancellationExitCode(code: number | null): boolean`

- [ ] **Step 1: Write failing Python and TypeScript tests**

```python
result = await _await_with_abort(disconnected_context, never_finishes())
self.assertIsNone(result)
self.assertTrue(disconnected_context.signal.aborted)
```

```js
assert.equal(isPythonCancellationExitCode(130), true)
assert.equal(isPythonCancellationExitCode(1), false)
```

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m unittest discover -s resources/python/tests -p "test_*.py"`

Run: `node --experimental-strip-types --test src/main/services/python-process-exit.test.mjs`

Expected: FAIL because disconnect handling and exit-code helper are absent.

- [ ] **Step 3: Record and consume browser disconnects**

Register `browser.on("disconnected", self._handle_disconnected)` after Python launch. In `_await_with_abort`, allow one event-loop turn for successful cleanup; otherwise set the abort signal, cancel or consume the task, and return `None`.

- [ ] **Step 4: Map Python cancellation exit code**

Handle code `130` as `{ ok: false, aborted: true }` before generic nonzero exit handling in `runPythonScript`.

- [ ] **Step 5: Run lifecycle tests and production validation**

Run: `node --experimental-strip-types --test src/main/services/browser-lifecycle.test.mjs src/main/services/python-process-exit.test.mjs`

Run: `python -m unittest discover -s resources/python/tests -p "test_*.py"`

Run: `npm run build`

Expected: all focused tests and production build pass.
