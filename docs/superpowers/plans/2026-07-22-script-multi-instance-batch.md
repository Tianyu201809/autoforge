# Script Multi-Instance Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each script save up to 5 instance slots (name + env + params + browser) and run selected slots in parallel, while keeping single-run and capping concurrent running sessions per script at 5.

**Architecture:** Persist slots in `script_preferences.instance_slots` JSON. Lift the runner’s one-active-session early return; count running sessions per `scriptId` and reject when `count + starts > 5`. Batch starts pass `persistParams: false` and optional `browserOverride` / instance metadata. UI adds a batch panel plus DetailPanel/ScriptCard entry points; LogConsole tab titles prefer `instanceName`.

**Tech Stack:** Electron main/preload IPC, Vue 3 `<script setup>`, TypeScript, sql.js migrations, existing SchemaValueField / confirm / toast patterns.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-script-multi-instance-batch-design.md`
- Max **5** instance slots per script; max **5** concurrent running sessions per script (single + batch share the limit).
- Keep ▶ single-run; batch is a separate entry.
- Batch must **not** write `paramsByEnv`; single-run keeps default `persistParams: true`.
- No queueing past 5; no global cross-script concurrency cap; no JS process isolation work.
- Next DB migration number is **5** (ceiling today is 4).
- Validate with `npm run lint`, `npm run build`; add focused `node:test` helpers where pure logic fits (concurrency math / slot validation).

## File Map

- Create: `src/main/db/migrations/005-instance-slots.ts`
- Modify: `src/main/db/database.ts` — register v5
- Modify: `src/shared/types/script.ts` — `ScriptInstanceSlot`, preference/meta/session/item fields
- Create: `src/shared/instance-slots.ts` — validate/normalize slots (≤5, names, etc.)
- Create: `src/shared/instance-slots.test.ts`
- Modify: `src/main/db/row-mappers.ts`, `script-repository.ts` — column R/W + upsert SQL
- Modify: `src/main/services/script-store.ts` — get/set slots, applyPreference merge
- Modify: `src/main/services/script-runner.ts` — concurrency, start options, startBatch; enrich `activeSessionCount`
- Modify: `src/main/services/script-sdk.ts` / `python-script-runner.ts` call sites only if override is applied in runner before launch (prefer merge into a local `browser` var in runner)
- Modify: `src/shared/ipc-channels.ts`, `handlers.ts`, `preload/index.ts`, `env.d.ts`
- Modify: `src/renderer/src/composables/useScriptRunner.ts`
- Create: `src/renderer/src/components/BatchRunPanel.vue`
- Modify: `DetailPanel.vue`, `ScriptCard.vue`, `App.vue`, `LogConsole.vue` (optional type field), `MainContent.vue` if needed for emits

---

### Task 1: Migration + shared types + slot validation helpers

**Files:**
- Create: `src/main/db/migrations/005-instance-slots.ts`
- Modify: `src/main/db/database.ts`
- Modify: `src/shared/types/script.ts`
- Create: `src/shared/instance-slots.ts`
- Create: `src/shared/instance-slots.test.ts`
- Modify: `package.json` `test:unit` to also run the new test file (or space-separate both paths)

**Interfaces:**
- Produces:

```ts
export interface ScriptInstanceSlot {
  id: string
  name: string
  envId: string
  params: Record<string, string>
  browser?: { headless?: boolean }
}

// ScriptPreference.instanceSlots?: ScriptInstanceSlot[]
// ScriptMeta.instanceSlots?: ScriptInstanceSlot[]
// RunSession.instanceSlotId?: string; instanceName?: string
// ScriptItem.activeSessionCount: number
```

```ts
export const MAX_INSTANCE_SLOTS = 5
export const MAX_CONCURRENT_SESSIONS_PER_SCRIPT = 5

