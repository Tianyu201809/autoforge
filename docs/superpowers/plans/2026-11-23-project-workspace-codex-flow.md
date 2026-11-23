# Project Workspace Codex Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make project workspaces feel like Codex and require an explicit user action before AI analysis, checks, and Autoforge script import/update.

**Architecture:** Keep the existing Vue/Electron workspace and Agent safety boundary. Separate ordinary chat turns from an explicit analyze, repair, check, and import workflow in the main-process AI service; expose its events through existing IPC and UI state. Refine project and script workspace layout using existing persisted width/collapse mechanisms.

**Tech Stack:** Electron, Vue 3, TypeScript, Node test runner, existing AI provider/tools and workspace components.

**Spec:** `docs/superpowers/specs/2026-11-23-project-workspace-codex-flow-design.md`

## Global Constraints

- Ordinary chat file changes do not automatically run package/syntax checks or import/update scripts.
- The explicit workflow may edit files and automatically recheck; import/update occurs only after package and syntax checks pass.
- Project tools remain restricted to safe project-relative files; never run generated scripts.
- The imported script is not automatically executed.
- Preserve existing projects, model credentials, themes, keyboard use, script drag-and-drop import, and script runtime behavior.

## Review Focus

- Provider/tool failure during explicit analysis must leave project files intact and not import; test service failure path.
- Cancellation during analysis or checking must release per-project lock and restore a usable status; test cancellation followed by a new operation.
- A second action racing an active chat/check must be rejected; test mutual exclusion.
- An already linked script that no longer exists must not silently report an update/import success; test missing linked ID recovery behavior.
- Narrow viewport and collapsed sidebars must leave the composer and panel toggle usable; test responsive class/control rendering.

## File Map

- `src/main/services/ai/agent-service.ts`: separate `startTurn` from explicit project analyze/check/import operation.
- `src/main/services/ai/agent-tools.ts`: allow analysis workflow to use safe file tools without exposing implicit import.
- `src/main/services/ai/agent-service.test.ts`, `agent-tools.test.ts`: service/tool behavior and lifecycle coverage.
- `src/main/ipc/ai-workspace-handlers.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`: expose operation through the existing AI workspace bridge.
- `src/main/ipc/ai-workspace-handlers.test.ts`: IPC dispatch contract.
- `src/renderer/src/composables/useAiProjectWorkspace.ts` and its test: explicit workflow, state and events.
- `src/renderer/src/components/AiProjectWorkspace.vue` and its test: Codex-like project/conversation/inspector layout and manual primary action.
- `src/renderer/src/components/Sidebar.vue`, `WorkspaceContextSidebar.vue`, `WorkspaceShell.vue`, and corresponding tests: upload button placement and continuous resize boundary.
- `src/renderer/src/composables/useWorkspaceNavigation.ts` and tests only if a project-specific persisted inspector width is needed; do not change shared inspector preference without a test.

## Task 1: Decouple automatic checks and import from normal chat

**Files:**
- Modify: `src/main/services/ai/agent-service.ts`
- Modify: `src/main/services/ai/agent-tools.ts`
- Test: `src/main/services/ai/agent-service.test.ts`
- Test: `src/main/services/ai/agent-tools.test.ts`

**Interfaces:** Ordinary `startTurn(projectId, message, onEvent)` remains the chat API. Add `analyzeProject(projectId, onEvent)` returning an `AiProjectTurn` with checks/import linkage when successful. Both operations share the existing per-project active-operation lock.

- [x] **Step 1: Write failing service tests** asserting a chat turn that writes files does not call checks/import, and an explicit analysis calls bounded analysis then package check, syntax check, and import in order.
- [x] **Step 2: Run** `node --import tsx --test src/main/services/ai/agent-service.test.ts`; confirm the new expectations fail because chat currently auto-checks/imports and `analyzeProject` is absent.
- [x] **Step 3: Write failing tool tests** asserting analysis can use list/read/write tools but cannot invoke `import_script` directly.
- [x] **Step 4: Run** `node --import tsx --test src/main/services/ai/agent-tools.test.ts`; confirm failure on the missing restricted analysis mode.
- [x] **Step 5: Implement** ordinary chat completion without implicit checks/import; implement explicit analysis with a system instruction to inspect and repair files, safe file tools only, then deterministic package and syntax checks and final import. Keep abort, status, event, and lock cleanup behavior consistent with `startTurn`.
- [x] **Step 6: Run** both targeted test files and verify normal chat never checks/imports, explicit flow orders operations, failure blocks import, cancellation releases lock, and a missing linked script is handled as an error rather than a false success.

## Task 2: Expose explicit analysis through IPC and renderer state

