# 主题化导出确认框 Implementation Plan

**Goal:** 用 Autoforge 主题确认框替换 ZIP 导出前的 Electron 原生提示，同时保留系统保存选择器。

**Spec:** `docs/superpowers/specs/2026-07-15-themed-export-confirm-design.md`

## Task 1: 导出预览契约

- 增加预览结果类型和 `SCRIPTS_EXPORT_PREVIEW` IPC。
- 主进程计算文件数量、大小与安全提示，不产生文件。

## Task 2: 主题确认交互

- `SCRIPTS_EXPORT_ZIP` 移除原生 `showMessageBox`。
- 脚本卡片调用 preview，再使用现有 `askConfirm`。
- 确认后打开系统保存选择器；取消静默结束。

## Task 3: 验证

- 构建、相关文件 ESLint 和补丁检查。
