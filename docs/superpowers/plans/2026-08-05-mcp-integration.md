# Autoforge MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, opt-in MCP control surface that lets same-machine agents inspect, run, and edit Autoforge scripts through a bundled stdio adapter without duplicating application business logic.

**Architecture:** Keep the MCP client-facing process separate from the Electron desktop process. The bundled `--mcp-stdio` entry uses the same installed executable (and a Node/tsx entry in development), while the running Autoforge main process owns a token-authenticated Named Pipe or Unix Socket control server. Both renderer IPC and MCP call one `AutoforgeControlFacade`; a main-process `RunEventStore` provides bounded logs, session snapshots, cursor reads, and async waits.

**Tech Stack:** Electron 34, Node.js/TypeScript, Vue 3, the official `@modelcontextprotocol/sdk`, newline-delimited JSON over local IPC, existing `ScriptRegistry`, `ScriptWorkspace`, `ScriptStore`, `ScriptRunnerService`, `ExecutionHistoryService`, and `node:test` with `tsx`.

## Global Constraints

- MCP is disabled by default and can only be enabled or disabled from the Electron settings UI.
- MCP clients use standard `stdio`; the adapter-to-app transport is Windows Named Pipe or macOS/Linux Unix Socket only; do not add a TCP listener or extend the `127.0.0.1:19276` Hub bridge.
- Autoforge must already be running; the adapter must never start the desktop app.
- `autoforge_start_script` is asynchronous and returns a session immediately; `persistParams` defaults to false.
- Reads and run/stop operations do not require confirmation; all file/script/environment/parameter mutations and `persistParams: true` require `confirm: true` on that call.
- `secret: true` env/param fields are write-only through MCP; responses, errors, logs, and audit records never contain their values.
- Internal control frames are JSONL with an 8 MiB maximum frame, 4 MiB maximum file read/write, 8 MiB maximum create payload, eight connections, 16 in-flight requests per connection, 30-second ordinary request timeout, and a `wait_for_session` timeout capped at 60 seconds.
- Runtime logs are memory-only and bounded to 2,000 lines or 2 MiB per session; execution history remains the restart-safe source of terminal records.
- Local script imports accept absolute local files/directories only; no MCP URL download and no shell execution.
- The packaged client command must not require a separately installed Node runtime; development may use the repository's Node/tsx runtime.
- Do not modify third-party agent configuration files automatically; provide platform-specific configuration text for copying.
- Keep the design scoped to scripts, files, environments, parameters, execution sessions, logs, history, and base resources. Prompts, dependency management, categories, schedules, windows, and arbitrary shell are future capability packs.

---

### Task 1: Add shared MCP contracts and AppConfig state

**Files:**
- Create: `src/shared/mcp-control-protocol.ts`
- Create: `src/shared/mcp-types.ts`
- Modify: `src/shared/types/script.ts`
- Modify: `src/shared/ipc-channels.ts`
- Test: `src/shared/mcp-control-protocol.test.ts`
- Test: `src/shared/mcp-types.test.ts`

**Interfaces:**
- Produces `MCP_PROTOCOL_VERSION`, `McpEndpointDescriptor`, `ControlRequest`, `ControlResponse`, `ControlEvent`, `McpErrorCode`, `McpStatus`, and public MCP DTO types for later tasks.
- `AppConfig.mcp?: { enabled?: boolean }` is the only persisted MCP preference; runtime token and connection details are never stored in `AppConfig`.

Define the cross-task input/output types in `src/shared/mcp-types.ts` so later tasks do not invent parallel shapes:

Import existing `ScriptItem`, `ScriptFileContent`, `LogLine`, `ScriptManifest`, `ScriptIcon`, `AppEnv`, `EnvironmentProfile`, `ExecutionHistoryQuery`, `ExecutionHistoryPage`, and `RunSession` types from their current shared modules rather than redefining them.

