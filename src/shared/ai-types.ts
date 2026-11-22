export type LlmProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible'

export interface LlmProfile {
  id: string
  name: string
  provider: LlmProviderKind
  baseUrl: string
  model: string
  timeoutSeconds: number
  extraHeaderNames: string[]
  presetId?: string
  createdAt: string
  updatedAt: string
}

export interface LlmProfileView extends LlmProfile {
  hasApiKey: boolean
  hasCredentials: boolean
}

export interface LlmProfileListResult {
  profiles: LlmProfileView[]
  activeProfileId: string | null
  credentialPersistent: boolean
}

export interface LlmProviderPreset {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: LlmToolCall[]
}

export interface LlmToolCall {
  id: string
  name: string
  argumentsJson: string
}

export interface LlmToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type LlmStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; call: LlmToolCall }
  | { type: 'usage'; promptTokens?: number; completionTokens?: number }
  | { type: 'complete'; finishReason?: string }

export interface LlmTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}
