# Agent Markdown and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Render Agent Markdown safely and support persisted image and text attachments end-to-end in AI project conversations.

**Architecture:** Reuse `markdown-it` and `dompurify` for sanitized Renderer output. Add a project-scoped main-process attachment store with SQLite metadata attached to user turns; IPC passes opaque IDs only. Extend the shared LLM message contract with ordered text/image parts and convert them to each provider's native format while keeping text-only requests unchanged.

**Tech Stack:** Electron, Vue 3, TypeScript, SQLite migrations, `markdown-it`, `dompurify`, OpenAI/Anthropic/Gemini streaming adapters, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-23-agent-markdown-attachments-design.md`

## Global Constraints

- Raw HTML is disabled, sanitized output is required, links allow only HTTP/HTTPS, and remote Markdown images do not load.
- First release accepts PNG, JPEG, WebP, GIF and UTF-8 text/Markdown/JSON/code/log files; it rejects SVG, executables, PDFs, Office documents, archives and unknown binary formats.
- Renderer and model prompts never receive arbitrary local paths; IPC accepts only project ID and opaque attachment ID.
- Images use native OpenAI/OpenAI-compatible `image_url`, Anthropic `source`, and Gemini `inlineData` request parts.
- Attachment bytes and text are bounded, and attachment text is included in context accounting.
- Project deletion removes only that project's attachment directory; project/runtime parameter attachments retain their current behavior.
- The model profile remains unchanged; unsupported image requests preserve the turn/attachments and show a recoverable error.

## Review Focus

- Crafted MIME/extension mismatch or SVG masquerading as an image must not reach a model or become active content; test magic-byte validation and rejection.
- Guessed/foreign attachment IDs must not read another project's data; test IPC ownership checks and project deletion isolation.
- Empty/invalid UTF-8 or oversized text must not bypass context limits; test strict decoding, explicit failure, and total request budget.
- Renderer Markdown containing event attributes, `javascript:` links, data URLs, or remote images must remain inert; test the sanitizer output policy.
- Model rejection after the user turn is persisted must preserve retryable attachment metadata and avoid duplicate user turns on retry; test provider error handling and resubmission semantics.

## File Map

- `src/shared/ai-types.ts`: ordered multimodal content parts while preserving text content and tool message contract.
- `src/shared/ai-workspace-types.ts`: safe attachment metadata on a turn and pending attachment API types.
- `src/shared/ipc-channels.ts`, `src/main/ipc/ai-workspace-handlers.ts`, `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`: project-scoped select/stage/read/remove attachment and send-message payload APIs.
- `src/main/services/ai/project-attachment-store.ts` plus tests: project-scoped allowlist, byte/type/size validation, staging, safe reads, preview bytes and cleanup.
- `src/main/db/migrations/009-ai-turn-attachments.ts`, `src/main/db/database.ts`, `src/main/db/repositories/ai-workspace-repository.ts` and tests: persist attachment metadata as turn data.
- `src/main/services/ai/agent-service.ts` and tests: resolve attachments, add bounded text contexts and ordered image parts, preserve turns on recoverable provider errors.
- `src/main/services/ai/openai-provider.ts`, `anthropic-provider.ts`, `gemini-provider.ts` and provider tests: native image message serialization.
- `src/renderer/src/lib/ai-markdown.ts` and tests: safe Markdown rendering policy.
- `src/renderer/src/components/AiProjectWorkspace.vue`, `src/renderer/src/composables/useAiProjectWorkspace.ts` and tests: attachment selection/removal/preview, history display, robust send/retry state, and rendered Markdown for history/streaming output.

## Task 1: Securely render Markdown in history and streaming messages

**Files:**
- Create: `src/renderer/src/lib/ai-markdown.ts`
- Create: `src/renderer/src/lib/ai-markdown.test.ts`
- Modify: `src/renderer/src/components/AiProjectWorkspace.vue`
- Modify: `src/renderer/src/components/AiProjectWorkspace.test.mjs`

**Interfaces:** Export `renderAiMarkdown(markdown: string): string`; component renders its result with `v-html`. Configure Markdown with `html: false`, safe link validation, and image tokens stripped; sanitize output with DOMPurify.

- [x] **Step 1: Write failing sanitizer tests** for headings/lists/fenced code rendering, `<script>`/event attribute removal, `javascript:` link removal, and remote image suppression.
- [x] **Step 2: Run** `node --import tsx --test src/renderer/src/lib/ai-markdown.test.ts`; verify module/function is absent.
- [x] **Step 3: Implement** `renderAiMarkdown(markdown)` using existing dependencies and an explicit allowed URL/tag policy.
- [x] **Step 4: Update the component** so persisted assistant messages and the current streaming assistant buffer use the same renderer; retain whitespace/code formatting.
- [x] **Step 5: Run** Markdown and `AiProjectWorkspace.test.mjs` tests; verify all security and rendering assertions pass.

## Task 2: Add a project-scoped safe attachment store and IPC contract

**Files:**
- Create: `src/main/services/ai/project-attachment-store.ts`
- Create: `src/main/services/ai/project-attachment-store.test.ts`
- Modify: `src/shared/ai-workspace-types.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/ai-workspace-handlers.ts`, `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`, `src/renderer/src/env.d.ts`
- Modify: `src/main/ipc/ai-workspace-handlers.test.ts`

**Interfaces:** `stageProjectAttachments(projectId, sourcePaths) -> AiProjectAttachment[]`; `readProjectAttachment(projectId, attachmentId) -> { metadata, bytes }`; `removeProjectAttachment(projectId, attachmentId) -> boolean`; `cleanupProjectAttachments(projectId)`. Renderer receives opaque metadata and bounded preview data, never the source path.

- [x] **Step 1: Write failing store tests** for supported PNG/JPEG/WebP/GIF signatures, supported UTF-8 text extensions, rejected SVG/unknown binaries/magic mismatch/symlink, size/count limits, cross-project ID rejection, and isolated project cleanup.
- [x] **Step 2: Run** `node --import tsx --test src/main/services/ai/project-attachment-store.test.ts`; verify missing store API.
- [x] **Step 3: Implement** the store rooted under Autoforge user data with generated opaque IDs and project-owned paths. Use strict UTF-8 validation for text. Define and test the chosen fixed byte/count/preview limits in exported constants.
- [x] **Step 4: Add failing IPC tests** proving attachment operations require a valid project ID and never accept arbitrary destination paths.
- [x] **Step 5: Implement** a system multi-select dialog and preload API. Stage, read, and remove actions resolve ownership through the store; validate every source file before copying.
- [x] **Step 6: Run** store and IPC tests and verify foreign IDs and path traversal are rejected.

## Task 3: Persist attachment metadata with AI turns

**Files:**
- Create: `src/main/db/migrations/009-ai-turn-attachments.ts`
- Modify: `src/main/db/database.ts`
- Modify: `src/main/db/repositories/ai-workspace-repository.ts`
- Modify: `src/main/db/repositories/ai-workspace-repository.test.ts`
- Modify: `src/shared/ai-workspace-types.ts`

**Interfaces:** `AiProjectTurn.attachments?: AiProjectAttachment[]`; `AiProjectTurnInput.attachments?: AiProjectAttachment[]`. Add nullable JSON column `attachments` to turns; existing records load without attachments.

- [x] **Step 1: Write failing repository tests** for turn attachment JSON save/load, old rows without metadata, and project cascade deletion.
- [x] **Step 2: Run** `node --import tsx --test src/main/db/repositories/ai-workspace-repository.test.ts`; verify missing migration/field persistence.
- [x] **Step 3: Implement migration v9 and repository mapping** with null-safe JSON parse; preserve existing migration behavior.
- [x] **Step 4: Run** repository tests, migration tests and SQLite persistence tests.

## Task 4: Pass attachment content through LLM requests and Provider adapters

**Files:**
- Modify: `src/shared/ai-types.ts`
- Modify: `src/main/services/ai/agent-service.ts`
- Modify: `src/main/services/ai/agent-service.test.ts`
- Modify: `src/main/services/ai/openai-provider.ts`, `openai-provider.test.ts`
- Modify: `src/main/services/ai/anthropic-provider.ts`, `anthropic-provider.test.ts`
- Modify: `src/main/services/ai/gemini-provider.ts`, `gemini-provider.test.ts`

**Interfaces:** `LlmMessage` gains optional ordered parts using a discriminated union such as `{type:'text'; text:string}` and `{type:'image'; mimeType:'image/png'|'image/jpeg'|'image/webp'|'image/gif'; data:Uint8Array}`. Existing `content: string`, tool calls and tool results remain supported.

- [x] **Step 1: Write failing adapter tests** asserting one PNG sample becomes the correct OpenAI data URL, Anthropic base64 image source, and Gemini inlineData while preserving text order.
- [x] **Step 2: Run** the three provider test files and confirm the image content-block assertions fail.
- [x] **Step 3: Implement** shared typed parts and provider conversions; text-only messages must serialize identically to current behavior.
- [x] **Step 4: Add failing Agent-service tests** proving text attachments become clearly delimited file-name contexts within the character budget and image metadata resolves into provider parts without exposing local paths.
- [x] **Step 5: Implement** send payload validation, repository turn attachment persistence, attachment resolution, strict text injection as quoted data, and total context/image budget checks. A missing file shows an error while historical text remains readable. On Provider rejection, keep the user turn and attachments and surface a retry path that does not append a duplicate user turn.
- [x] **Step 6: Run** provider and Agent-service tests. Verify no logs contain Base64, file bytes, or attachment text.

## Task 5: Build the attachment composer and persisted message presentation

**Files:**
- Modify: `src/renderer/src/composables/useAiProjectWorkspace.ts`
- Modify: `src/renderer/src/composables/useAiProjectWorkspace.test.ts`
- Modify: `src/renderer/src/components/AiProjectWorkspace.vue`
- Modify: `src/renderer/src/components/AiProjectWorkspace.test.mjs`
- Modify: `src/main/ipc/ai-workspace-handlers.ts` and bridge tests as needed

**Interfaces:** `sendMessage(message, attachmentIds)` sends opaque IDs; pending attachments carry metadata and image preview. `AiProjectTurn.attachments` renders file labels and images without local filesystem paths.

- [x] **Step 1: Write failing composable/UI tests** for selecting/staging attachments, remove-before-send, send including IDs, failure preserving the draft and attachments, project history restoring attachment labels, and rendering assistant Markdown.
- [x] **Step 2: Run** `node --import tsx --test src/renderer/src/composables/useAiProjectWorkspace.test.ts src/renderer/src/components/AiProjectWorkspace.test.mjs`; confirm attachment input and preservation behavior is absent.
- [x] **Step 3: Implement** composer attachment control, pending chips/previews, remove action, history chips/previews, and readable error state. Keep a failed send draft retryable without resending a duplicate user turn.
- [x] **Step 4: Run** renderer AI tests and verify text-only send, cancel, project switching, and attachment send/retry behavior.

## Task 6: Lifecycle cleanup and full verification

**Files:**
- Modify: project deletion service/IPC path and related tests.
- Test: `src/main/services/ai/*.test.ts`, AI workspace repository/IPC tests, renderer workspace tests.

- [x] **Step 1: Add failing tests** asserting deleting a project removes only its attachment directory; removing a single pending attachment cannot affect another project.
- [x] **Step 2: Implement** deterministic cleanup for project deletion and conservative cleanup for stale unreferenced pending files after crashes.
- [x] **Step 3: Run** `npm run test:renderer-ai`, `node --import tsx --test src/main/services/ai/*.test.ts src/main/ipc/ai-workspace-handlers.test.ts src/main/db/repositories/ai-workspace-repository.test.ts`, and relevant workspace/UI tests.
- [x] **Step 4: Run** `npm run lint`, `npm run build`, and `git diff --check`.
- [x] **Step 5: Review** each design acceptance criterion and report tests and any remaining limitation.

## Plan Self-Review

- Spec coverage: Markdown and sanitization (Task 1); file validation, opaque IPC IDs and cleanup (Tasks 2, 6); migration/history (Task 3); text budget and all three provider image formats (Task 4); composer, previews, project switches and recoverable retry (Task 5); regression/full checks (Task 6).
- Builder choices: exact fixed resource caps, extension list and preview path are implemented as named constants and enforced by the attachment store; no profile visual-capability setting is added.
- Review focus is covered by tests in Tasks 1-6: content sniffing/SVG, cross-project reads, invalid/oversized text, active Markdown attacks, and Provider-rejected retry.