```ts
export interface ScriptListInput {
  query?: string
  status?: 'all' | 'running' | 'idle' | 'error'
  archived?: boolean
  offset?: number
  limit?: number
  sortBy?: 'name' | 'recentRun' | 'importedAt'
  sortOrder?: 'asc' | 'desc'
}

export interface ScriptListOutput {
  scripts: ScriptItem[]
  total: number
}

export interface ReadScriptFileInput {
  scriptId: string
  relativePath: string
  limit?: number
}

export interface CreateScriptFilePayload {
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export interface CreateScriptInput {
  manifest: ScriptManifest
  files: CreateScriptFilePayload[]
}

export interface WriteScriptFileInput {
  scriptId: string
  relativePath: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export interface UpdateScriptMetaInput {
  scriptId: string
  patch: { name?: string; description?: string; icon?: ScriptIcon; category?: string; categoryLabel?: string; browser?: { headless?: boolean } }
}

export interface GetEnvironmentInput {
  envId: string
  scriptId?: string
}

export interface SanitizedEnvironment {
  id: string
  name: string
  description?: string
  isDefault?: boolean
  variables: Record<string, string | { present: boolean }>
}

export interface SetScriptValuesInput {
  scriptId: string
  envId: string
  values: Record<string, string>
}

export interface StartScriptInput {
  scriptId: string
  envId?: string
  params?: Record<string, string>
  persistParams?: boolean
  browserOverride?: { headless?: boolean }
}

export interface LogCursorPage {
  lines: LogLine[]
  nextCursor: number
  gap: boolean
}

export interface McpStatus {
  enabled: boolean
  running: boolean
  appVersion: string
  appEnv: AppEnv
  transport?: McpTransportKind
  endpoint?: string
  connectionCount: number
  lastConnectionAt?: string
}

export interface McpClientConfig {
  command: string
  args: string[]
  appEnv: AppEnv
  displayCommand: string
}
```

- [ ] **Step 1: Write failing protocol and DTO tests**

Add tests for JSON-safe discriminated unions, descriptor fields, error-code membership, and `AppConfig` accepting `{ mcp: { enabled: true } }` while not exposing a token field. The protocol test must assert the following shapes compile and round-trip through `JSON.stringify`/`JSON.parse`:

```ts
const request: ControlRequest = {
  type: 'request',
  id: '42',
  method: 'scripts.get',
  params: { scriptId: 'script-1' }
}

const error: ControlResponse = {
  type: 'response',
  id: '42',
  ok: false,
  error: { code: 'not_found', message: 'script not found', retryable: false }
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --import tsx --test src/shared/mcp-control-protocol.test.ts src/shared/mcp-types.test.ts`

Expected: FAIL because the new shared modules and MCP config field do not exist.

- [ ] **Step 3: Implement the shared contracts**

Define the protocol without Electron dependencies:

```ts
export const MCP_PROTOCOL_VERSION = '1.0'

export type McpTransportKind = 'named-pipe' | 'unix-socket'

export interface McpEndpointDescriptor {
  protocolVersion: string
  appVersion: string
  appEnv: 'development' | 'production'
  pid: number
  transport: McpTransportKind
  endpoint: string
  token: string
  createdAt: string
}

export interface ControlRequest {
  type: 'request'
  id: string
  method: string
  params?: unknown
}

export interface ControlResponse {
  type: 'response'
  id: string
  ok: true
  result: unknown
  error?: never
}

export interface ControlErrorResponse {
  type: 'response'
  id: string
  ok: false
  error: { code: McpErrorCode; message: string; retryable: boolean; details?: unknown }
  result?: never
}

export interface ControlEvent {
  type: 'event'
  event: 'session.updated' | 'log.appended' | 'log.gap'
  data: unknown
}
```

Add `McpStatus`, `McpClientConfig`, script/file/environment/session DTOs, cursor response types, and the complete error-code union from the approved spec. Extend `AppConfig` with optional `mcp.enabled` only.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `node --import tsx --test src/shared/mcp-control-protocol.test.ts src/shared/mcp-types.test.ts`

Expected: PASS with no runtime dependency on Electron.

- [ ] **Step 5: Review the shared contract before moving on**

Check that no DTO contains `workspacePath` unless explicitly requested as a sanitized display field, no descriptor type is exported to renderer as a token-bearing object, and all later task method names use the same `McpErrorCode` spelling.

### Task 2: Extract a shared application runtime and control facade

**Files:**
- Create: `src/main/services/runtime-container.ts`
- Create: `src/main/services/autoforge-control-facade.ts`
- Create: `src/main/services/mcp-sanitizers.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/index.ts`
- Test: `src/main/services/autoforge-control-facade.test.ts`
- Test: `src/main/services/mcp-sanitizers.test.ts`

