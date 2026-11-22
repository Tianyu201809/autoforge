# v2.0 Unified Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize Autoforge into a project-first workbench with a Codex-like navigation/sidebar/main-area layout while retaining all existing script workflows.

**Architecture:** Add a persistent main-window view state and shared shell. Keep script-library data/composables intact and mount existing pages/components inside the shell. Add a dedicated AI project workspace with a conversation center and collapsible file/check panel. Provider settings use the same global settings route.

**Tech Stack:** Vue 3 Composition API, existing Tailwind CSS 4/theme variables, lucide-vue-next, preload AI workspace API.

**Spec:** `docs/superpowers/specs/2026-11-22-v2-agent-workspace-design.md`

**Depends on:** `2026-11-22-v2-model-providers.md` and `2026-11-22-v2-project-workspace.md` IPC contracts.

## Global Constraints

- Preserve existing script list/filter/category/run/detail/log behavior and all navigation entry points.
- Preserve editor/terminal popouts, title-bar controls, tray behavior, drag-and-drop import, shortcuts, themes, Hub, and MCP.
- Main frame uses collapsible navigation, contextual project/script sidebar, central work area, optional right inspector.
- API keys never enter renderer state.
- Keep layout usable at 1024px and narrow widths; do not let the inspector cover the composer or active content.
- No new UI framework or icon library.

## Review Focus

- Every previous sidebar/modal workflow remains reachable by keyboard and pointer after navigation changes.
- Existing `App.vue` runner subscriptions and popout state are not remounted or duplicated during view changes.
- A long AI response, empty state, missing model, provider error, checking/importing state, and narrow viewport all fit without overlap.
- Collapsing/reopening sidebars preserves active project, selected script, and unsent prompt text.
- Theme switches and persisted widths work in both dark and light skins.

---

### Task 1: Workspace Navigation State and Shell

**Files:**
- Create: `src/renderer/src/components/WorkspaceShell.vue`
- Create: `src/renderer/src/components/WorkspaceNavigation.vue`
- Create: `src/renderer/src/components/WorkspaceContextSidebar.vue`
- Create: `src/renderer/src/composables/useWorkspaceNavigation.ts`
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/constants/layout.ts`
- Test: `src/renderer/src/composables/useWorkspaceNavigation.test.ts`

**Interfaces:**
- Produces view IDs `projects | scripts | history | hub | guide | settings` plus active project/script identifiers.
- `WorkspaceShell` provides slots for navigation, contextual sidebar, main content, and optional inspector.
- Navigation/sidebar collapsed state and widths persist in local storage with stable keys.

- [x] **Step 1: Write failing tests** `starts_on_projects_view`, `restores_last_view`, `switches_context_without_remounting_runner`, and `clamps_persisted_sidebar_widths`.
- [x] **Step 2: Run** `node --import tsx --test src/renderer/src/composables/useWorkspaceNavigation.test.ts`.
- [x] **Step 3: Implement navigation state and shell** with fixed dimensions, keyboard focus, and existing theme tokens.
- [x] **Step 4: Run component tests and `npm run lint`**.
- [x] **Step 5: Commit** with `feat(ui): add shared workspace shell`.

### Task 2: Model Settings View

**Files:**
- Create: `src/renderer/src/components/ModelProfilesView.vue`
- Create: `src/renderer/src/composables/useModelProfiles.ts`
- Create: `src/renderer/src/components/ModelProfilesView.test.mjs`
- Modify: `src/renderer/src/App.vue`
- Modify: `package.json` (`test:unit`)

**Interfaces:**
- Consumes `window.autoforge.ai` model-profile list/upsert/delete/set-active/set-key/clear-key/test APIs.
- Shows provider type, preset/custom endpoint, model ID, key-present state, timeout, extra headers, connection test state, and active profile.
- API key inputs are write-only and cleared after save.

- [x] **Step 1: Write failing tests** for provider profiles, write-only keys, connection state, and compatible endpoint editing.
- [x] **Step 2: Run focused renderer tests** and verify missing composable/component failures.
- [x] **Step 3: Implement model profile view** in the settings workspace with write-only credentials and provider presets.
- [x] **Step 4: Add renderer behavior tests to the unit-test workflow and run focused tests/lint/build**.
- [ ] **Step 5: Commit** with `feat(ui): add AI model settings view`.

### Task 3: AI Project Workspace View

**Files:**
- Create: `src/renderer/src/components/AiProjectWorkspace.vue`
- Create: `src/renderer/src/components/AiProjectFilesPanel.vue`
- Create: `src/renderer/src/components/AiProjectTurn.vue`
- Create: `src/renderer/src/composables/useAiProjectWorkspace.ts`
- Create: `src/renderer/src/components/AiProjectWorkspace.test.mjs`
- Modify: `src/renderer/src/App.vue`
- Modify: `package.json` (`test:unit`)

**Interfaces:**
- Consumes `window.autoforge.ai` project and Agent APIs, normalized event types, provider profile views, and existing toast/confirm services.
- Supports choosing an empty local folder, creating/reopening/removing a project record, selecting language/model, sending multi-line prompts, cancellation, retry, and import/check status.
- Right panel displays project files, each turn's changed paths, package/syntax result, and associated imported script.

- [x] **Step 1: Write failing tests** for folder-based creation, project restoration, streaming/cancellation, checks/import, and subscription cleanup.
- [x] **Step 2: Run focused tests** and verify missing composable/component failures.
- [x] **Step 3: Implement workspace view and composable** with one event subscription per mount and explicit cleanup.
- [x] **Step 4: Add renderer behavior tests to the unit-test workflow and run focused tests/lint/build**.
- [ ] **Step 5: Commit** with `feat(ai): add AI project workspace`.

### Task 4: Migrate Existing Features into the Shared Shell

**Files:**
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/components/Sidebar.vue`
- Modify: `src/renderer/src/components/TitleBar.vue`
- Modify: `src/renderer/src/components/MainContent.vue`
- Modify: `src/renderer/src/components/SettingsPanel.vue`
- Modify: `src/renderer/src/components/ExecutionHistoryPanel.vue`
- Modify: `src/renderer/src/components/HubPluginCenterPanel.vue`
- Modify: `src/renderer/src/components/DevGuidePanel.vue`
- Modify relevant component tests and `package.json`

