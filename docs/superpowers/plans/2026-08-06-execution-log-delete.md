# 运行日志与历史删除实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前会话运行日志和运行历史增加右键单条删除，以及进入编辑模式后的当前列表批量删除。

**Architecture:** 运行日志继续由 renderer 的 `useScriptRunner` 保存在内存中，为每行生成稳定 ID 并在当前会话集合内删除。运行历史继续由 SQLite 的 `ExecutionRepository` 持久化，通过新增主进程 IPC 暴露按记录 ID 的单条/批量删除；脚本详情历史和全局执行历史共享相同的选择、确认和反馈规则。

**Tech Stack:** Vue 3 Composition API、Electron IPC、TypeScript、sql.js、Node test runner、tsx。

## Global Constraints

- 不改变日志的内存生命周期、2000 行上限或 MCP 日志读取语义。
- 不持久化历史日志行，也不增加日志恢复功能。
- 不提供跨分页的“筛选结果全选”；批量历史删除仅作用于当前已加载页。
- 不允许删除运行中的运行历史记录。
- 不新增软删除、回收站或恢复能力。
- 单条右键删除立即执行；批量删除必须弹出确认。

---

### Task 1: 扩展共享类型与 IPC 合约

**Files:**
- Modify: `src/shared/types/script.ts` (`LogLine`)
- Modify: `src/shared/ipc-channels.ts` (`IPC` history entries)
- Modify: `src/preload/index.ts` (`history` API)
- Modify: `src/renderer/src/env.d.ts` (`Window.autoforge.history`)

**Interfaces:**
- Produces `LogLine.id: string` and `history.delete(recordId: string): Promise<number>` / `history.deleteMany(recordIds: string[]): Promise<number>` for renderer consumers.

- [ ] **Step 1: Write contract tests/compile expectations**

  Add a small shared contract test or type-level usage that constructs a `LogLine` with `id` and calls both history methods through the declared window type.

- [ ] **Step 2: Run the targeted type/test check**

  Run: `npm exec tsc -- --noEmit -p tsconfig.web.json`
  Expected: FAIL because `LogLine.id` and the history IPC methods are not yet declared.

- [ ] **Step 3: Add the exact contracts**

  Add `id: string` to `LogLine`; add `HISTORY_DELETE` and `HISTORY_DELETE_MANY` channel constants; expose matching `ipcRenderer.invoke` wrappers in preload and matching signatures in `env.d.ts`.