**Interfaces:**
- `createRuntimeContainer(getWindow: () => BrowserWindow | null): AutoforgeRuntime` returns one `ScriptRunnerService` and one `SchedulerService`.
- `registerIpcHandlers(getWindow, runtime)` consumes the shared runtime instead of constructing a private runner.
- `getRunner()` continues returning the shared runner for existing callers.
- `createAutoforgeControlFacade(runtime): AutoforgeControlFacade` produces the stable service boundary consumed by the control server.
- `McpAuditEntry` is defined in `src/main/services/mcp-audit.ts`; `McpControlServerOptions` is defined in `src/main/services/mcp-control-server.ts` so shared DTOs never import main services.

The facade must expose these exact methods:

```ts
interface AutoforgeControlFacade {
  listScripts(input: ScriptListInput): ScriptListOutput
  getScript(scriptId: string): ScriptItem | null
  listScriptFiles(scriptId: string): ScriptWorkspaceFilesInfo | null
  readScriptFile(input: ReadScriptFileInput): ScriptFileContent | null
  createScript(input: CreateScriptInput): ScriptItem
  importScript(sourcePath: string): ScriptItem
  writeScriptFile(input: WriteScriptFileInput): ScriptItem | null
  updateScriptMeta(input: UpdateScriptMetaInput): ScriptItem | null
  deleteScript(scriptId: string): boolean
  listEnvironments(): EnvironmentProfile[]
  getEnvironment(input: GetEnvironmentInput): SanitizedEnvironment | null
  createEnvironment(profile: Omit<EnvironmentProfile, 'id'>): EnvironmentProfile
  updateEnvironment(id: string, patch: Partial<EnvironmentProfile>): EnvironmentProfile | null
  deleteEnvironment(id: string): boolean
  setScriptEnv(input: SetScriptValuesInput): ScriptItem | null
  setScriptParams(input: SetScriptValuesInput): ScriptItem | null
  startScript(input: StartScriptInput): Promise<RunSession>
  stopSession(sessionId: string): RunSession | null
  stopScript(scriptId: string): void
  listSessions(): RunSession[]
  getSession(sessionId: string): RunSession | undefined
  queryHistory(query: ExecutionHistoryQuery): ExecutionHistoryPage
}
```

- [ ] **Step 1: Write failing runtime and facade tests**

