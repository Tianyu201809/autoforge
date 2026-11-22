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

- [ ] **Step 1: Write failing tests** `starts_on_projects_view`, `restores_last_view`, `switches_context_without_remounting_runner`, and `clamps_persisted_sidebar_widths`.
- [ ] **Step 2: Run** `node --import tsx --test src/renderer/src/composables/useWorkspaceNavigation.test.ts`.
- [ ] **Step 3: Implement navigation state and shell** with fixed dimensions, keyboard focus, and existing theme tokens.
- [ ] **Step 4: Run component tests and `npm run lint`**.
- [ ] **Step 5: Commit** with `feat(ui): add shared workspace shell`.

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

- [ ] **Step 1: Write failing tests** `renders_provider_profiles`, `clears_write_only_key_after_save`, `shows_connection_test_state`, and `edits_compatible_provider_endpoint`.
- [ ] **Step 2: Run focused renderer tests**.
- [ ] **Step 3: Implement model profile view** using existing settings controls, icon library, and theme variables.
- [ ] **Step 4: Add the test to `test:unit` and run focused test/lint**.
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

- [ ] **Step 1: Write failing tests** `creates_project_from_folder_picker`, `restores_active_project`, `renders_streaming_turns`, `cancels_agent_turn`, `shows_check_failure_and_retry`, `shows_auto_import_result`, and `toggles_inspector_panel`.
- [ ] **Step 2: Run focused test** and verify failing states.
- [ ] **Step 3: Implement workspace view and composable** with one event subscription per mount and explicit cleanup.
- [ ] **Step 4: Add test to `test:unit` and run focused renderer tests/lint**.
- [ ] **Step 5: Commit** with `feat(ui): add AI project workspace`.

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

- [ ] **Step 1: Add/adjust tests** `routes_existing_sidebar_actions`, `keeps_script_filters_when_switching_views`, and `preserves_global_runner_subscriptions`.
- [ ] **Step 2: Implement migration in small component slices**; do not replace script store or runner behavior.
- [ ] **Step 3: Run affected component tests and all `test:unit` tests**.
- [ ] **Step 4: Run `npm run lint` and `npm run build`**.
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

- [ ] **Step 1: Verify 1280x800 and 1024x640 layouts** with projects, long conversation, script library/detail, settings, and log panel.
- [ ] **Step 2: Verify** keyboard navigation, dark/light skin switching, sidebar persistence, and editor/terminal popouts.
- [ ] **Step 3: Fix only issues in this UI scope and rerun affected tests**.
- [ ] **Step 4: Run final `npm run test:unit`, `npm run lint`, and `npm run build`**.
- [ ] **Step 5: Commit** with `test(ui): verify v2 workbench workflows`.
