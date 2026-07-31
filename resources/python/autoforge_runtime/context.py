from __future__ import annotations

from pathlib import Path

from autoforge_runtime.browser import BrowserSdk
from autoforge_runtime.protocol import emit_control, emit_log


class AbortSignal:
    def __init__(self) -> None:
        self._aborted = False

    @property
    def aborted(self) -> bool:
        return self._aborted

    def _set_aborted(self) -> None:
        self._aborted = True


class ScriptPaths:
    def __init__(self, user_data: str, script_dir: str) -> None:
        self.user_data = Path(user_data)
        self.script_dir = Path(script_dir)


class ScriptSdk:
    def __init__(self, paths: ScriptPaths, browser_config: dict, signal: AbortSignal) -> None:
        self.browser = BrowserSdk(browser_config, signal)
        self.paths = paths


class ScriptContext:
    def __init__(self, payload: dict) -> None:
        self.session_id = str(payload.get("sessionId", ""))
        self.script_id = str(payload.get("scriptId", ""))
        self.env: dict[str, str] = {str(k): str(v) for k, v in (payload.get("env") or {}).items()}
        self.params: dict[str, str] = {str(k): str(v) for k, v in (payload.get("params") or {}).items()}
        self.input = payload.get("input")
        self.signal = AbortSignal()
        paths = payload.get("paths") or {}
        browser = payload.get("browser") or {}
        self.sdk = ScriptSdk(
            ScriptPaths(
                str(paths.get("userData", "")),
                str(paths.get("scriptDir", "")),
            ),
            browser if isinstance(browser, dict) else {},
            self.signal,
        )

    def log(self, level: str, message: str) -> None:
        normalized = level if level in ("INFO", "WARN", "ERROR") else "INFO"
        emit_log(normalized, str(message))

    def stage(self, *, name: str, label: str | None = None, message: str | None = None) -> None:
        payload: dict = {"kind": "stage", "name": name}
        if label:
            payload["label"] = label
        if message:
            payload["message"] = message
        emit_control(payload)

    def progress(
        self,
        *,
        scope: str,
        current: int,
        total: int | None = None,
        label: str | None = None,
        message: str | None = None,
        unit: str | None = None,
    ) -> None:
        payload: dict = {"kind": "progress", "scope": scope, "current": current}
        if total is not None:
            payload["total"] = total
        if label:
            payload["label"] = label
        if message:
            payload["message"] = message
        if unit:
            payload["unit"] = unit
        emit_control(payload)
