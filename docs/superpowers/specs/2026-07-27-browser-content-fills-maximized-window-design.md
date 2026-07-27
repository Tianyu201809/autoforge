# 浏览器内容铺满最大化窗口设计

## 目标

脚本启动有界面 Chromium 系浏览器时，浏览器外窗默认最大化，页面内容区域随窗口实际尺寸铺满，不再出现固定 viewport 导致的右侧或底部空白。

## 根因

`--start-maximized` 只作用于浏览器启动阶段。脚本随后调用 Playwright `browser.newPage()` / `browser.newContext()`（Python 为 `new_page()` / `new_context()`）且未指定 viewport 时，Playwright 自动创建 `1280×720` 模拟 viewport，并据此重新调整外窗尺寸，覆盖启动阶段的最大化效果。

## 方案

- 保留现有有界面 Chromium 启动参数 `--start-maximized`。
- JavaScript browser SDK 包装 `newContext()`；未提供 viewport 或设备模拟参数时，默认补入 `viewport: null`。`newPage()` 内部复用 `newContext()`，因此自动获得相同行为。
- Python browser SDK 包装 `new_context()` 与 `new_page()`；未提供 viewport 或设备模拟参数时，默认补入 `viewport=None`。
- 无头模式保持 Playwright 默认 viewport。
- 脚本明确设置 viewport、screen、isMobile/deviceScaleFactor（Python 为 `is_mobile` / `device_scale_factor`）时保持原值，不注入窗口 viewport。

## 兼容性

不修改脚本公开 API、manifest 或浏览器回退顺序。已有未指定 viewport 的有界面浏览器脚本自动获得最大化内容区域；依赖固定尺寸或设备模拟的脚本保持原行为。

## 测试

- JavaScript：默认有界面 context 注入 `viewport: null`；无头和显式 viewport/设备模拟不注入；`newPage()` 复用包装后的 `newContext()`。
- Python：`new_context()` 与 `new_page()` 覆盖默认、无头、显式 viewport 和设备模拟分支。
- 运行针对性测试、Python 语法检查、ESLint 和生产构建。