**Files:**
- Modify: `src/main/ipc/ai-workspace-handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Test: `src/main/ipc/ai-workspace-handlers.test.ts`
- Modify/Test: `src/renderer/src/composables/useAiProjectWorkspace.ts`, `useAiProjectWorkspace.test.ts`

**Interfaces:** Add `window.autoforge.ai.analyzeProject(projectId)` using existing Agent event subscription; add composable `analyzeProject()` and explicit operation state. Keep `sendMessage()` semantics separate.

- [x] **Step 1: Add failing IPC test** asserting `analyzeProject` routes the project ID to the service and returns the completed turn.
- [x] **Step 2: Run** `node --import tsx --test src/main/ipc/ai-workspace-handlers.test.ts`; verify the bridge method is currently absent.
- [x] **Step 3: Add failing composable tests** for running/success/failure/cancel events, analysis summary, checks, import result, and ordinary send not setting import status.
- [x] **Step 4: Run** `node --import tsx --test src/renderer/src/composables/useAiProjectWorkspace.test.ts`; verify the API and state behavior are absent.
- [x] **Step 5: Implement** the IPC/preload/type bridge and composable state. Prevent send/check action overlap and clear operation state in `finally`.
- [x] **Step 6: Run** both targeted tests and verify pass.

## Task 3: Rework project workspace into Codex-like project, conversation, and inspector regions

**Files:**
- Modify: `src/renderer/src/components/AiProjectWorkspace.vue`
- Modify: `src/renderer/src/components/AiProjectWorkspace.test.mjs`
- Modify: `src/renderer/src/App.vue` only if needed to assign a single owner for inspector width/open state.
- Modify/Test: `src/renderer/src/composables/useWorkspaceNavigation.ts`, `useWorkspaceNavigation.test.ts` only if project inspector width needs separate persistence.

**Interfaces:** Consume composable `analyzeProject()` from Task 2. Preserve current project management events and project create/rename/pin/export/delete actions.

- [x] **Step 1: Add failing component assertions** for a Codex-like project sidebar and conversation composer, a visible manual “AI 分析并检查/导入” action, distinct unchecked/passed/imported states, and no auto-import wording.
- [x] **Step 2: Run** `node --import tsx --test src/renderer/src/components/AiProjectWorkspace.test.mjs`; verify missing behavior.
- [x] **Step 3: Implement** the three-region layout, manual action/status presentation, empty state, and panel toggle. Make panel width use the single owner chosen in implementation: prefer App/WorkspaceShell layout state, add project-specific persistence only if sharing would alter other views' preference.
- [x] **Step 4: Run** component and workspace navigation tests; verify narrow layout retains accessible panel toggle and composer.

## Task 4: Move script upload control and make sidebar resizing continuous

**Files:**
- Modify: `src/renderer/src/components/Sidebar.vue`
- Modify: `src/renderer/src/components/WorkspaceContextSidebar.vue`
- Modify: `src/renderer/src/components/WorkspaceShell.vue`
- Test: `src/renderer/src/components/Sidebar.test.mjs`
- Test: add focused `WorkspaceShell.test.mjs` if there is no existing resize coverage.

**Interfaces:** Keep the existing `@import` event and `contextWidth` layout state. The resize separator must resize the whole context sidebar and let the main slot flex to remaining width.

- [x] **Step 1: Add failing tests** asserting upload button is at the top of the script sidebar before search/navigation, bottom shortcuts remain, and sidebar divider has one continuous interactive hit area that changes context width.
- [x] **Step 2: Run** `node --import tsx --test src/renderer/src/components/Sidebar.test.mjs`; verify screenshot-targeted behavior is absent.
- [x] **Step 3: Implement** the control relocation and separator positioning/styling without changing import handler behavior.
- [x] **Step 4: Run** sidebar and workspace-shell tests and verify pass.

## Task 5: Full verification and self-review

**Files:** no additional source files unless verification reveals a defect.

- [x] **Step 1: Run AI/workspace renderer tests** with `npm run test:renderer-ai`.
- [x] **Step 2: Run main AI/IPC tests** with `node --import tsx --test src/main/services/ai/*.test.ts src/main/ipc/ai-workspace-handlers.test.ts`.
- [x] **Step 3: Run** `npm run lint` and `npm run build`.
- [x] **Step 4: Review the final diff** against every acceptance item in the design and report results plus any limitation.

## Plan Self-Review

- Spec coverage: manual trigger and no automatic import (Tasks 1-3); safe analysis/repair and status/error/cancel (Tasks 1-2); Codex layout/resizable inspector/narrow mode (Task 3); screenshot 3/4 script sidebar controls (Task 4); regression checks (Task 5).
- Open builder choices are bounded in the file map and task interfaces: keep inspector state single-owned, add isolated persistence only when needed; reuse existing service lock, event stream, and file tools.
- The review focus includes failure, cancellation, concurrency, stale script association, and narrow viewport expectations and assigns tests to their owning tasks.
