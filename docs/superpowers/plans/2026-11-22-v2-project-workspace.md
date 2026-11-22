# v2.0 Project Workspace and Auto Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent local AI projects whose generated JavaScript/Python packages are checked and automatically imported into Autoforge.

**Architecture:** Store project metadata and conversations in versioned SQLite tables while keeping project files in the user's selected folder. The main process owns file access, Agent tool execution, syntax/package checks, cancellation, and import/update. Provider traffic is injected through the model adapter contract.

**Tech Stack:** Electron main/preload IPC, Vue 3, SQLite/sql.js repositories, Node filesystem APIs, provider adapters, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-v2-agent-workspace-design.md`

**Depends on:** `2026-11-22-v2-model-providers.md` Tasks 1-5.

## Global Constraints

- The user chooses an existing, writable, empty directory for initial project creation.
- Reject a symlink project root and all path traversal or symlink escapes.
- Agent can only list/read/write ordinary text files under the project root.
- No arbitrary shell, package install, user script execution, or project-defined build commands.
- Automatic checks are existing package validation plus fixed JavaScript/Python syntax checks.
- Import only after both checks pass. Do not automatically run the imported script.
- Project removal deletes only Autoforge project metadata/conversation, never the user's folder.
- A failed import/update leaves the prior imported script available.

## Review Focus

- Junctions/symlinks, mixed separators, Unicode paths, and Windows device names cannot escape the selected root.
- A user editing a file concurrently with Agent writes or rollback retains the user's version and blocks import.
- Python missing or failing syntax check must block import with an actionable status.
- Cancellation between generation, write, check, and import must not start a later phase.
- Replacing an imported script preserves its ID, preferences, default environment, and environment values after any failure.

---

### Task 1: Project and Conversation Persistence

**Files:**
- Create: `src/main/db/migrations/007-ai-workspace.ts`
- Create: `src/main/db/repositories/ai-workspace-repository.ts`
- Create: `src/main/db/repositories/ai-workspace-repository.test.ts`
- Modify: `src/main/db/database.ts`
- Modify: `src/main/db/repositories/index.ts`
- Create or extend: `src/shared/ai-workspace-types.ts`

**Interfaces:**
- `AiProject = { id, name, rootPath, language, profileId, importedScriptId?, status, createdAt, updatedAt }`.
- `AiProject.language = 'javascript' | 'python'`.
- `AiProjectTurn = { id, projectId, role, content, status, changes?, checks?, importedScriptId?, createdAt }`.
- `AiProjectStatus = 'ready' | 'generating' | 'applying' | 'checking' | 'importing' | 'blocked' | 'error' | 'interrupted'`.
- `AiProjectTurn.status = 'running' | 'complete' | 'cancelled' | 'error'` and `role = 'user' | 'assistant'`.
- `AiProjectSummary = Pick<AiProject, 'id' | 'name' | 'rootPath' | 'language' | 'status' | 'updatedAt'>`.
- Repository methods: `listProjects()`, `getProject(id)`, `createProject(input)`, `updateProject(id, patch)`, `removeProject(id)`, `listTurns(projectId)`, `appendTurn(projectId, turn)`, `updateTurn(projectId, turnId, patch)`.
- The project row stores canonical root path, language, profile ID, imported script ID, status, timestamps. Turn rows store role/content/status, tool summaries, checks, and import result.

- [x] **Step 1: Write failing repository tests** `persists_project_metadata`, `rejects_duplicate_canonical_root`, `orders_turns_by_creation`, `validates_state_transitions`, and `removes_project_rows_without_deleting_root`.
- [x] **Step 2: Run** `node --import tsx --test src/main/db/repositories/ai-workspace-repository.test.ts`.
- [x] **Step 3: Implement migration 7 and repository** following existing config/script repository patterns.
- [x] **Step 4: Run repository tests and database migration tests**.
- [x] **Step 5: Commit** with `feat(ai): persist local project sessions`.

### Task 2: Project Root and File Operations

**Files:**
- Create: `src/main/services/ai/project-workspace.ts`
- Create: `src/main/services/ai/project-workspace.test.ts`

**Interfaces:**
- `validateProjectRoot(path): ProjectRootInfo` validates existing empty/writable directory, rejects root symlinks, and returns canonical path.
- `ProjectRootInfo = { canonicalPath: string; writable: true; empty: true }`.
- `listProjectFiles(projectId): ProjectFile[]`, `readProjectFile(projectId, relativePath): ProjectFileContent`, and `applyProjectChanges(projectId, changes, expectedHashes): ProjectChangeResult`.
- `ProjectFile = { path: string; sha256: string; size: number; kind: 'text' | 'binary' }`; reads reject binary and files over 512 KiB.
- `applyProjectChanges` accepts `{ path: string; content: string }[]` and expected SHA-256 values for every existing target; new targets use `null`.
- `ProjectChangeResult = { applied: string[]; conflicts: string[]; rollbackFailed: string[] }`.
- File entries include relative path, content hash, byte size, and text/binary classification.
- `applyProjectChanges` creates an in-memory or bounded on-disk snapshot, checks expected hashes before writes, and only rolls back files still matching the applied batch.

- [x] **Step 1: Write failing tests** `accepts_empty_writable_root`, `rejects_nonempty_and_symlink_roots`, `rejects_traversal_and_link_escape`, `rejects_binary_and_oversize_files`, `detects_external_hash_conflict`, and `rollback_does_not_overwrite_external_edit`.
- [x] **Step 2: Run** `node --import tsx --test src/main/services/ai/project-workspace.test.ts`.
- [x] **Step 3: Implement** canonical path checks, ignored directory policy, bounded text IO, file hashing, and optimistic conflict detection.
- [x] **Step 4: Run focused filesystem tests on the current OS**.
- [x] **Step 5: Commit** with `feat(ai): add bounded project file operations`.

### Task 3: Script Package and Syntax Checks

**Files:**
- Create: `src/main/services/ai/project-checks.ts`
- Create: `src/main/services/ai/project-checks.test.ts`
- Reference: `src/main/services/script-workspace.ts`
- Reference: `src/main/services/python-resolver.ts`

**Interfaces:**
- `checkScriptPackage(projectPath): Promise<ProjectCheckResult>` calls `scriptWorkspace.validatePackageDirectory`.
- `checkScriptSyntax(projectPath, manifest, pythonExecutable?): Promise<ProjectCheckResult>` uses `node --check` for JS and a fixed Python AST parser invocation for Python. Never run the script entry or files' top-level code.
- `ProjectCheckResult = { status: 'passed' | 'failed' | 'blocked'; code: string; message: string; diagnostics: string[] }`.
- Check failures return bounded, secret-redacted diagnostics and stable check codes.

- [x] **Step 1: Write failing tests** `validates_manifest_and_entry`, `blocks_javascript_syntax_error`, `blocks_python_syntax_error`, `blocks_when_python_missing`, `times_out_checker`, and `checks_paths_with_spaces_and_unicode`.
- [x] **Step 2: Run** `node --import tsx --test src/main/services/ai/project-checks.test.ts`.
- [x] **Step 3: Implement** checks with fixed executable/argument arrays and no shell interpolation.
- [x] **Step 4: Run check tests and verify generated source is never invoked**.
- [x] **Step 5: Commit** with `feat(ai): validate generated script packages`.

### Task 4: Local Script Import and Update

**Files:**
- Modify: `src/main/services/script-registry.ts`
- Modify: `src/main/services/script-registry.test.ts` or create `src/main/services/project-script-import.test.ts`
- Reference: `src/main/services/script-workspace.ts`
- Modify: `package.json` (`test:unit`)

**Interfaces:**
- First import uses existing `ScriptRegistry.importFromPath(sourceDir)`; project association is persisted by the Agent service.
- Produces `updateFromProject(scriptId, sourceDir): ScriptMeta`, which reuses `replaceFromDirectory` and persists metadata with the existing script ID.
- Update does not set `hubScriptId`; it preserves user preference/environment data by retaining the script ID and existing preference records.

- [ ] **Step 1: Write failing tests** `imports_project_after_checks`, `updates_associated_script_and_preserves_preferences`, `rejects_invalid_project_package`, and `failed_project_update_restores_previous_script`.
- [ ] **Step 2: Run focused registry tests**.
- [ ] **Step 3: Implement project association lookup and transactional update**.
- [ ] **Step 4: Run import/update tests and existing script workspace tests**.
- [ ] **Step 5: Register tests in `test:unit` and commit** with `feat(ai): link generated projects to imported scripts`.

### Task 5: Agent Session and Tool Loop

**Files:**
- Create: `src/main/services/ai/agent-service.ts`
- Create: `src/main/services/ai/agent-tools.ts`
- Create: `src/main/services/ai/agent-service.test.ts`
- Create: `src/main/services/ai/agent-tools.test.ts`

**Interfaces:**
- Consumes `ModelProfileService.resolveProvider`, `AiWorkspaceRepository`, `ProjectWorkspace`, `ProjectChecks`, and `ScriptRegistry` from Tasks 1-4.
- Produces `createProject({ rootPath, name, language, profileId }): Promise<AiProject>`, `listProjects(): AiProjectSummary[]`, `getProject(id): AiProject | null`, `removeProject(id): boolean`, `startTurn(projectId, message, onEvent): Promise<AiProjectTurn>`, `cancelTurn(projectId): boolean`, and `retryChecks(projectId): Promise<AiProjectTurn>`.
- `onEvent(event: AiAgentEvent): void`, where `AiAgentEvent` is a discriminated union for `assistant_delta`, `tool_started`, `tool_finished`, `file_changes`, `check_result`, `import_result`, and `turn_finished`, each carrying `projectId` and `turnId`.
- Tool schemas are allowlisted to list/read/write/check/import. Import tools independently re-run checks before registry calls.

- [ ] **Step 1: Write failing tests** `rejects_unlisted_agent_tool`, `rejects_malformed_tool_arguments`, `runs_multi_step_tool_loop`, `allows_one_turn_per_project`, `cancels_before_import_at_each_phase`, `repairs_after_check_failure`, `auto_imports_after_all_checks`, and `marks_inflight_turn_interrupted_on_restart`.
- [ ] **Step 2: Run focused Agent tests**.
- [ ] **Step 3: Implement** a bounded tool-call loop with persisted turns, cancellation propagation, per-project locking, and phase validation.
- [ ] **Step 4: Run Agent tests with fake provider adapters and filesystem fixtures**.
- [ ] **Step 5: Commit** with `feat(ai): orchestrate bounded project agent turns`.

### Task 6: IPC, Folder Picker, and Runtime Wiring

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Modify: `src/main/index.ts` or runtime container wiring
- Create: `src/main/ipc/ai-workspace-handlers.test.ts` if IPC test harness is supported
- Modify: `package.json` (`test:unit`)

**Interfaces:**
- IPC supports folder pick, project list/create/get/remove, start/cancel turn, event subscription, and retry checks/import.
- Folder picker uses Electron `dialog.showOpenDialog` with `openDirectory` and does not create or delete folders.
- Main process instantiates one AI runtime after database initialization; renderer receives only typed DTOs.

- [ ] **Step 1: Write failing IPC contract tests** `rejects_invalid_project_payload`, `routes_events_to_requesting_window`, `cancels_project_turn`, and `returns_null_when_folder_picker_cancelled`.
- [ ] **Step 2: Implement** IPC handlers and a narrow `window.autoforge.ai` preload API with matching types.
- [ ] **Step 3: Register tests in `test:unit` and run project, provider, and IPC focused tests**.
- [ ] **Step 4: Run `npm run lint` and `npm run build`**.
- [ ] **Step 5: Commit** with `feat(ai): wire project agent IPC`.