Create a fake runtime with a stub runner and scheduler. Test that two facade calls use the same runner object, imports/deletes trigger one scheduler reload, missing IDs return `null` or `not_found`-ready values, and `startScript` passes `persistParams: false` when omitted. Add sanitizer tests showing non-secret values survive and secret values become `{ present: true }` without echoing the raw value.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --import tsx --test src/main/services/autoforge-control-facade.test.ts src/main/services/mcp-sanitizers.test.ts`

Expected: FAIL because the shared runtime, facade, and sanitizer modules are not present.

- [ ] **Step 3: Move Runner/Scheduler construction into `runtime-container.ts`**

Instantiate `ScriptRunnerService(getWindow)` once, construct `SchedulerService` with that runner's scheduled-start callback, and update `registerIpcHandlers` to receive the container. Preserve the existing `getRunner()` export and all current IPC behavior.

- [ ] **Step 4: Implement the facade and sanitizers**

Delegate to `scriptRegistry`, `scriptWorkspace`, `scriptStore`, `executionHistory`, and the shared runner. Keep scheduler reload inside facade mutations. Use `relative`/`realpath` checks before every workspace file operation, and expose only JSON-safe DTOs. `getEnvironment` must require a script context to return non-secret values; without one it returns variable keys and presence only.

- [ ] **Step 5: Run focused tests plus existing runner tests**

Run: `node --import tsx --test src/main/services/autoforge-control-facade.test.ts src/main/services/mcp-sanitizers.test.ts src/main/services/browser-window-launch.test.mjs src/main/services/browser-lifecycle.test.mjs src/main/services/python-process-exit.test.mjs`

Expected: PASS, with the existing IPC/renderer behavior unchanged.

### Task 3: Implement safe script creation, file mutation, and rollback primitives

**Files:**
- Modify: `src/main/services/script-workspace.ts`
- Modify: `src/main/services/autoforge-control-facade.ts`
- Create: `src/main/services/mcp-workspace-io.ts`
- Test: `src/main/services/mcp-workspace-io.test.ts`

**Interfaces:**
- `createScriptFromPayload(input: CreateScriptInput): ScriptMeta`
- `writeWorkspaceFileAtomic(script: ScriptMeta, relativePath: string, content: Buffer): void`
- `assertSafeWorkspacePath(workspacePath: string, relativePath: string): string`
- `rollbackWorkspaceActivation(targetDir: string, backupDir: string, stagingDir: string): void`

- [ ] **Step 1: Write failing workspace security and rollback tests**

Cover absolute paths, `..`, null bytes, symlink escape, 4 MiB file rejection, 8 MiB create payload rejection, invalid manifest rollback, successful manifest metadata synchronization, UTF-8 text, and base64 binary write.

- [ ] **Step 2: Run the focused workspace tests and verify failure**

Run: `node --import tsx --test src/main/services/mcp-workspace-io.test.ts`

Expected: FAIL because MCP-specific workspace IO does not exist and the existing path helper is not sufficient for the new boundary checks.

- [ ] **Step 3: Implement path and size validation**

Resolve the workspace root with `realpath`, resolve the candidate with `realpath` when it exists, and use `relative(root, candidate)` to reject paths that leave the root. Reject empty paths, absolute paths, `..`, null bytes, and symlinks that resolve outside the script directory. Enforce 4 MiB per read/write and 8 MiB for aggregate create payloads.

- [ ] **Step 4: Implement staging and atomic writes**

Create a temporary script directory under the app data temp root, write manifest and files there, run `validatePackageDirectory`, activate with rename, then update the registry. For existing files, write a sibling temporary file and rename over the target. If validation or registry update fails, remove staging and restore the backup before rethrowing a typed `validation_failed` or `internal` error.

- [ ] **Step 5: Run focused tests and the current script workspace tests**

Run: `node --import tsx --test src/main/services/mcp-workspace-io.test.ts src/shared/category-tree.test.ts src/shared/instance-slots.test.ts`

Expected: PASS with no changes to existing import semantics outside the new MCP facade path.

### Task 4: Add the main-process RunEventStore and audit sink

**Files:**
- Create: `src/main/services/run-event-store.ts`
- Create: `src/main/services/mcp-audit.ts`
- Modify: `src/main/services/log-bus.ts`
- Modify: `src/main/index.ts`
- Test: `src/main/services/run-event-store.test.ts`
- Test: `src/main/services/mcp-audit.test.ts`

**Interfaces:**
- `RunEventStore.appendLog(line: LogLine): void`
- `RunEventStore.updateSession(session: RunSession): void`
- `RunEventStore.getLogs(sessionId: string, cursor: number, limit: number): LogCursorPage`
- `RunEventStore.getSession(sessionId: string): RunSession | undefined`
- `RunEventStore.waitForTerminal(sessionId: string, timeoutMs: number): Promise<RunSession>`
- `RunEventStore.dispose(): void`
- `McpAuditService.record(entry: McpAuditEntry): void`

- [ ] **Step 1: Write failing ring-buffer, wait, and audit tests**

Assert that seq values are monotonic, the 2,000-line/2 MiB policy evicts old records, stale cursors produce `log_gap`, terminal waits resolve once, timeout listeners are removed, audit entries exclude raw values, and a 10 MiB audit file rotates to one backup.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --import tsx --test src/main/services/run-event-store.test.ts src/main/services/mcp-audit.test.ts`

Expected: FAIL because both services are new.

- [ ] **Step 3: Subscribe the event store once in the main process**

Subscribe to `logBus` `log` and `session` events during runtime initialization, clone incoming DTOs, and do not depend on renderer windows. Wire `dispose()` before database close and app quit.

- [ ] **Step 4: Implement cursor pages, gap markers, and cancellable waits**

Use per-session arrays with byte accounting, return `{ lines, nextCursor, gap }`, and resolve waits for `success`, `error`, or `stopped`. Use a `finally` block to remove timeout and EventEmitter listeners.

- [ ] **Step 5: Implement structured audit rotation and run tests**

Write JSONL to `userData/runtime/mcp-audit.jsonl`, omit values and file content, rotate at 10 MiB, and run the focused test command again. Expected: PASS.

### Task 5: Build the token-authenticated local control server

**Files:**
- Create: `src/main/services/mcp-endpoint.ts`
- Create: `src/main/services/mcp-control-server.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/shared/ipc-channels.ts`
- Test: `src/main/services/mcp-endpoint.test.ts`
- Test: `src/main/services/mcp-control-server.test.ts`