- [ ] **Step 4: Re-run the targeted check**

  Run: `npm exec tsc -- --noEmit -p tsconfig.web.json`
  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add src/shared/types/script.ts src/shared/ipc-channels.ts src/preload/index.ts src/renderer/src/env.d.ts && git commit -m "feat: add deletion IPC contracts"`

### Task 2: Implement transactional execution-history deletion

**Files:**
- Modify: `src/main/db/repositories/execution-repository.ts`
- Modify: `src/main/services/execution-history.ts`
- Create: `src/main/db/repositories/execution-repository.test.ts`

**Interfaces:**
- Consumes the repository contract from Task 1.
- Produces `ExecutionRepository.deleteById(id: string): number`, `ExecutionRepository.deleteByIds(ids: string[]): number`, `ExecutionHistoryService.getById(id: string): ExecutionRecord | null`, and corresponding `ExecutionHistoryService.delete` / `deleteMany` methods returning actual deletion counts.

- [ ] **Step 1: Write failing repository tests**

  Open an in-memory sql.js database through the existing adapter/migration setup, insert three `ExecutionRecord` fixtures, then assert: one ID deletes one row; a batch containing a duplicate and a missing ID deletes only existing unique rows; an empty array returns `0`; a thrown statement inside the transaction leaves all rows intact.

- [ ] **Step 2: Run the repository tests**

  Run: `node --import tsx --test src/main/db/repositories/execution-repository.test.ts`
  Expected: FAIL because deletion methods are missing.

- [ ] **Step 3: Implement parameterized deletion**

  Use `DELETE FROM execution_records WHERE id = ?` for single deletion. For batches, deduplicate IDs, return `0` for an empty list, execute one parameterized delete per ID inside `db.transaction`, and sum each statement's `changes` value. Expose the existing repository lookup through `ExecutionHistoryService.getById` so IPC can protect running records.

- [ ] **Step 4: Add service forwarding tests and implementation**

  Assert `ExecutionHistoryService.delete` and `deleteMany` initialize repositories and return repository counts; keep retention/pruning behavior unchanged.

- [ ] **Step 5: Run the repository tests again**

  Run: `node --import tsx --test src/main/db/repositories/execution-repository.test.ts`
  Expected: PASS.

- [ ] **Step 6: Commit**

  Run: `git add src/main/db/repositories/execution-repository.ts src/main/services/execution-history.ts src/main/db/repositories/execution-repository.test.ts && git commit -m "feat: delete execution history records"`

### Task 3: Register validated history IPC handlers

**Files:**
- Modify: `src/main/ipc/handlers.ts` (history handler block)
- Create or extend: `src/main/ipc/handlers.test.ts`

**Interfaces:**
- Consumes `executionHistory.delete(recordId)` and `deleteMany(recordIds)` from Task 2.
- Produces IPC handlers for `HISTORY_DELETE` and `HISTORY_DELETE_MANY`; running records are rejected before deletion by calling `executionHistory.getById`.

- [ ] **Step 1: Add failing handler cases**

  Cover blank/non-string IDs, non-array batch payloads, empty batches, and a record whose status is `running`; assert no deletion call occurs for rejected inputs and valid completed records return the actual count.

- [ ] **Step 2: Run the handler tests**

  Run: `node --import tsx --test src/main/ipc/handlers.test.ts`
  Expected: FAIL because the channels and handlers are not registered.

- [ ] **Step 3: Implement handlers**

  Trim and validate a single ID. For batches, require an array of strings, trim and deduplicate IDs, return `0` for an empty result, load each record through the existing history query/get path, reject any `running` record, then call the service deletion method.

- [ ] **Step 4: Re-run handler tests**

  Run: `node --import tsx --test src/main/ipc/handlers.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add src/main/ipc/handlers.ts src/main/ipc/handlers.test.ts && git commit -m "feat: expose execution history deletion IPC"`

### Task 4: Add stable renderer log IDs and pure selection operations

**Files:**
- Modify: `src/renderer/src/composables/useScriptRunner.ts`
- Create: `src/renderer/src/composables/log-selection.ts`
- Create: `src/renderer/src/composables/log-selection.test.ts`

**Interfaces:**
- Produces `logsForSession` results whose `LogLine.id` values are stable, plus pure helpers `selectAllIds`, `toggleSelectedId`, and `removeSelectedLogs(logs, selectedIds)` for component state.

- [ ] **Step 1: Write failing pure helper tests**

  Assert select-all returns only IDs in the supplied list, toggling adds/removes exactly one ID, removal preserves order and does not remove unselected rows, and duplicate selected IDs do not change the result.

- [ ] **Step 2: Run the helper tests**

  Run: `node --import tsx --test src/renderer/src/composables/log-selection.test.ts`
  Expected: FAIL because the helper module is absent.

- [ ] **Step 3: Implement ID generation and helpers**

  Generate an ID once when each IPC log arrives (for example, a monotonic counter combined with the session ID), keep the ID through all filtering, and use the helpers for selection/removal. Preserve the existing 2000-line cap and session filtering.

- [ ] **Step 4: Run helper tests and type-check**

  Run: `node --import tsx --test src/renderer/src/composables/log-selection.test.ts` and `npm exec tsc -- --noEmit -p tsconfig.web.json`
  Expected: PASS for both.

- [ ] **Step 5: Commit**

  Run: `git add src/renderer/src/composables/useScriptRunner.ts src/renderer/src/composables/log-selection.ts src/renderer/src/composables/log-selection.test.ts && git commit -m "feat: identify selectable runtime logs"`

### Task 5: Add log-console edit mode and context-menu deletion

**Files:**
- Modify: `src/renderer/src/components/LogConsole.vue`
- Modify: `src/renderer/src/App.vue` (clear/delete event routing)
- Modify: `src/renderer/src/TerminalWindowApp.vue` (standalone routing)
- Modify: `src/renderer/src/components/DetailPanel.vue` (embedded log routing)

**Interfaces:**
- Consumes the log selection helpers and `runner.removeLogs(sessionId: string, ids: string[])` from Task 4.
- Produces `clear`, `delete`, and `deleteMany` events with session-scoped IDs while preserving existing close/stop behavior.

- [ ] **Step 1: Add component interaction tests or focused harness cases**

  Cover entering/exiting edit mode, selecting all visible rows, disabling delete with zero selection, right-clicking one row, confirming a batch, and receiving a new log while edit mode is active.

- [ ] **Step 2: Implement toolbar and row state**

  Add an edit-mode toolbar action, per-row checkbox rendering, selected count, current-list select-all, cancel, and confirmation dialog for batch deletion. Keep the existing clear-all button semantics separate unless the user explicitly invokes the new editor.

- [ ] **Step 3: Implement row context menu**

  Add a row-level context menu action that deletes only that row immediately; stop propagation so it does not select a session or open unrelated terminal actions.

- [ ] **Step 4: Route events through all log hosts**

  Update `App.vue`, `TerminalWindowApp.vue`, and `DetailPanel.vue` to call `runner.removeLogs(sessionId, ids)` for the new events and keep the active session/scroll position valid.

- [ ] **Step 5: Run focused checks**

  Run: `npm exec eslint src/renderer/src/components/LogConsole.vue src/renderer/src/App.vue src/renderer/src/TerminalWindowApp.vue src/renderer/src/components/DetailPanel.vue src/renderer/src/composables/useScriptRunner.ts` and `npm exec tsc -- --noEmit -p tsconfig.web.json`
  Expected: PASS.

- [ ] **Step 6: Commit**

  Run: `git add src/renderer/src/components/LogConsole.vue src/renderer/src/App.vue src/renderer/src/TerminalWindowApp.vue src/renderer/src/components/DetailPanel.vue && git commit -m "feat: delete runtime logs from terminal"`

### Task 6: Add shared history selection behavior to both history panels

**Files:**
- Modify: `src/renderer/src/components/ScriptRunHistoryPanel.vue`
- Modify: `src/renderer/src/components/ExecutionHistoryPanel.vue`
- Modify: `src/renderer/src/composables/useConfirmDialog.ts` or existing confirmation host integration

**Interfaces:**
- Consumes history IPC methods from Task 1/3 and existing `queryPage`/`query` refresh functions.
- Produces current-loaded-list selection, batch confirmation, single-record context-menu deletion, and reload/count updates in both panels.

- [ ] **Step 1: Add failing selection/UI cases**

  Assert that running records render without delete controls, completed records can be selected, batch deletion sends only loaded selected IDs, right-click deletion invokes the single-delete IPC, and successful deletion reloads the current filters.

- [ ] **Step 2: Implement script-detail history selection**

  Add edit mode and selected IDs to `ScriptRunHistoryPanel.vue`; use `queryPage`'s loaded `records` array as the select-all scope, preserve infinite-scroll pagination, and clear selection when filters/script change.

- [ ] **Step 3: Implement global history selection**

  Add the same controls to `ExecutionHistoryPanel.vue`; use `filteredSummaries`' currently rendered records as the select-all scope, exclude `running` records, and refresh both summaries and today count after deletion.

- [ ] **Step 4: Add context-menu and confirmation feedback**

  Use the existing confirm/toast patterns. Single deletion calls `window.autoforge.history.delete(record.id)` immediately; batch deletion calls `deleteMany([...selectedIds])` only after confirmation and reports the returned count.

- [ ] **Step 5: Run focused checks**

  Run: `npm exec eslint src/renderer/src/components/ScriptRunHistoryPanel.vue src/renderer/src/components/ExecutionHistoryPanel.vue` and `npm exec tsc -- --noEmit -p tsconfig.web.json`
  Expected: PASS.

- [ ] **Step 6: Commit**

  Run: `git add src/renderer/src/components/ScriptRunHistoryPanel.vue src/renderer/src/components/ExecutionHistoryPanel.vue src/renderer/src/composables/useConfirmDialog.ts && git commit -m "feat: delete execution history from both views"`

### Task 7: Run regression validation and update docs

**Files:**
- Modify: `docs/CHANGELOG.md` (add the feature under the existing `[1.24.0]` “新增” section)
- Test: all files added in Tasks 2, 3, and 4

**Interfaces:**
- Consumes all completed deletion paths; produces a verified build and documented user-visible behavior.

- [ ] **Step 1: Run targeted tests**

  Run: `node --import tsx --test src/main/db/repositories/execution-repository.test.ts src/main/ipc/handlers.test.ts src/renderer/src/composables/log-selection.test.ts`
  Expected: PASS.

- [ ] **Step 2: Run the existing unit suite**

  Run: `npm run test:unit`
  Expected: PASS with no regressions.

- [ ] **Step 3: Run lint and production build**

  Run: `npm run lint` and `npm run build`
  Expected: both commands exit 0.

- [ ] **Step 4: Manually verify acceptance paths**

  Launch the app and verify: toolbar edit mode, current-list select-all, batch confirmation, right-click single deletion, running-record protection, both history panels, and continued log output during a running session.

- [ ] **Step 5: Document the user-visible behavior**

  Add a concise changelog entry under `[1.24.0]` → `新增` describing edit-mode batch deletion, right-click single deletion, current-page scope, and confirmation behavior.

- [ ] **Step 6: Commit validation/docs**

  Run: `git add docs/CHANGELOG.md && git commit -m "docs: note log and history deletion"`
