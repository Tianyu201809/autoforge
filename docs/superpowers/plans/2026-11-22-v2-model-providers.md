# v2.0 Model Providers and Agent Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add secure model profiles and one normalized streaming/tool-call interface for OpenAI, Anthropic, Gemini, and OpenAI-compatible providers.

**Architecture:** Keep provider transport in main-process adapters. Store non-secret profile data in `AppConfig` and API keys in an encrypted credential store. Normalize streaming text, tool calls, cancellation, usage, and provider errors before they reach the Agent service.

**Tech Stack:** Electron `net.fetch`, Node streams, TypeScript, Electron `safeStorage`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-v2-agent-workspace-design.md`

## Global Constraints

- No provider key enters renderer state, SQLite, logs, or error text.
- Providers are OpenAI Chat Completions, Anthropic Messages, Gemini `generateContent`, and OpenAI-compatible endpoints.
- Compatible presets include OpenAI, DeepSeek, Qwen, GLM, Kimi, and SiliconFlow, with editable endpoint and model ID.
- Every streaming request supports `AbortSignal`, idle timeout, malformed-frame handling, and normalized errors.
- Do not add an SDK dependency unless an existing HTTP/stream implementation cannot meet the provider contract.

## Review Focus

- API keys never appear in IPC, logs, or thrown request errors. Test with a sentinel key and simulated HTTP errors.
- Provider streams may split JSON/SSE frames across chunks. Test chunk-boundary parsing for each adapter.
- Cancellation must stop the reader even when the HTTP implementation does not promptly close its stream.
- Tool-call arguments may arrive in multiple deltas or malformed JSON. Reject incomplete calls without executing them.
- Provider profile deletion or key removal during an active request must not corrupt another profile's credential.

---

### Task 1: Provider Contracts and Model Profiles

**Files:**
- Create: `src/shared/ai-types.ts`
- Create: `src/main/services/ai/provider-contract.ts`
- Modify: `src/shared/types/script.ts` (`AppConfig.llmProfiles`, `activeLlmProfileId`)
- Test: `src/main/services/ai/provider-contract.test.ts`
- Test: `src/main/services/ai/model-profile.test.ts`

**Interfaces:**
- Produces `LlmProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible'`.
- `LlmProfile = { id, name, provider, baseUrl, model, timeoutSeconds, extraHeaderNames: string[], presetId?, createdAt, updatedAt }` with `provider: LlmProviderKind`.
- `LlmProfileView = LlmProfile & { hasApiKey: boolean }`.
- Main-process-only `ModelCredentials = { apiKey?: string; extraHeaders: Record<string, string> }`.
- `LlmMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; toolCalls?: LlmToolCall[] }`.
- `LlmToolCall = { id: string; name: string; argumentsJson: string }`.
- `LlmToolDefinition = { name: string; description: string; parameters: Record<string, unknown> }`.
- `LlmRequest = { profile: LlmProfile; credentials: ModelCredentials; messages: LlmMessage[]; tools: LlmToolDefinition[]; signal?: AbortSignal }`.
- `LlmStreamEvent = { type: 'text_delta'; text: string } | { type: 'tool_call'; call: LlmToolCall } | { type: 'usage'; promptTokens?: number; completionTokens?: number } | { type: 'complete'; finishReason?: string }`.
- `LlmTestResult = { ok: boolean; message: string; latencyMs?: number }`.
- `LlmProviderError = Error & { code: 'config' | 'auth' | 'rate_limit' | 'network' | 'timeout' | 'invalid_response' | 'cancelled'; retryable: boolean }`.
- `LlmProviderAdapter.stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>`.
- `LlmProfileView` exposes `hasApiKey`, never the key.

- [ ] **Step 1: Write failing tests** `normalizes_provider_profiles`, `rejects_missing_endpoint_or_model`, and `profile_view_never_contains_api_key`. Assert the renderer DTO contains only `hasApiKey` for key state.
- [ ] **Step 2: Run focused tests** with `node --import tsx --test src/main/services/ai/provider-contract.test.ts src/main/services/ai/model-profile.test.ts`.
- [ ] **Step 3: Implement contracts and validation** in the listed files. Add only non-secret profile fields to `AppConfig`.
- [ ] **Step 4: Run focused tests and `npm run lint`**.
- [ ] **Step 5: Commit** with `feat(ai): define model provider contracts`.

### Task 2: Encrypted Model Credential Store

**Files:**
- Create: `src/main/services/ai/model-credential-store.ts`
- Create: `src/main/services/ai/model-credential-store.test.ts`
- Reference: `src/main/services/hub-credential-store.ts`

**Interfaces:**
- Produces `ModelCredentialStore.get(profileId): ModelCredentials | null`, `set(profileId, credentials): void`, `delete(profileId): void`, and `isPersistent(): boolean`.
- Credential file is `<userData>/ai-model-credentials.json` with versioned `{ version, entries: Record<profileId, base64Ciphertext> }` shape. Each ciphertext contains one profile's API key and custom header values.
- Credential storage is injectable for tests and uses `safeStorage` by default.

- [ ] **Step 1: Write failing tests** `isolates_credentials_by_profile`, `stores_key_and_custom_headers_as_ciphertext`, `deletes_one_profile_credentials`, `ignores_corrupt_entry`, and `uses_memory_when_safe_storage_unavailable`.
- [ ] **Step 2: Run** `node --import tsx --test src/main/services/ai/model-credential-store.test.ts` and verify failures.
- [ ] **Step 3: Implement** versioned credential-file persistence using `safeStorage`; never interpolate credentials into logs/errors.
- [ ] **Step 4: Run focused tests and `npm run lint`**.
- [ ] **Step 5: Commit** with `feat(ai): store model keys with safeStorage`.

