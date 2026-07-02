from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from autoforge_runtime.context import AbortSignal


class BrowserSdk:
    def __init__(self, browser_config: dict, signal: AbortSignal) -> None:
        self._config = browser_config or {}
        self._signal = signal
        self._playwright: Any = None
        self._browser: Any = None

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

        headless = bool(self._config.get("headless", False))
        engine = str(self._config.get("engine", "chromium"))
        launch_kwargs: dict[str, Any] = {"headless": headless}

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

        self._browser = browser
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