**Interfaces:**
- `createMcpEndpointDescriptor(appVersion: string, appEnv: AppEnv): McpEndpointDescriptor`
- `writeMcpEndpointDescriptor(descriptor: McpEndpointDescriptor): void`
- `readMcpEndpointDescriptor(appEnv: AppEnv): McpEndpointDescriptor | null`
- `removeMcpEndpointDescriptor(appEnv: AppEnv): void`
- `startMcpControlServer(options: McpControlServerOptions): Promise<McpStatus>`
- `stopMcpControlServer(): Promise<void>`
- `getMcpControlStatus(): McpStatus`

Define these main-only types next to their implementations:

```ts
export interface McpAuditEntry {
  ts: string
  connectionId: string
  requestId: string
  operation: string
  target?: string
  confirmed: boolean
  outcome: 'success' | 'rejected' | 'error'
  errorCode?: McpErrorCode
}

export interface McpControlServerOptions {
  appVersion: string
  appEnv: AppEnv
  facade: AutoforgeControlFacade
  eventStore: RunEventStore
  audit: McpAuditService
  onStatus?: (status: McpStatus) => void
}
```

- [ ] **Step 1: Write failing endpoint, handshake, and routing tests**

Use a temporary Unix Socket on the current platform and a fake facade. Test descriptor creation, 32-byte token generation, stale cleanup, first-message handshake, bad-token closure, `scripts.get` routing, malformed JSON, frame limit, connection limit, request timeout, and clean shutdown.

- [ ] **Step 2: Run focused control-server tests and verify failure**

Run: `node --import tsx --test src/main/services/mcp-endpoint.test.ts src/main/services/mcp-control-server.test.ts`

Expected: FAIL because endpoint and server modules are new.

- [ ] **Step 3: Implement cross-platform endpoint helpers**

Use the existing `getAppUserDataPath()` and `appEnv` conventions. Create `runtime` with user-only permissions, generate an endpoint suffix that prevents development/production collisions, write descriptors atomically, and remove descriptors only when they still belong to the current PID/token.

- [ ] **Step 4: Implement JSONL server lifecycle and handshake**

Create the Named Pipe on Windows and Unix Socket elsewhere, enforce the global limits, require the handshake request before dispatch, compare tokens with `timingSafeEqual`, and close all sockets during stop. Do not bind any TCP port.

- [ ] **Step 5: Implement command routing and audit hooks**

Map internal methods to facade methods, parse/validate each input with the shared types, enforce `confirm` before mutation, translate typed exceptions to `ControlErrorResponse`, and call `McpAuditService.record` for every run/stop and mutation. Run focused tests and expect PASS.

### Task 6: Implement the stdio MCP adapter and public tools/resources

**Files:**
- Create: `src/mcp/control-client.ts`
- Create: `src/mcp/stdio-server.ts`
- Create: `src/mcp/tool-definitions.ts`
- Create: `src/mcp/resource-definitions.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main/index.ts`
- Test: `src/mcp/control-client.test.ts`
- Test: `src/mcp/tool-definitions.test.ts`
- Test: `src/mcp/resource-definitions.test.ts`

**Interfaces:**
- `McpControlClient.connect(options: EndpointDiscoveryOptions): Promise<void>`
- `McpControlClient.request<T>(method: string, params?: unknown): Promise<T>`
- `McpControlClient.onEvent(listener: (event: ControlEvent) => void): () => void`
- `McpControlClient.close(): Promise<void>`
- `createAutoforgeMcpServer(client: McpControlClient): McpServer`
- `runStdioServer(argv: string[]): Promise<void>`

Define the adapter-only discovery type in `src/mcp/control-client.ts`:

```ts
export interface EndpointDiscoveryOptions {
  appEnv: AppEnv
  endpoint?: string
}
```

- [ ] **Step 1: Add the SDK dependency and write failing adapter tests**

Add `@modelcontextprotocol/sdk` as a production dependency and create tests with a fake control client. Assert that `tools/list` contains exactly the approved `autoforge_` tool names, resources contain exactly the five approved URI templates, mutation tool schemas require `confirm`, and tool errors map to MCP `isError: true` with structured codes.

- [ ] **Step 2: Run focused adapter tests and verify failure**

Run: `node --import tsx --test src/mcp/control-client.test.ts src/mcp/tool-definitions.test.ts src/mcp/resource-definitions.test.ts`

