from __future__ import annotations

import sys
import unittest
from pathlib import Path

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT))

from autoforge_runtime.browser import (
    _apply_browser_context_defaults,
    _with_browser_context_defaults,
)


class FakeBrowser:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def new_context(self, **kwargs):
        self.calls.append(("context", kwargs))
        return kwargs

    async def new_page(self, **kwargs):
        self.calls.append(("page", kwargs))
        return kwargs


class BrowserViewportTests(unittest.IsolatedAsyncioTestCase):
    def test_headed_browser_uses_actual_window_viewport(self) -> None:
        self.assertEqual(_with_browser_context_defaults({}, False), {"viewport": None})

    def test_headless_browser_keeps_playwright_defaults(self) -> None:
        self.assertEqual(_with_browser_context_defaults({}, True), {})

    def test_explicit_viewport_and_device_options_are_preserved(self) -> None:
        cases = [
            {"viewport": {"width": 800, "height": 600}},
            {"screen": {"width": 1920, "height": 1080}},
            {"is_mobile": True},
            {"device_scale_factor": 2},
        ]

        for options in cases:
            with self.subTest(options=options):
                self.assertEqual(_with_browser_context_defaults(options, False), options)

    async def test_wraps_new_context_and_new_page(self) -> None:
        browser = FakeBrowser()
        _apply_browser_context_defaults(browser, False)

        await browser.new_context()
        await browser.new_page()

        self.assertEqual(
            browser.calls,
            [
                ("context", {"viewport": None}),
                ("page", {"viewport": None}),
            ],
        )


if __name__ == "__main__":
    unittest.main()
