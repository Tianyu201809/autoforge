# 浏览器断开自动停止脚本设计

## 目标

脚本启动的 Playwright 浏览器被用户关闭后，如果脚本仍在运行，Autoforge 自动将对应 session 标记为“已停止”，客户端不再持续显示“运行中”。

## 根因

当前生命周期只有“停止脚本时关闭浏览器”的单向联动。JavaScript 和 Python browser SDK 均未将 Playwright `disconnected` 事件反馈给脚本执行器，因此仍在等待的脚本不会结束，主进程 session 也一直保持 `running`。

## 方案

### JavaScript

- browser SDK 在启动成功后监听浏览器 `disconnected` 事件。
- 断开事件延迟到下一事件循环通知 `ScriptRunnerService`。
- 通知到达时 session 若仍为 `running`，复用现有 `stop()` 流程标记为 `stopped`、记录结束时间并广播客户端状态。
- 脚本在 `finally` 中关闭浏览器并立即正常返回时，正常完成逻辑先于延迟通知执行，结果保持 `success`。

### Python

- Python browser SDK 监听浏览器 `disconnected` 事件并记录浏览器已断开。
- runtime 等待用户协程期间检测该状态；若协程仍未完成，则设置取消信号并取消协程。
- runtime 使用现有取消退出码 `130` 结束进程。
- 主进程将退出码 `130` 映射为 `aborted`，复用现有 `stop()` 流程。
- 用户协程在关闭浏览器后已经完成时，保留正常返回结果，不改为停止。

## 状态与日志

浏览器断开触发的终态为 `stopped`，不是 `success` 或 `error`。沿用现有 session 广播与执行历史记录，不增加新的公开状态或 SDK API。

## 测试

- JavaScript：浏览器断开会通知执行器；主动停止导致的浏览器关闭不会重复改变终态；正常关闭后立即返回仍可成功。
- Python：浏览器断开会取消仍在运行的用户协程；退出码 `130` 被主进程识别为已取消。
- 运行针对性测试、Python 语法检查、ESLint 和生产构建。
