import type { LlmProviderAdapter, LlmRequest } from './provider-contract'
import { LlmProviderError } from './provider-contract'
import { readSseData } from './sse-reader'
import type { LlmMessage, LlmStreamEvent, LlmToolCall } from '../../../shared/ai-types'

export interface ProviderRequestDeps {
  request(url: string, init: RequestInit): Promise<Response>
}

interface ToolCallAccumulator {
  id: string
  name: string
  argumentsJson: string
}

function toOpenAiMessage(message: LlmMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.argumentsJson }
      }))
    }
  }
  return { role: message.role, content: message.parts?.map(part => part.type === 'text'
    ? { type: 'text', text: part.text }
    : { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }) ?? message.content }
}

export function normalizeOpenAiEndpoint(baseUrl: string): string {
  const input = baseUrl?.trim()
  if (!input) throw new LlmProviderError('请填写接口地址', 'config', false)
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new LlmProviderError('接口地址无效', 'config', false)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LlmProviderError('接口地址必须使用 HTTP 或 HTTPS', 'config', false)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LlmProviderError('接口地址不能包含凭据、查询或片段', 'config', false)
  }

  const path = url.pathname.replace(/\/+$/, '')
  const endpointPath = /\/chat\/completions$/i.test(path) ? path : `${path}/chat/completions`
  return `${url.origin}${endpointPath}`
}

function providerErrorForStatus(status: number): LlmProviderError {
  if (status === 401 || status === 403) return new LlmProviderError('模型服务认证失败', 'auth', false)
  if (status === 429) return new LlmProviderError('模型服务请求过于频繁', 'rate_limit', true)
  if (status >= 500) return new LlmProviderError('模型服务暂时不可用', 'network', true)
  return new LlmProviderError(`模型服务请求失败（HTTP ${status}）`, 'invalid_response', false)
}

function requestHeaders(request: LlmRequest): Headers {
  const headers = new Headers(request.credentials.extraHeaders)
  headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'text/event-stream')
  if (request.credentials.apiKey && !headers.has('authorization')) {
    headers.set('Authorization', `Bearer ${request.credentials.apiKey}`)
  }
  return headers
}

function parsePayload(payload: string): Record<string, unknown> | null {
  if (payload === '[DONE]') return null
  try {
    const parsed: unknown = JSON.parse(payload)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new LlmProviderError('模型返回了无效的流数据', 'invalid_response', false)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function assembleToolCalls(
  rawCalls: unknown,
  calls: Map<number, ToolCallAccumulator>
): void {
  if (!Array.isArray(rawCalls)) return
  for (const rawCall of rawCalls) {
    const call = asRecord(rawCall)
    if (!call || typeof call.index !== 'number' || !Number.isInteger(call.index)) continue
    const functionDelta = asRecord(call.function)
    if (!functionDelta) continue
    const existing = calls.get(call.index) ?? { id: '', name: '', argumentsJson: '' }
    existing.id += asText(call.id)
    existing.name += asText(functionDelta.name)
    existing.argumentsJson += asText(functionDelta.arguments)
    calls.set(call.index, existing)
  }
}

function completeToolCalls(calls: Map<number, ToolCallAccumulator>): LlmToolCall[] {
  return [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => {
      if (!call.id || !call.name) {
        throw new LlmProviderError('模型返回了不完整的工具调用', 'invalid_response', false)
      }
      try {
        JSON.parse(call.argumentsJson)
      } catch {
        throw new LlmProviderError('模型返回了无效的工具参数', 'invalid_response', false)
      }
      return { id: call.id, name: call.name, argumentsJson: call.argumentsJson }
    })
}

export function createOpenAiProvider(deps: ProviderRequestDeps): LlmProviderAdapter {
  return {
    async *stream(request: LlmRequest): AsyncGenerator<LlmStreamEvent> {
      if (!request.credentials.apiKey && Object.keys(request.credentials.extraHeaders).length === 0) {
        throw new LlmProviderError('请为模型配置 API Key 或鉴权请求头', 'config', false)
      }

      const body: Record<string, unknown> = {
        model: request.profile.model,
        messages: request.messages.map(toOpenAiMessage),
        stream: true,
        temperature: 0.2
      }
      if (request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        }))
      }

      let response: Response
      try {
        response = await deps.request(normalizeOpenAiEndpoint(request.profile.baseUrl), {
          method: 'POST',
          headers: requestHeaders(request),
          body: JSON.stringify(body),
          signal: request.signal
        })
      } catch {
        if (request.signal?.aborted) throw new LlmProviderError('请求已取消', 'cancelled', false)
        throw new LlmProviderError('无法连接模型服务', 'network', true)
      }

      if (!response.ok) throw providerErrorForStatus(response.status)

      const calls = new Map<number, ToolCallAccumulator>()
      let finishReason: string | undefined
      let completed = false
      for await (const payload of readSseData(response, {
        signal: request.signal,
        idleTimeoutMs: Math.max(1, request.profile.timeoutSeconds) * 1000
      })) {
        const data = parsePayload(payload)
        if (!data) {
          completed = true
          continue
        }

        const usage = asRecord(data.usage)
        if (usage) {
          const promptTokens = asNumber(usage.prompt_tokens)
          const completionTokens = asNumber(usage.completion_tokens)
          if (promptTokens !== undefined || completionTokens !== undefined) {
            yield { type: 'usage', promptTokens, completionTokens }
          }
        }

        const choices = Array.isArray(data.choices) ? data.choices : []
        for (const rawChoice of choices) {
          const choice = asRecord(rawChoice)
          if (!choice) continue
          if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
          const delta = asRecord(choice.delta)
          if (!delta) continue
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            yield { type: 'text_delta', text: delta.content }
          }
          assembleToolCalls(delta.tool_calls, calls)
        }
      }

      for (const call of completeToolCalls(calls)) yield { type: 'tool_call', call }
      yield { type: 'complete', finishReason: finishReason ?? (completed ? 'stop' : undefined) }
    }
  }
}
