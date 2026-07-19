# AutoforgeHub Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a persisted AutoforgeHub URL setting and make the sidebar entry open it in the system browser.

**Architecture:** Reuse the existing `AppConfig` SQLite JSON persistence and the existing `system.openExternal` preload/IPC API. The settings panel owns editing and saving `hub.url`; the sidebar reads the current config on click, handles empty/invalid values with Toasts, and delegates valid URLs to the existing safe external opener.

**Tech Stack:** Electron main process, Vue 3 `<script setup>`, TypeScript, SQLite-backed JSON config, existing Toast and IPC APIs.

## Global Constraints

- Support both `http://` and `https://` addresses.
- Trim leading and trailing whitespace before saving and opening.
- Empty address click feedback must be exactly `AutoforgeHub地址未设置`.
- Replace the sidebar label `脚本市场` with `进入AutoforgeHub` and remove the `Soon` badge.
- Do not add a database migration or a new Hub-specific IPC channel.

## File Map

- Modify `src/shared/types/script.ts`: define the optional `AppConfig.hub.url` shape used by main, preload, and renderer.
- Modify `src/main/db/repositories/config-repository.ts`: preserve and shallow-merge the new nested `hub` object on reads and writes.
- Modify `src/renderer/src/components/SettingsPanel.vue`: load, edit, trim, and save the Hub URL in a dedicated settings section.
- Modify `src/renderer/src/components/Sidebar.vue`: load config on click, show empty/invalid feedback, and open valid URLs through `system.openExternal`.

### Task 1: Extend persisted application configuration

**Files:**
- Modify: `src/shared/types/script.ts` near `AppConfig`.
- Modify: `src/main/db/repositories/config-repository.ts` in `getConfig`, `setConfig`, and `importConfig`.

**Interfaces:**
- Produces `AppConfig['hub']?: { url?: string }` for all existing config consumers.
- Preserves existing `window`, `browser`, and other config fields when any partial config is saved.

- [ ] **Step 1: Add the shared type**

Add this property to `AppConfig`:

```ts
  /** AutoforgeHub 网站地址 */
  hub?: {
    url?: string
  }
```

- [ ] **Step 2: Merge `hub` in repository reads and writes**

Use the same shallow-merge pattern as `browser` in all three repository return objects:

```ts
hub: { ...DEFAULT_CONFIG.hub, ...parsed.hub }
```

and:

```ts
hub: { ...current.hub, ...patch.hub }
```

and in `importConfig`:

```ts
hub: { ...merged.hub, ...config.hub }
```

Do not add a default URL; `DEFAULT_CONFIG` may remain `{ logLevel: 'INFO' }` because the spread yields an empty object for old configs.

- [ ] **Step 3: Run static validation for the type/repository change**

Run: `npm run lint`

Expected: ESLint completes successfully without new errors.

### Task 2: Add the AutoforgeHub setting UI

**Files:**
- Modify: `src/renderer/src/components/SettingsPanel.vue` in state initialization, `initializeSettings`, `save`, and the settings template.

**Interfaces:**
- Consumes `window.autoforge.config.get/set` and the new `AppConfig.hub.url` type.
- Produces a persisted `hub.url` value for the sidebar.

- [ ] **Step 1: Add reactive state and initialize it**

Declare:

```ts
const autoforgeHubUrl = ref('')
```

Inside `initializeSettings`, after reading the config, assign:

```ts
autoforgeHubUrl.value = config.hub?.url ?? ''
```

- [ ] **Step 2: Include the trimmed value in `save`**

Include this property in the object passed to `window.autoforge.config.set`:

```ts
hub: {
  url: autoforgeHubUrl.value.trim() || undefined
}
```

- [ ] **Step 3: Add the dedicated settings section**

Place a section near the product/version or external integration settings with:

```vue
<section class="space-y-3">
  <h2 class="text-[13px] font-medium sb-text-secondary">AutoforgeHub</h2>
  <p class="text-[11px] sb-text-faint">配置后可从侧边栏直接进入 AutoforgeHub。</p>
  <div>
    <label class="text-[12px] sb-text-muted">AutoforgeHub 地址</label>
    <input
      v-model="autoforgeHubUrl"
      type="url"
      placeholder="如 https://hub.example.com"
      class="mt-1 w-full h-9 px-3 rounded-lg sb-input border text-[13px] font-mono outline-none"
    />
    <p class="mt-1 text-[11px] sb-text-faint">支持 http:// 和 https:// 地址。</p>
  </div>
</section>
```

- [ ] **Step 4: Run renderer lint/build validation**

Run: `npm run lint`

Expected: Vue and TypeScript lint checks pass.

### Task 3: Replace the sidebar placeholder with browser navigation

**Files:**
- Modify: `src/renderer/src/components/Sidebar.vue` in `openScriptMarket` and the sidebar template button.

**Interfaces:**
- Consumes `window.autoforge.config.get` and `window.autoforge.system.openExternal`.
- Produces browser navigation or a Toast explaining why navigation did not occur.

- [ ] **Step 1: Replace the placeholder click handler**

Implement the handler as:

```ts
async function openAutoforgeHub(): Promise<void> {
  const config = await window.autoforge.config.get()
  const url = config.hub?.url?.trim()
  if (!url) {
    pushToast({ type: 'info', title: 'AutoforgeHub', message: 'AutoforgeHub地址未设置' })
    return
  }
  const opened = await window.autoforge.system.openExternal(url)
  if (!opened) {
    pushToast({ type: 'error', title: '打开失败', message: 'AutoforgeHub地址无效' })
  }
}
```

If config retrieval itself throws, catch it and show an error Toast using the existing `err instanceof Error ? err.message : ...` pattern rather than leaving an unhandled promise rejection.

- [ ] **Step 2: Update the button template**

Change the click binding to `@click="openAutoforgeHub"`, change visible text to `进入AutoforgeHub`, and remove the `Soon` badge span. Keep the Store icon and existing button classes.

- [ ] **Step 3: Run the application checks**

Run: `npm run lint`

Expected: no lint errors.

Run: `npm run build`

Expected: electron-vite production build completes and writes `out/` artifacts.

### Task 4: Verify behavior and preserve the design spec

**Files:**
- Test: existing application behavior through the built renderer; no new test file because the repository has no unit-test harness for Vue components.

- [ ] **Step 1: Verify configuration persistence**

Open Settings, enter an `https://` URL, save, close/reopen Settings, and confirm the exact trimmed URL remains. Change an unrelated setting and confirm the Hub URL remains unchanged.

- [ ] **Step 2: Verify navigation branches**

Confirm an empty URL produces the exact message `AutoforgeHub地址未设置`; valid `http://` and `https://` values invoke the system browser; malformed values produce `AutoforgeHub地址无效`.

- [ ] **Step 3: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors, only the four implementation files changed after the already-committed design/plan documents.