export function normalizeInstanceSlots(input: unknown): ScriptInstanceSlot[]
export function assertSlotsWritable(slots: ScriptInstanceSlot[]): void // throws if >5 or empty names
```

- [ ] **Step 1: Migration**

```ts
/** SQLite schema v5 — 脚本多实例槽 */
export const MIGRATION_005 = `
ALTER TABLE script_preferences ADD COLUMN instance_slots TEXT NOT NULL DEFAULT '[]';
`
```

Register in `database.ts` after v4:

```ts
  if (currentVersion < 5) {
    database.exec(MIGRATION_005)
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(5)
  }
```

Make v5 resilient like v4 if needed: if column missing, `ALTER` even when version ≥ 5 (optional; prefer simple v5 + document restart).

- [ ] **Step 2: Extend types** on `ScriptPreference`, `ScriptMeta`, `RunSession`, `ScriptItem` as above. Default `activeSessionCount` to `0` in enrich.

- [ ] **Step 3: Implement `instance-slots.ts` + tests** covering empty, trim names, reject length 6, preserve browser.headless.

- [ ] **Step 4: Run** `npm run test:unit` — pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrations/005-instance-slots.ts src/main/db/database.ts src/shared/types/script.ts src/shared/instance-slots.ts src/shared/instance-slots.test.ts package.json
git commit -m "feat: add instance_slots schema and validation helpers"
```

---

### Task 2: Preference persistence for instanceSlots

**Files:**
- Modify: `src/main/db/row-mappers.ts` — `ScriptPreferenceRow`, `rowToPreference`, `preferenceToRow`, `extractPreferenceFromMeta`, `rowToScriptBase` if JOIN includes the column
- Modify: `src/main/db/repositories/script-repository.ts` — `SCRIPT_JOIN` select list, `upsertPreference` INSERT/UPDATE columns
- Modify: `src/main/services/script-store.ts` — `applyPreference` merge `instanceSlots`; add:

```ts
getInstanceSlots(scriptId: string): ScriptInstanceSlot[]
setInstanceSlots(scriptId: string, slots: ScriptInstanceSlot[]): ScriptMeta
```

**Interfaces:**
- Consumes `normalizeInstanceSlots` / `assertSlotsWritable`
- `setInstanceSlots` calls assert then `mergePreference({ instanceSlots })`

- [ ] **Step 1: Wire column through mappers + upsert SQL** (include `instance_slots` in INSERT and ON CONFLICT UPDATE).

- [ ] **Step 2: Store getters/setters**; ensure `listAll` / `getById` surfaces `instanceSlots` on meta.

- [ ] **Step 3: Lint** `npm run lint` (ignore pre-existing unrelated errors if any; fix new ones).

- [ ] **Step 4: Commit**

```bash
git add src/main/db/row-mappers.ts src/main/db/repositories/script-repository.ts src/main/services/script-store.ts
git commit -m "feat: persist script instance slots in preferences"
```

---

### Task 3: Runner concurrency, start options, startBatch, enrich count

**Files:**
- Modify: `src/main/services/script-runner.ts`
- Optionally touch launch browser only inside this file by computing:

```ts
const browserForRun = {
  ...script.browser,
  ...options?.browserOverride
}
```

and pass `browserForRun` into `createScriptSdk` / `runPythonScript` instead of `script.browser`.

**Interfaces:**

```ts
export type StartOptions = {
  trigger?: ExecutionTrigger
  persistParams?: boolean // default true
  instanceSlotId?: string
  instanceName?: string
  browserOverride?: { headless?: boolean }
}

countRunningSessions(scriptId: string): number
start(scriptId, envId?, runtimeParams?, options?: StartOptions): Promise<RunSession>
startBatch(scriptId: string, slotIds: string[]): Promise<{
  ok: boolean
  started: RunSession[]
  error?: string
}>
// stopAllForScript already exists — keep; expose via IPC later
```

- [ ] **Step 1: Remove** early `getActiveSessionForScript` return. Replace with:

```ts
const running = this.countRunningSessions(scriptId)
if (running >= MAX_CONCURRENT_SESSIONS_PER_SCRIPT) {
  throw new Error(`该脚本最多同时运行 ${MAX_CONCURRENT_SESSIONS_PER_SCRIPT} 个实例，当前已满`)
}
```

