# 项目工作区操作优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** 为 AI 项目列表增加可持久化的重命名、置顶、双重确认删除和完整轮次 JSON 导出。

**Architecture:** 项目操作经 typed preload IPC 到主进程。项目 pinned 字段通过 SQLite migration 保存，仓库按 pinned 和更新时间排序。导出由主进程读取项目与轮次，使用 Electron 保存对话框写出 JSON。

**Tech Stack:** Electron IPC、Vue 3、TypeScript、SQLite/sql.js、Node.js 文件系统、node:test。

**Spec:** `docs/superpowers/specs/2026-11-23-project-operations-design.md`

## Global Constraints

- 保留项目列表单击打开行为。
- 项目根目录和文件内容不得被删除或导出。
- 删除时必须显示两次独立确认。
- 导出包括全部对话轮次的元数据与内容，使用 UTF-8 JSON。
- 所有持久化变更在主进程执行。

## Review Focus

- 未置顶旧记录在 migration 后按默认值正常显示。
- 删除被运行中的 Agent 拒绝时保留项目并显示原因。
- 用户取消重命名、导出对话框或任一删除确认时不产生写入。
- 长项目名、空对话、未完成轮次仍可安全显示或导出。

## Task 1：项目数据和主进程操作契约

**Files:**
- Create `src/main/db/migrations/008-ai-project-pinned.ts`
- Modify `src/main/db/database.ts`
- Modify `src/shared/ai-workspace-types.ts`
- Modify `src/main/db/repositories/ai-workspace-repository.ts`
- Modify `src/main/services/ai/agent-service.ts`
- Modify `src/main/ipc/ai-workspace-handlers.ts`
- Modify `src/preload/index.ts` and `src/renderer/src/env.d.ts`
- Modify `src/main/ipc/handlers.ts`
- Test repository, service, IPC, and export behavior.

- [x] Write failing tests for pin persistence and order, rename persistence, project-turn export data, and export callback cancellation.
- [x] Run focused tests and verify the expected missing-method or assertion failures.
- [x] Implement migration 008, repository methods, main-process export IPC and typed preload APIs.
- [x] Run focused tests for repository/service/IPC and inspect exported JSON shape.

## Task 2：工作区项目操作

**Files:**
- Modify `src/renderer/src/components/AiProjectWorkspace.vue`
- Modify `src/renderer/src/composables/useAiProjectWorkspace.ts`
- Modify `src/renderer/src/env.d.ts`
- Modify `src/renderer/src/components/AiProjectWorkspace.test.mjs`
- Modify `src/renderer/src/composables/useAiProjectWorkspace.test.ts`

- [x] Write failing tests for the row action menu, rename, pin toggling, export, and both deletion confirmations.
- [x] Run focused UI and composable tests.
- [x] Add the per-project action menu while preserving single-click project selection.
- [x] Implement rename prompt, pin ordering refresh, export action, and two sequential delete confirmations.
- [x] Run focused tests and lint.

## Final Verification

- [x] Run `npm run test:unit`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
