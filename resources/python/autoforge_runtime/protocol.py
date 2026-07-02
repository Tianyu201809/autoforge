import json
import sys

LOG_PREFIX = "@autoforge/log "
CTL_PREFIX = "@autoforge/ctl "
RESULT_PREFIX = "@autoforge/result "
ERROR_PREFIX = "@autoforge/error "


def emit_log(level: str, message: str) -> None:
    print(LOG_PREFIX + json.dumps({"level": level, "message": message}, ensure_ascii=False), flush=True)


def emit_control(payload: dict) -> None:
    print(CTL_PREFIX + json.dumps(payload, ensure_ascii=False), flush=True)


def emit_result(value) -> None:
    print(RESULT_PREFIX + json.dumps({"value": value}, ensure_ascii=False), flush=True)


def emit_error(message: str) -> None:
    print(ERROR_PREFIX + json.dumps({"message": message}, ensure_ascii=False), flush=True)
