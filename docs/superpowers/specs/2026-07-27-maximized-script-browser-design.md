# 脚本浏览器最大化启动设计

## 目标

脚本通过 `ctx.sdk.browser.launch()` 启动有界面的 Chromium、Google Chrome 或 Microsoft Edge 时，浏览器窗口默认最大化，并保留标题栏和任务栏。

## 根因

JavaScript 与 Python 的 Playwright 启动链路当前只传递 `headless`、浏览器路径和 channel，没有传递窗口最大化参数，因此浏览器使用自身的默认窗口尺寸。

## 方案

- 有界面 Chromium 系浏览器启动时添加 `--start-maximized`。
- 无头模式不添加窗口参数。
- JavaScript 直接使用统一生成的 Playwright 启动参数。
- Python 启动配置传递相同参数，由 runtime 原样交给 Playwright。
- 不修改脚本创建 context/page 时主动指定的 viewport。
- Firefox 没有与目标语义等价且可靠的启动参数，保持现有行为。

## 兼容性

现有 SDK 方法、manifest 配置和浏览器回退顺序均保持不变。该修改只改变有界面 Chromium 系浏览器的初始窗口状态。

## 验证

- 单元测试覆盖有界面 Chromium 添加最大化参数。
- 单元测试覆盖无头 Chromium 和 Firefox 不添加参数。
- 构建验证 TypeScript 类型以及 Python 配置序列化链路。
