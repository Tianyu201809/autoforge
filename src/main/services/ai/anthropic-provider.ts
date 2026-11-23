import type { LlmMessage, LlmStreamEvent, LlmToolCall } from '../../../shared/ai-types'
import type { LlmProviderAdapter, LlmRequest } from './provider-contract'
import { LlmProviderError } from './provider-contract'
import { readSseData } from './sse-reader'
import type { ProviderRequestDeps } from './openai-provider'

interface AnthropicToolAccumulator {
  id: string
  name: string
  inputJson: string
}

function normalizeMessages(messages: LlmMessage[]): { system?: string; messages: Array<Record<string, unknown>> } {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n')
  const converted = messages.filter((message) => message.role !== 'system').map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }]
      }
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content: Array<Record<string, unknown>> = []
      if (message.content) content.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls) {
        let input: unknown
        try {
          input = JSON.parse(call.argumentsJson)
        } catch {
          throw new LlmProviderError('工具调用参数无效', 'invalid_response', false)
        }
        content.push({ type: 'tool_use', id: call.id, name: call.name, input })
      }
      return { role: 'assistant', content }
    }
    return { role: message.role, content: message.parts?.map(part => part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image', source: { type: 'base64', media_type: part.mimeType, data: part.data } }) ?? message.content }
  })
  return { system: system || undefined, messages: converted }
}

function endpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('scheme')
    const path = url.pathname.replace(/\/+$/, '')
    url.pathname = /\/messages$/i.test(path) ? path : `${path}/messages`
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    throw new LlmProviderError('Anthropic 接口地址无效', 'config', false)
  }
}

function statusError(status: number): LlmProviderError {
  if (status === 401 || status === 403) return new LlmProviderError('Anthropic 认证失败', 'auth', false)
  if (status === 429) return new LlmProviderError('Anthropic 请求过于频繁', 'rate_limit', true)
  if (status >= 500) return new LlmProviderError('Anthropic 服务暂时不可用', 'network', true)
  return new LlmProviderError(`Anthropic 请求失败（HTTP ${status}）`, 'invalid_response', false)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function completeToolCall(call: AnthropicToolAccumulator): LlmToolCall {
  if (!call.id || !call.name) throw new LlmProviderError('Anthropic 工具调用不完整', 'invalid_response', false)
  const inputJson = call.inputJson || '{}'
  try {
    JSON.parse(inputJson)
  } catch {
    throw new LlmProviderError('Anthropic 工具参数无效', 'invalid_response', false)
  }
  return { id: call.id, name: call.name, argumentsJson: inputJson }
}

export function createAnthropicProvider(deps: ProviderRequestDeps): LlmProviderAdapter {
  return {
    async *stream(request: LlmRequest): AsyncGenerator<LlmStreamEvent> {
      if (!request.credentials.apiKey) throw new LlmProviderError('请填写 Anthropic API Key', 'config', false)
      const normalized = normalizeMessages(request.messages)
      const headers = new Headers(request.credentials.extraHeaders)
      headers.set('x-api-key', request.credentials.apiKey)
      headers.set('anthropic-version', '2023-06-01')
      headers.set('content-type', 'application/json')
      headers.set('accept', 'text/event-stream')
      const body: Record<string, unknown> = {
        model: request.profile.model,
        max_tokens: 8192,
        messages: normalized.messages,
        stream: true,
        temperature: 0.2
      }
      if (normalized.system) body.system = normalized.system
      if (request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters
        }))
      }

      let response: Response
      try {
        response = await deps.request(endpoint(request.profile.baseUrl), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: request.signal
        })
      } catch {
        if (request.signal?.aborted) throw new LlmProviderError('请求已取消', 'cancelled', false)
        throw new LlmProviderError('无法连接 Anthropic', 'network', true)
      }
      if (!response.ok) throw statusError(response.status)

      const tools = new Map<number, AnthropicToolAccumulator>()
      let promptTokens: number | undefined
      let completionTokens: number | undefined
      let finishReason: string | undefined
      let stopped = false

      for await (const payload of readSseData(response, {
        signal: request.signal,
        idleTimeoutMs: Math.max(1, request.profile.timeoutSeconds) * 1000
      })) {
        let data: Record<string, unknown>
        try {
          const parsed: unknown = JSON.parse(payload)
          const parsedRecord = record(parsed)
          if (!parsedRecord) throw new Error('not object')
          data = parsedRecord
        } catch {
          throw new LlmProviderError('Anthropic 返回了无效的流数据', 'invalid_response', false)
        }

        const type = text(data.type)
        if (type === 'error') throw new LlmProviderError('Anthropic 返回了服务错误', 'invalid_response', false)
        if (type === 'message_start') {
          promptTokens = number(record(record(data.message)?.usage)?.input_tokens) ?? promptTokens
        }
        if (type === 'content_block_start') {
          const index = number(data.index)
          const block = record(data.content_block)
          if (index !== undefined && block?.type === 'tool_use') {
            const input = record(block.input) ?? {}
            const inputJson = Object.keys(input).length > 0 ? JSON.stringify(input) : ''
            tools.set(index, { id: text(block.id), name: text(block.name), inputJson })
          }
        }
        if (type === 'content_block_delta') {
          const delta = record(data.delta)
          if (delta?.type === 'text_delta' && text(delta.text)) yield { type: 'text_delta', text: text(delta.text) }
          if (delta?.type === 'input_json_delta') {
            const index = number(data.index)
            const tool = index === undefined ? undefined : tools.get(index)
            if (tool) tool.inputJson += text(delta.partial_json)
          }
        }
        if (type === 'content_block_stop') {
          const index = number(data.index)
          const tool = index === undefined ? undefined : tools.get(index)
          if (tool) {
            yield { type: 'tool_call', call: completeToolCall(tool) }
            tools.delete(index!)
          }
        }
        if (type === 'message_delta') {
          const delta = record(data.delta)
          finishReason = text(delta?.stop_reason) || finishReason
          const usage = record(data.usage)
          completionTokens = number(usage?.output_tokens) ?? completionTokens
        }
        if (type === 'message_stop') stopped = true
      }

      for (const tool of tools.values()) yield { type: 'tool_call', call: completeToolCall(tool) }
      if (promptTokens !== undefined || completionTokens !== undefined) {
        yield { type: 'usage', promptTokens, completionTokens }
      }
      yield { type: 'complete', finishReason: finishReason ?? (stopped ? 'end_turn' : undefined) }
    }
  }
}