Expected: FAIL because the adapter modules and SDK dependency are not present.

- [ ] **Step 3: Implement the local control client**

Discover `runtime/mcp-endpoint.json` using `--app-env`, optionally honor `--endpoint`, connect to the advertised transport, send the handshake, correlate response IDs, buffer JSONL frames, forward events, and retry only for `app_not_ready`. Never auto-launch the desktop app and never print token or descriptor contents to stdout.

- [ ] **Step 4: Register tools and resources with the official SDK**

Implement every tool in the approved API table, passing validated arguments to the internal method names. Use bounded `read_script_file` output, return session IDs from start, expose cursor pages for logs, and apply the sanitizer to environment and parameter responses. Register resources as read-only templates and emit resource-update notifications only when the client supports them.

- [ ] **Step 5: Add stdio entrypoints and run adapter tests**

Implement `runStdioServer(argv)` with `StdioServerTransport`. The development command is `node --import tsx src/mcp/stdio-server.ts --app-env development`; the packaged command is routed through `Autoforge --mcp-stdio --app-env production`. Run the focused tests and expect PASS.

### Task 7: Add Electron MCP settings and preload APIs

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Modify: `src/renderer/src/components/SettingsPanel.vue`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/index.ts`
- Test: `src/renderer/src/components/mcp-settings.test.mjs`

**Interfaces:**
- `window.autoforge.mcp.getStatus(): Promise<McpStatus>`
- `window.autoforge.mcp.setEnabled(enabled: boolean): Promise<McpStatus>`
- `window.autoforge.mcp.rotateToken(): Promise<McpStatus>`
- `window.autoforge.mcp.getClientConfig(): Promise<McpClientConfig>`
- `window.autoforge.mcp.onStatus(callback: (status: McpStatus) => void): () => void`

- [ ] **Step 1: Write failing renderer contract tests**

Test the pure status/config formatting helper used by `SettingsPanel.vue`: disabled status displays no endpoint/token, enabled status displays environment and transport, and generated config uses `Autoforge --mcp-stdio --app-env production` without a token field. Test that toggling calls `setEnabled` exactly once and that rotate shows a success state without rendering the token.

- [ ] **Step 2: Run the focused renderer test and verify failure**

Run: `node --import tsx --test src/renderer/src/components/mcp-settings.test.mjs`

Expected: FAIL because MCP preload APIs, IPC channels, and settings UI do not exist.

- [ ] **Step 3: Add main-process MCP management handlers**

Register status, enable/disable, rotate-token, and client-config IPC handlers. `setEnabled(false)` must stop the control server and persist only `mcp.enabled: false`; `rotateToken()` must close old connections and return status metadata without token; `getClientConfig()` returns platform-specific command/args only.

- [ ] **Step 4: Expose typed preload APIs**

Add `MCP_STATUS`, `MCP_SET_ENABLED`, `MCP_ROTATE_TOKEN`, `MCP_CLIENT_CONFIG`, and `EVENT_MCP_STATUS` channels. Keep the token out of `window.autoforge` and out of renderer structured-clone payloads.

- [ ] **Step 5: Add the MCP settings section**

Extend `SettingsSectionId` and `SETTINGS_SECTIONS` in `SettingsPanel.vue`, add an enable checkbox, status card, copy-config button, rotate button, and disabled/offline/error states. Use existing `useToast`, save-state styling, and `navigator.clipboard`; never show or copy the token. Run the renderer test and expect PASS.

### Task 8: Package the adapter and document client setup

**Files:**
- Modify: `package.json`
- Modify: `electron.vite.config.ts`
- Modify: `src/main/index.ts`
- Create: `docs/mcp.md`
- Modify: `README.md`
- Test: `scripts/mcp-package-smoke.mjs`

**Interfaces:**
- `Autoforge --mcp-stdio --app-env production` starts only the stdio adapter branch.
- `npm run mcp -- --app-env development` starts the development adapter.

- [ ] **Step 1: Write the package smoke test**

Create a script that launches the built adapter entry with `--help` or an injected offline endpoint, asserts that no BrowserWindow is created, asserts stdout contains only MCP protocol output, and asserts no token/descriptor content is printed.

- [ ] **Step 2: Run the smoke test and verify failure**

Run: `node scripts/mcp-package-smoke.mjs`

Expected: FAIL because the package script and `--mcp-stdio` branch do not exist.

- [ ] **Step 3: Add development and packaged entry routing**

Add the `mcp` npm script, ensure the main bundle includes `src/mcp/stdio-server.ts`, and branch before `configureAppUserDataPath()`/desktop window setup when `--mcp-stdio` is present. The packaged branch must not call `createWindow`, initialize the database, or start the control server.

- [ ] **Step 4: Verify electron-builder includes adapter code and SDK**

Update build inputs/files only as needed so `out/mcp` or the bundled main entry and `@modelcontextprotocol/sdk` are present in installed artifacts. Keep `node_modules/sql.js` and existing resources unchanged.

- [ ] **Step 5: Write client setup documentation and run the smoke test**

Document enabling MCP in Electron, copying the platform config, the development command, the app-running prerequisite, token auto-discovery, disable/rotate behavior, secret masking, and the exact non-goals. Run `node scripts/mcp-package-smoke.mjs`; expected: PASS.

### Task 9: Add end-to-end MCP integration coverage and final verification

**Files:**
- Create: `src/mcp/mcp-integration.test.ts`
- Create: `src/main/services/mcp-test-harness.ts`
- Modify: `package.json`
- Modify: `docs/mcp.md`

**Interfaces:**
- `createMcpTestHarness(): Promise<{ facade: AutoforgeControlFacade; server: McpControlServer; close(): Promise<void> }>`
- `spawnStdioAdapter(args: string[]): ChildProcess`

- [ ] **Step 1: Write the failing end-to-end scenarios**

Cover these exact flows: disabled app returns `app_not_ready`; enabled app completes handshake; list/get/read works; `confirm` missing blocks create/write/delete/environment changes; secret values never echo; start returns a session; wait and log cursor observe a fake long run; stop changes status; history remains queryable; token rotation invalidates the old adapter; malformed manifest leaves registry/workspace unchanged.

- [ ] **Step 2: Run the integration test and verify failure**

Run: `node --import tsx --test src/mcp/mcp-integration.test.ts`

Expected: FAIL because the harness and complete MCP path are not implemented.

- [ ] **Step 3: Implement the in-process test harness**

Initialize a temporary app-data root/database, construct the shared runtime/facade/event store, start the local control server on a temporary Unix Socket where supported, and expose deterministic cleanup that closes sockets, listeners, audit handles, and database resources.

- [ ] **Step 4: Add child-process stdio coverage**

Spawn the development adapter with `node --import tsx`, exchange MCP initialize/list/call messages, assert stdout contains only protocol frames, and parse structured errors. Use fake runner methods for deterministic long-running sessions and real workspace validation for CRUD/rollback.

- [ ] **Step 5: Run all focused and repository checks**

Run in order:

```text
node --import tsx --test src/shared/mcp-control-protocol.test.ts src/shared/mcp-types.test.ts src/main/services/autoforge-control-facade.test.ts src/main/services/mcp-sanitizers.test.ts src/main/services/mcp-workspace-io.test.ts src/main/services/run-event-store.test.ts src/main/services/mcp-audit.test.ts src/main/services/mcp-endpoint.test.ts src/main/services/mcp-control-server.test.ts src/mcp/control-client.test.ts src/mcp/tool-definitions.test.ts src/mcp/resource-definitions.test.ts src/mcp/mcp-integration.test.ts
npm run test:unit
npm run lint
npm run build
node scripts/mcp-package-smoke.mjs
```

Expected: all focused tests, existing unit tests, lint, production build, and package smoke test pass. Platform CI must additionally exercise Windows Named Pipe and macOS/Linux Unix Socket before release.

## Self-Review Checklist

- [x] Every approved spec capability maps to a concrete task: scripts/files, environments/parameters, execution sessions, logs, history, resources, settings toggle, token lifecycle, packaging, and tests.
- [x] Excluded capabilities are repeated in Global Constraints, Task 8 documentation, and the design non-goals.
- [x] Later interfaces use the same names as earlier contracts: `McpEndpointDescriptor`, `ControlRequest`, `McpControlClient`, `AutoforgeControlFacade`, `RunEventStore`, and `McpAuditService`.
- [x] No task requires a network TCP listener, auto-launches Autoforge, stores a token in AppConfig, or exposes secrets.
- [x] No unresolved implementation placeholder remains.
- [x] Each task has explicit files, tests, commands, and expected outcomes.