- [ ] **Step 2: Gate `setScriptParams`**

```ts
if (options?.persistParams !== false) {
  scriptStore.setScriptParams(scriptId, resolvedEnvId, params)
}
```

- [ ] **Step 3: Attach** `instanceSlotId` / `instanceName` on `RunSession`; apply `browserForRun` at execute sites.

- [ ] **Step 4: Implement `startBatch`**
  - Load slots from store; resolve each id.
  - Pre-validate env/params for each (reuse store validators).
  - If `running + slotIds.length > 5` → `{ ok: false, started: [], error: '还可启动 N 个实例' }`.
  - Else sequential `await this.start(scriptId, slot.envId, slot.params, { persistParams: false, instanceSlotId: slot.id, instanceName: slot.name, browserOverride: slot.browser })`.
  - Return `{ ok: true, started }`.

- [ ] **Step 5: Update `enrichScriptItem`**

```ts
const activeSessions = scriptSessions.filter((s) => s.status === 'running')
const active = activeSessions[0]
const activeSessionCount = activeSessions.length
// status running iff activeSessionCount > 0
return { ..., activeSessionId: active?.id, activeSessionCount }
```

- [ ] **Step 6: Fix `restart` semantics later in renderer**; runner itself needs no multi-stop for restart yet.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/script-runner.ts
git commit -m "feat: allow up to 5 concurrent sessions per script with batch start"
```

---

### Task 4: IPC + preload + renderer typings

**Files:**
- Modify: `src/shared/ipc-channels.ts` — add:

```ts
SCRIPTS_GET_INSTANCE_SLOTS: 'scripts:get-instance-slots',
SCRIPTS_SET_INSTANCE_SLOTS: 'scripts:set-instance-slots',
RUNNER_START_BATCH: 'runner:start-batch',
RUNNER_STOP_BY_SCRIPT: 'runner:stop-by-script',
```

- Modify: `handlers.ts`, `preload/index.ts`, `env.d.ts`

**Interfaces:**

```ts
scripts.getInstanceSlots(scriptId: string): Promise<ScriptInstanceSlot[]>
scripts.setInstanceSlots(scriptId: string, slots: ScriptInstanceSlot[]): Promise<ScriptItem | ScriptMeta>
runner.start(scriptId, envId?, params?, options?: StartOptions): Promise<RunSession>
runner.startBatch(scriptId, slotIds: string[]): Promise<{ ok: boolean; started: RunSession[]; error?: string }>
runner.stopByScript(scriptId: string): Promise<void>
```

- [ ] **Step 1: Handlers**
  - `RUNNER_START`: forward 4th arg `options` into `runner.start`.
  - `RUNNER_START_BATCH` → `startBatch`.
  - `RUNNER_STOP_BY_SCRIPT` → `runner.stopAllForScript(scriptId)`.
  - slots get/set via scriptStore; return enriched item after set if easy.

- [ ] **Step 2: Preload + env.d.ts** mirror signatures.

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc/handlers.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: expose instance slots and batch runner IPC"
```

---

### Task 5: useScriptRunner + App log titles + restart/stop behavior

**Files:**
- Modify: `src/renderer/src/composables/useScriptRunner.ts`
- Modify: `src/renderer/src/App.vue` — `scriptNameForSession`, `handleStart` unchanged for single; add batch open state later in Task 6

**Interfaces:**
- `start(..., options?)`
- `startBatch(scriptId, slotIds)`
- `stopByScript(scriptId)`
- `restart`: stop **all** running sessions for script (`stopByScript`) then single `start` (preserve prior single-restart intent)

- [ ] **Step 1: Extend composable** with try/catch toasts on batch errors (`result.ok === false`).

- [ ] **Step 2: Log tab title**

