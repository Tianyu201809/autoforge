# Plugin Center UX Implementation Plan

**Goal:** Allow five concurrent Hub script installs, default catalog ordering by publish time, and refresh the plugin center cards plus graphite/snow themes.

**Architecture:** Keep the existing Hub IPC/install contract. Move renderer install state from one global task to a per-plugin task map with a five-task cap, sort returned items by `publishedAt`/`createdAt`, and refine the existing scoped CSS and theme variables without changing app-wide component APIs.

**Tech Stack:** Vue 3, TypeScript, scoped CSS, existing Hub IPC and lucide-vue-next icons.

## Global Constraints

- Preserve existing Hub install progress events and retry behavior.
- Never start more than five installs at once, and never duplicate the same plugin.
- Use `publishedAt` with `createdAt` fallback for newest-first ordering in every plugin center source.
- Keep card dimensions stable and preserve responsive mobile layout.

### Task 1: Concurrent Install State

**Files:**
- Modify: `src/renderer/src/components/HubPluginCenterPanel.vue`

- [x] Replace singleton install refs with `Map<string, HubInstallProgress>` and active task IDs.
- [x] Update progress lookup, event routing, card/detail button disabled state, success/error cleanup, and retry behavior.
- [x] Cap starts at five while allowing unrelated cards to install concurrently.

### Task 2: Publish-Time Ordering

**Files:**
- Modify: `src/renderer/src/components/HubPluginCenterPanel.vue`

- [x] Add stable newest-first comparator using `publishedAt ?? createdAt`.
- [x] Apply it after every list response for marketplace, personal, and team scopes.
- [x] Render publish date in card metadata with update date fallback.

### Task 3: Card UI Refresh

**Files:**
- Modify: `src/renderer/src/components/HubPluginCenterPanel.vue`

- [x] Refine card hierarchy, metadata, install action states, progress placement, spacing, borders, and hover/focus treatment.
- [x] Add install count and publish/update labels without changing data contracts.
- [x] Verify narrow viewport layout and detail drawer behavior.

### Task 4: Graphite and Snow Themes

**Files:**
- Modify: `src/renderer/src/assets/themes.css`

- [x] Rebalance graphite and snow surface, text, border, hover, accent, and status variables for readable contrast.
- [x] Keep the existing skin IDs and theme pairing intact.

### Task 5: Verification

**Files:**
- Test: existing Hub and renderer tests

- [x] Run targeted Hub/client and renderer tests.
- [x] Run TypeScript build/type checks and inspect git diff for unrelated changes.