### Task 3: OpenAI and Compatible Endpoints

**Files:**
- Create: `src/main/services/ai/sse-reader.ts`
- Test: `src/main/services/ai/sse-reader.test.ts`
- Create: `src/main/services/ai/openai-provider.ts`
- Create: `src/main/services/ai/openai-compatible-provider.ts`
- Create: `src/main/services/ai/provider-presets.ts`
- Test: `src/main/services/ai/openai-provider.test.ts`
- Test: `src/main/services/ai/openai-compatible-provider.test.ts`

**Interfaces:**
- Consumes `LlmProviderAdapter`, `LlmRequest`, and `LlmStreamEvent` from Task 1.
- Produces `readSseData(response, { signal, idleTimeoutMs }): AsyncIterable<string>` for Tasks 4-5. It handles split CRLF/LF frames, ignores comments, races reads with abort and idle timeout, and cancels the reader on exit.
- Produces `createOpenAiProvider({ request })` and `createOpenAiCompatibleProvider({ request })`, both returning `LlmProviderAdapter`.
- Produces `normalizeOpenAiEndpoint(baseUrl): string` and `OPENAI_COMPATIBLE_PRESETS: LlmProviderPreset[]`, where each preset has `id`, `label`, `baseUrl`, and editable `defaultModel`.
- The injected request signature is `(url: string, init: RequestInit) => Promise<Response>`.

- [ ] **Step 1: Write failing tests** `reads_split_sse_frames`, `ignores_sse_comments`, `cancels_sse_reader_on_abort`, `streams_openai_text_and_usage`, `assembles_fragmented_tool_calls`, `normalizes_compatible_endpoint_url`, `applies_preset_and_extra_headers`, `redacts_http_errors`, and `aborts_fragmented_stream`.
- [ ] **Step 2: Run focused tests** for both adapter files.
- [ ] **Step 3: Implement** OpenAI Chat Completions and compatible endpoint streaming with normalized events and redacted errors.
- [ ] **Step 4: Run focused tests** and verify key sentinel strings never appear in captured output.
- [ ] **Step 5: Commit** with `feat(ai): support OpenAI-compatible model streams`.

### Task 4: Anthropic and Gemini Adapters

**Files:**
- Create: `src/main/services/ai/anthropic-provider.ts`
- Create: `src/main/services/ai/gemini-provider.ts`
- Test: `src/main/services/ai/anthropic-provider.test.ts`
- Test: `src/main/services/ai/gemini-provider.test.ts`

**Interfaces:**
- Consumes the shared adapter contract from Task 1.
- Produces adapters for Anthropic Messages SSE and Gemini `generateContent` streaming/function-call events.

- [x] **Step 1: Write failing tests** Anthropic authentication/text/usage, tool JSON delta assembly, and error redaction; Gemini stream endpoint/authentication, text, function calls, usage, and finish reason.
- [x] **Step 2: Run focused tests** for both provider adapters.
- [x] **Step 3: Implement** protocol-specific request/response conversion without provider logic in the renderer.
- [x] **Step 4: Run adapter tests and the full AI provider test set**.
- [x] **Step 5: Commit** with `feat(ai): add Anthropic and Gemini adapters`.

### Task 5: Provider Service, Profile IPC, and Connection Tests

**Files:**
- Create: `src/main/services/ai/model-profile-service.ts`
- Create: `src/main/services/ai/model-profile-service.test.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Modify: `package.json` (`test:unit`)

**Interfaces:**
- Produces `listProfiles()`, `upsertProfile(input)`, `deleteProfile(id)`, `setActiveProfile(id)`, and `testProfile(id)`.
- `upsertProfile(input: { profile: Omit<LlmProfile, 'createdAt' | 'updatedAt'> }): LlmProfileView`.
- `listProfiles(): { profiles: LlmProfileView[]; activeProfileId: string | null; credentialPersistent: boolean }`.
- `deleteProfile(id): boolean`, `setActiveProfile(id): LlmProfileListResult`, `setCredentials(profileId, credentials): LlmProfileView`, `clearCredentials(profileId): LlmProfileView`, and `testProfile(id): Promise<LlmTestResult>`.
- Main-process-only `resolveProvider(profileId): { profile: LlmProfile; credentials: ModelCredentials; adapter: LlmProviderAdapter }` throws typed config errors for missing profile/credentials.
- IPC profile responses use `LlmProfileView`. Secret changes use `setCredentials(profileId, credentials)` and `clearCredentials(profileId)`; values are never returned.
- Provider registry resolves one adapter by profile provider kind.

- [x] **Step 1: Write failing tests** `profile_crud_keeps_key_and_header_values_separate`, `active_profile_falls_back_after_delete`, `connection_test_redacts_provider_errors`, and invalid IPC profile/credential payloads.
- [x] **Step 2: Run focused tests**.
- [x] **Step 3: Implement service and narrow IPC/preload APIs**. Connection tests use the same normalized adapter path as Agent calls.
- [x] **Step 4: Add all new tests to `test:unit`, then run focused tests, `npm run test:unit`, and `npm run lint`**.
- [x] **Step 5: Commit** with `feat(ai): manage model profiles and connection tests`.
