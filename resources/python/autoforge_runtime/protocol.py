import json
import io
import sys

LOG_PREFIX = "@autoforge/log "
CTL_PREFIX = "@autoforge/ctl "
RESULT_PREFIX = "@autoforge/result "
ERROR_PREFIX = "@autoforge/error "


def _ensure_utf8_stdio() -> None:
    """Windows 下强制 stdout/stderr 使用 UTF-8，避免中文控制消息乱码。"""
    if sys.platform != "win32":
        return
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
    if hasattr(sys.stderr, "buffer"):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", line_buffering=True)


def emit_log(level: str, message: str) -> None:
    print(LOG_PREFIX + json.dumps({"level": level, "message": message}, ensure_ascii=False), flush=True)


def emit_control(payload: dict) -> None:
    print(CTL_PREFIX + json.dumps(payload, ensure_ascii=False), flush=True)


def emit_result(value) -> None:
    print(RESULT_PREFIX + json.dumps({"value": value}, ensure_ascii=False), flush=True)


def emit_error(message: str) -> None:
    print(ERROR_PREFIX + json.dumps({"message": message}, ensure_ascii=False), flush=True)
