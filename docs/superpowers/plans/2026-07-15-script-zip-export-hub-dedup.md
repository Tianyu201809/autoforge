# 脚本 ZIP 导出与 Hub 去重安装 Implementation Plan

**Goal:** 安全导出仅含必要代码的 Hub ZIP，并按稳定 `hubScriptId` 阻止重复导入、支持用户确认更新。

**Architecture:** 新增纯主进程脚本包导出器负责白名单与 ZIP；数据库持久化 Hub ID；注册表负责保留偏好的工作区更新；Hub 安装器负责重复确认和结果状态；IPC 与脚本卡片只承载交互。

**Spec:** `docs/superpowers/specs/2026-07-15-script-zip-export-hub-dedup-design.md`

## Task 1: Hub 身份持久化

- 增加数据库迁移、行映射、仓储查询和 `ScriptMeta.hubScriptId`。
- 为非空 Hub ID 建立唯一索引。
- 扩展注册表首次导入参数与按 Hub ID 查询。

## Task 2: 安全 ZIP 导出服务

- 增加 manifest `export.include` 类型与校验。
- 从入口递归解析 JS/TS 与 Python 本地静态依赖。
- 实施路径安全、强制排除与受限 glob。
- 使用 `adm-zip` 生成根目录包结构。

## Task 3: 导出 IPC 与 UI

- 增加导出 IPC、preload 类型和保存对话框。
- 脚本卡片菜单增加“导出 ZIP”。
- 在应用层显示成功、取消与失败反馈。

## Task 4: Hub 重复更新

- Hub 安装强制接收稳定 ID并查询重复。
- 重复时显示原生更新/取消确认框。
- 注册表原子替换代码并保留本地偏好和脚本 ID。
- 桥返回 `installed`、`updated`、`duplicate_cancelled`。

## Task 5: 验证与文档

- 增加导出文件发现与排除的聚焦测试。
- 验证构建和 lint，不修复无关问题。
- 更新脚本规范、架构与 changelog。
