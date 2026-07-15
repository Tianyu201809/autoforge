# Electron 打包图标

## 目标

Windows 打包产物及其安装器使用 `src/renderer/src/assets/logo-mark.png` 作为唯一源图，不对其进行圆形裁切、透明遮罩或额外填充。

## 方案

- `scripts/generate-icons.mjs` 直接读取 `logo-mark.png`。
- 脚本以高质量缩放仅生成打包所需的 `build/icon.png` 与 `build/icon.ico`。
- 保留现有托盘图标和悬浮窗图标，不在图标生成流程中改写它们。
- 保留 `package.json` 中现有的 `electron-builder` 图标引用：Windows 应用、安装器、卸载器均继续使用生成的 `build/icon.ico`。

## 约束与错误处理

- 保留现有 ICO 多尺寸输出，确保 Windows 在不同显示尺寸下选择合适图标。
- 如果源图无法读取，`generate:icons` 失败并阻止后续打包。
- 不改动产品名称、安装器配置或其他平台打包目标。

## 验证

- 执行 `npm run generate:icons`。
- 检查生成 PNG 的尺寸，以及 ICO 包含的预期尺寸条目。
- 确认生成流程未再创建圆形透明遮罩，源图内容按原样缩放保留。