```ts
function scriptNameForSession(sessionId: string): string {
  const session = runner.sessions.value.find((s) => s.id === sessionId)
  if (!session) return sessionId.slice(0, 8)
  if (session.instanceName?.trim()) return session.instanceName.trim()
  return filteredScripts.value.find((s) => s.id === session.scriptId)?.name ?? session.scriptId
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/composables/useScriptRunner.ts src/renderer/src/App.vue
git commit -m "feat: wire batch runner APIs and instance log tab titles"
```

---

### Task 6: BatchRunPanel UI

**Files:**
- Create: `src/renderer/src/components/BatchRunPanel.vue`
- Modify: `App.vue` — `showBatchRun`, selected script id, open/close, mount panel
- Modify: `DetailPanel.vue` —「批量」button next to run toggle; emit `openBatch`
- Modify: `ScriptCard.vue` — menu item「批量运行…」; emit `batchRun`
- Modify: `MainContent.vue` — forward `batchRun` if card emits

**Interfaces:**
- Props: `open: boolean`, `script: ScriptItem`, `environments: EnvironmentProfile[]`, `runner`, `activeSessionCount`
- Emits: `close`, `refresh`
- Internal: load/save slots via `window.autoforge.scripts.getInstanceSlots/setInstanceSlots`
- UI per spec: checklist, add (disabled at 5), edit form (name, env select, SchemaValueField for paramSchema, headless checkbox), Start selected / Stop all, show `n/5`

- [ ] **Step 1: Scaffold panel** (Teleport modal matching CategoryManagerModal patterns).

- [ ] **Step 2: CRUD slots** in local draft; Save writes full array; Add uses `crypto.randomUUID()` or `window.crypto.randomUUID()`.

- [ ] **Step 3: Start selected** → `runner.startBatch`; on failure toast `error`; on success track each session in App (emit started ids or call inject). Prefer emit `started: [sessionId]` and let App `trackSession`.

- [ ] **Step 4: Wire DetailPanel + ScriptCard + App**.

- [ ] **Step 5: Show running count on DetailPanel when `activeSessionCount > 0` (e.g. badge `x/5`). When stopping from DetailPanel while multi-running, stop **current viewing session** only (keep existing); optionally secondary control later — YAGNI: keep stop = activeSessionId only;「停止全部」only in batch panel.

- [ ] **Step 6: ScriptCard「运行」** — allow start when `activeSessionCount < 5` (not merely `status !== 'running'`). Disable run only when `activeSessionCount >= 5`. Stop button: stop `activeSessionId` (first) OR emit stopByScript — prefer stop first session for card menu stop; add「停止全部」only in batch panel.

- [ ] **Step 7: Lint + build**

```bash
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/BatchRunPanel.vue src/renderer/src/App.vue src/renderer/src/components/DetailPanel.vue src/renderer/src/components/ScriptCard.vue src/renderer/src/components/MainContent.vue
git commit -m "feat: add batch run panel and entry points"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1:** `npm run dev`
- [ ] **Step 2: Checklist**
  1. Add 5 slots, 6th blocked.
  2. Select 2 → start → two log tabs with instance names; `paramsByEnv` unchanged for that env.
  3. Single ▶ still persists params.
  4. With 4 running, selecting 2 to batch → rejected with remaining 1.
  5. Stop all from panel clears running for that script.
  6. Card shows running state with count; can start another until 5.
- [ ] **Step 3:** Fix issues; commit if needed.

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| `instance_slots` + types | 1–2 |
| Slot ≤5 validation | 1–2, 6 |
| Remove single-session early return; ≤5 concurrent | 3 |
| `persistParams` / browserOverride / session meta | 3 |
| startBatch precheck | 3–4 |
| stopByScript IPC | 4 (method exists) |
| `activeSessionCount` | 3, 6 |
| Batch UI + entries | 6 |
| Log instance names | 5 |
| Keep single-run | 5–6 |

**Type consistency:** `ScriptInstanceSlot` / `StartOptions` / `MAX_CONCURRENT_SESSIONS_PER_SCRIPT = 5` used throughout.  
**Placeholder scan:** none intentional.