**Interfaces:**
- Sidebar routes existing script filters and categories while global navigation routes projects, scripts, history, Hub, guide, and settings.
- Existing `useScriptStore`, `useScriptRunner`, log console, modal hosts, editor popout, terminal popout, and drag/drop handlers remain mounted once.
- Existing settings, history, guide, and Hub views render inside the shared content region with close/back navigation.

- [x] **Step 1: Add route and modal-mode regression tests** for shared workbench views.
- [x] **Step 2: Migrate history, Hub, guide, and settings into the shared workspace while keeping runner subscriptions at App root**.
- [x] **Step 3: Run affected component tests and all `test:unit` tests**.
- [x] **Step 4: Run `npm run lint` and `npm run build`**.
- [ ] **Step 5: Commit** with `refactor(ui): move existing views into workbench`.

### Task 5: Layout and Workflow Verification

**Files:**
- Modify: `src/renderer/src/components/WorkspaceShell.vue`
- Modify: `src/renderer/src/components/AiProjectWorkspace.vue`
- Modify: `src/renderer/src/assets/main.css` only if shell-level layout tokens require it
- Modify: relevant layout tests

**Interfaces:**
- Desktop minimum width remains 1024px. At narrow widths, context sidebar and inspector become drawers without obscuring main actions.
- Resizing uses existing pointer-driven conventions, stable width constraints, and visible keyboard focus.

- [x] **Step 1: Verify 1280x800 and approximately 1024x640 project layouts**; fix the inspector width that initially compressed the conversation.
- [x] **Step 2: Verify** workspace navigation, light skin, model settings and MCP category, plus existing script workflow entry points, editor/terminal popout controls, and tray controls in the desktop app. Theme switching, persisted resizing, script detail/log, MCP status actions, tray behavior, and popout lifecycle need dedicated project data or targeted interaction testing.
- [x] **Step 3: Fix layout issues in scope and rerun affected tests**.
- [x] **Step 4: Run final `npm run test:unit`, `npm run lint`, and `npm run build`**.
- [ ] **Step 5: Commit** with `test(ui): verify v2 workbench workflows`.
