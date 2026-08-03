from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from autoforge_runtime.context import AbortSignal


_VIEWPORT_EMULATION_KEYS = (
    "viewport",
    "screen",
    "is_mobile",
    "device_scale_factor",
)


def _with_browser_context_defaults(options: dict[str, Any], headless: bool) -> dict[str, Any]:
    resolved = dict(options)
    uses_viewport_emulation = any(
        resolved.get(key) is not None for key in _VIEWPORT_EMULATION_KEYS
    )
    if not headless and not uses_viewport_emulation:
        resolved["viewport"] = None
    return resolved


def _apply_browser_context_defaults(browser: Any, headless: bool) -> None:
    original_new_context = browser.new_context
    original_new_page = browser.new_page

    async def new_context(**kwargs):
        return await original_new_context(**_with_browser_context_defaults(kwargs, headless))

    async def new_page(**kwargs):
        return await original_new_page(**_with_browser_context_defaults(kwargs, headless))

    browser.new_context = new_context
    browser.new_page = new_page


class BrowserSdk:
    def __init__(self, browser_config: dict, signal: AbortSignal) -> None:
        self._config = browser_config or {}
        self._signal = signal
        self._playwright: Any = None
        self._browser: Any = None
        self._disconnected = False
        self._intentional_close = False

    @property
    def disconnected(self) -> bool:
        return self._disconnected

    def _handle_disconnected(self, _browser: Any = None) -> None:
        if not self._intentional_close:
            self._disconnected = True

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

    async def launch(self):
        if self._signal.aborted:
            raise RuntimeError("脚本已取消")

        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise RuntimeError(
                '缺少 playwright 包，请在 autoforge.json dependencies 中添加 "playwright": ">=1.50.0"'
            ) from exc

        browsers_path = self._config.get("playwrightBrowsersPath")
        if browsers_path:
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_path)

        pw = await async_playwright().start()
        self._playwright = pw
        self._disconnected = False

        headless = bool(self._config.get("headless", False))
        engine = str(self._config.get("engine", "chromium"))
        launch_kwargs: dict[str, Any] = {"headless": headless}

        launch_args = self._config.get("args")
        if (
            isinstance(launch_args, list)
            and launch_args
            and all(isinstance(arg, str) for arg in launch_args)
        ):
            launch_kwargs["args"] = launch_args

        executable_path = self._config.get("executablePath")
        channel = self._config.get("channel")
        if executable_path:
            launch_kwargs["executable_path"] = str(executable_path)
        elif channel in ("chrome", "msedge"):
            launch_kwargs["channel"] = channel
        elif channel == "firefox":
            engine = "firefox"

        if self._signal.aborted:
            await self.close()
            raise RuntimeError("脚本已取消")

        if engine == "firefox":
            browser = await pw.firefox.launch(**launch_kwargs)
        else:
            browser = await pw.chromium.launch(**launch_kwargs)

        _apply_browser_context_defaults(browser, headless)
        self._attach_browser_lifecycle(browser)
        return browser

    async def close(self) -> None:
        if self._browser is not None:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None
