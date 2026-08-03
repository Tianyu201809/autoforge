# 脚本主动关闭浏览器后保留运行结果 — 设计规格

**日期**：2026-08-03
**状态**：已批准
**决策**：区分脚本主动关闭与外部关闭，保留现有“外部关闭即停止脚本”行为

---

## 1. 背景与根因

浏览器脚本通常在 `finally` 中调用 `await browser.close()`，随后由 `run(ctx)` 返回业务结果。当前 JavaScript SDK 监听 Playwright `disconnected` 事件，并将所有断开都交给 `ScriptRunnerService.stop()`。因此脚本主动关闭浏览器也可能抢先把 session 标记为 `stopped`，后续返回值无法进入 `completeSession()`。

生产执行历史已验证该路径：受影响运行被记录为 `stopped` 且 `result` 为空，而不是成功 session 的结果被 UI 隐藏。

## 2. 目标

- 脚本显式调用 `browser.close()` 后，允许 `run(ctx)` 正常返回并保存 `session.result`。
- 用户直接关闭浏览器窗口或浏览器意外退出时，仍自动停止正在运行的脚本。
- JavaScript 与 Python 浏览器 SDK 使用相同的关闭语义。
- 不改变运行结果 UI、脚本返回值格式或执行历史结构。

## 3. 方案比较

### 方案 A：识别脚本主动关闭（采用）

在 SDK 返回浏览器对象前包装其 `close()` 方法。调用包装方法时先标记为“主动关闭”，随后执行 Playwright 原始 `close()`；`disconnected` 监听器仅对未标记的断开触发停止。

优点是语义明确、无等待时间且保留外部关闭检测。代价是 JS 与 Python SDK 都需要一层轻量包装。

### 方案 B：断开后延迟停止

断开后等待固定时间，若 session 尚未成功才停止。改动较小，但依赖时序，较慢的 `finally` 或事件循环负载仍可能造成误判。

### 方案 C：取消断开自动停止

完全移除断开监听。能避免误判，但会恢复浏览器关闭后脚本继续运行或悬挂的问题，不采用。

## 4. 设计

### 4.1 JavaScript

`browser-lifecycle.ts` 负责包装 Playwright Browser：

1. 保存原始 `browser.close` 并保持正确的 `this` 绑定。
2. 包装后的 `close()` 在调用原方法前记录主动关闭状态。
3. `disconnected` 事件延迟执行现有回调，但执行前检查主动关闭状态。
4. 外部关闭没有主动关闭标记，继续调用 runner 的停止回调。

`script-sdk.ts` 继续只负责接线，不在 runner 中增加延迟或特殊状态。

### 4.2 Python

`BrowserSdk` 在 launch 后以相同方式包装返回 Browser 的 `close()`。显式关闭不设置 `disconnected`；外部断开仍设置该状态，由 `_await_with_abort()` 取消仍在运行的用户协程。

运行时清理调用同一个包装后的 `close()`，因此正常清理不会误触发取消。

### 4.3 数据流

脚本主动关闭时：

`browser.close()` → 标记主动关闭 → 忽略对应断开 → `run(ctx)` 返回 → `completeSession(result)` → session 成功 → UI 展示结果。

外部关闭时：

浏览器断开 → 无主动关闭标记 → 停止运行 → session 记录为 `stopped`。

## 5. 错误与边界处理

- 原始 `close()` 抛错时仍视为脚本发起的关闭，不把同一次断开误判为外部关闭；原错误继续返回给脚本处理。
- 多次调用 `close()` 不重复触发停止回调。
- runner 主动取消时关闭浏览器属于平台清理，session 已进入停止流程，不产生二次状态变更。
- 脚本关闭浏览器后继续进行非浏览器计算并返回结果是合法行为。

## 6. 测试

- JavaScript：显式 `close()` 产生 `disconnected` 时不通知停止。
- JavaScript：外部 `disconnected` 仍只通知停止一次。
- JavaScript：主动关闭后返回对象的运行路径能够进入完成逻辑。
- Python：显式关闭不设置 `disconnected`。
- Python：外部关闭仍设置 `disconnected` 并取消未完成协程。
- 运行现有单元测试、类型检查/构建，确认浏览器窗口尺寸和取消逻辑无回归。

## 7. 非目标

- 不修改用户脚本或已有执行历史。
- 不恢复已被记录为 `stopped` 的历史返回值，因为该结果从未写入数据库。
- 不改变无浏览器脚本的执行路径。
