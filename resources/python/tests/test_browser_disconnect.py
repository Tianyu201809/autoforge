from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT))

from autoforge_runtime.bootstrap import _await_with_abort
from autoforge_runtime.browser import BrowserSdk


class FakeSignal:
    def __init__(self) -> None:
        self.aborted = False

    def _set_aborted(self) -> None:
        self.aborted = True


class FakeBrowser:
    def __init__(self) -> None:
        self.listeners = {}

    def on(self, event, callback) -> None:
        self.listeners[event] = callback

    async def close(self) -> None:
        self.listeners["disconnected"](self)

    def disconnect_externally(self) -> None:
        self.listeners["disconnected"](self)


def make_context(*, disconnected: bool):
    signal = FakeSignal()
    browser = SimpleNamespace(disconnected=disconnected)
    return SimpleNamespace(signal=signal, sdk=SimpleNamespace(browser=browser))


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

    async def test_disconnect_cancels_running_coroutine(self) -> None:
        ctx = make_context(disconnected=True)
        cancelled = False

        async def run_forever():
            nonlocal cancelled
            try:
                await asyncio.Event().wait()
            finally:
                cancelled = True

        result = await asyncio.wait_for(_await_with_abort(ctx, run_forever()), timeout=0.5)

        self.assertIsNone(result)
        self.assertTrue(ctx.signal.aborted)
        self.assertTrue(cancelled)

    async def test_successful_completion_wins_disconnect_race(self) -> None:
        ctx = make_context(disconnected=True)

        async def finish_now():
            return {"ok": True}

        result = await _await_with_abort(ctx, finish_now())

        self.assertEqual(result, {"ok": True})
        self.assertFalse(ctx.signal.aborted)

    async def test_disconnect_suppresses_browser_close_error(self) -> None:
        ctx = make_context(disconnected=True)

        async def fail_after_close():
            raise RuntimeError("browser closed")

        result = await _await_with_abort(ctx, fail_after_close())

        self.assertIsNone(result)
        self.assertTrue(ctx.signal.aborted)

    async def test_browser_sdk_records_disconnect(self) -> None:
        signal = FakeSignal()
        browser_sdk = BrowserSdk({}, signal)

        browser_sdk._handle_disconnected()

        self.assertTrue(browser_sdk.disconnected)


if __name__ == "__main__":
    unittest.main()
