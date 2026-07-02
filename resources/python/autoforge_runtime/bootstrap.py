from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import signal
import sys
import traceback

from autoforge_runtime.context import ScriptContext
from autoforge_runtime.protocol import _ensure_utf8_stdio, emit_error, emit_result


def load_module_from_path(entry_path: str):
    spec = importlib.util.spec_from_file_location("autoforge_user_script", entry_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载入口: {entry_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _handle_stop(ctx: ScriptContext, *_args) -> None:
    ctx.signal._set_aborted()


async def _await_with_abort(ctx: ScriptContext, coro):
    task = asyncio.create_task(coro)
    while not task.done():
        if ctx.signal.aborted:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            return None
        await asyncio.sleep(0.15)
    return await task


async def _run_user_script(ctx: ScriptContext, entry_path: str):
    module = load_module_from_path(entry_path)
    run_fn = getattr(module, "run", None)
    if not callable(run_fn):
        emit_error("脚本必须定义 run(ctx) 函数")
        sys.exit(1)

    result = run_fn(ctx)
    if asyncio.iscoroutine(result):
        result = await _await_with_abort(ctx, result)
    elif ctx.signal.aborted:
        return None
    return result


async def _main_async(ctx: ScriptContext, entry_path: str):
    try:
        result = await _run_user_script(ctx, entry_path)
        if ctx.signal.aborted:
            return None
        return result
    finally:
        await ctx.sdk.browser.close()


def main() -> None:
    _ensure_utf8_stdio()
    entry_path = os.environ.get("AUTOFORGE_ENTRY_PATH")
    ctx_json = os.environ.get("AUTOFORGE_CTX_JSON")
    if not entry_path or not ctx_json:
        emit_error("缺少 AUTOFORGE_ENTRY_PATH 或 AUTOFORGE_CTX_JSON")
        sys.exit(1)

    try:
        payload = json.loads(ctx_json)
    except json.JSONDecodeError as exc:
        emit_error(f"无效的 AUTOFORGE_CTX_JSON: {exc}")
        sys.exit(1)

    ctx = ScriptContext(payload)

    signal.signal(signal.SIGTERM, lambda *args: _handle_stop(ctx, *args))
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, lambda *args: _handle_stop(ctx, *args))

    try:
        result = asyncio.run(_main_async(ctx, entry_path))
        if ctx.signal.aborted:
            sys.exit(130)
        emit_result(result)
    except SystemExit:
        raise
    except Exception as exc:
        emit_error(str(exc))
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
