import type { LlmMessage, LlmProfile, LlmStreamEvent, LlmToolCall } from '../../../shared/ai-types'
import type { LlmProviderAdapter, LlmRequest } from './provider-contract'
import { LlmProviderError } from './provider-contract'
import { readSseData } from './sse-reader'
import type { ProviderRequestDeps } from './openai-provider'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function endpoint(profile: LlmProfile): string {
  try {
    const url = new URL(profile.baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme')
    const path = url.pathname.replace(/\/+$/, '')
    url.pathname = `${path}/models/${encodeURIComponent(profile.model)}:streamGenerateContent`
    url.search = ''
    url.searchParams.set('alt', 'sse')
    url.hash = ''
    return url.toString()
  } catch {
    throw new LlmProviderError('Gemini 接口地址无效', 'config', false)
  }
}

function statusError(status: number): LlmProviderError {
  if (status === 401 || status === 403) return new LlmProviderError('Gemini 认证失败', 'auth', false)
  if (status === 429) return new LlmProviderError('Gemini 请求过于频繁', 'rate_limit', true)
  if (status >= 500) return new LlmProviderError('Gemini 服务暂时不可用', 'network', true)
  return new LlmProviderError(`Gemini 请求失败（HTTP ${status}）`, 'invalid_response', false)
}

function findToolName(messages: LlmMessage[], toolCallId?: string): string | undefined {
  if (!toolCallId) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const call = messages[index].toolCalls?.find((candidate) => candidate.id === toolCallId)
    if (call) return call.name
  }
  return undefined
}

function convertMessages(messages: LlmMessage[]): { systemInstruction?: Record<string, unknown>; contents: Array<Record<string, unknown>> } {
  const systemText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n')
  const contents = messages.filter((message) => message.role !== 'system').map((message) => {
    if (message.role === 'tool') {
      const name = findToolName(messages, message.toolCallId)
      if (!name) throw new LlmProviderError('找不到 Gemini 工具调用名称', 'invalid_response', false)
      let response: unknown
      try {
        response = JSON.parse(message.content)
      } catch {
        response = { content: message.content }
      }
      return { role: 'user', parts: [{ functionResponse: { name, response } }] }
    }

    const parts: Array<Record<string, unknown>> = []
    if (message.parts) {
      for (const part of message.parts) parts.push(part.type === 'text' ? { text: part.text } : { inlineData: { mimeType: part.mimeType, data: part.data } })
    } else if (message.content) parts.push({ text: message.content })
    for (const call of message.toolCalls ?? []) {
      let args: unknown
      try {
        args = JSON.parse(call.argumentsJson)
      } catch {
        throw new LlmProviderError('Gemini 工具调用参数无效', 'invalid_response', false)
      }
      parts.push({ functionCall: { name: call.name, args } })
    }
    return { role: message.role === 'assistant' ? 'model' : 'user', parts }
  })

  return {
    systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents
  }
}

function makeToolCall(index: number, functionCall: Record<string, unknown>): LlmToolCall {
  const name = text(functionCall.name)
  if (!name) throw new LlmProviderError('Gemini 返回了不完整的函数调用', 'invalid_response', false)
  return {
    id: `gemini-${index}-${name}`,
    name,
    argumentsJson: JSON.stringify(functionCall.args ?? {})
  }
}

export function createGeminiProvider(deps: ProviderRequestDeps): LlmProviderAdapter {
  return {
    async *stream(request: LlmRequest): AsyncGenerator<LlmStreamEvent> {
      if (!request.credentials.apiKey) throw new LlmProviderError('请填写 Gemini API Key', 'config', false)
      const headers = new Headers(request.credentials.extraHeaders)
      headers.set('x-goog-api-key', request.credentials.apiKey)
      headers.set('content-type', 'application/json')
      headers.set('accept', 'text/event-stream')
      const converted = convertMessages(request.messages)
      const body: Record<string, unknown> = { contents: converted.contents, generationConfig: { temperature: 0.2 } }
      if (converted.systemInstruction) body.systemInstruction = converted.systemInstruction
      if (request.tools.length > 0) {
        body.tools = [{ functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        })) }]
      }

      let response: Response
      try {
        response = await deps.request(endpoint(request.profile), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: request.signal
        })
      } catch {
        if (request.signal?.aborted) throw new LlmProviderError('请求已取消', 'cancelled', false)
        throw new LlmProviderError('无法连接 Gemini', 'network', true)
      }
      if (!response.ok) throw statusError(response.status)

      let finishReason: string | undefined
      let promptTokens: number | undefined
      let completionTokens: number | undefined
      let toolIndex = 0
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
          throw new LlmProviderError('Gemini 返回了无效的流数据', 'invalid_response', false)
        }

        const candidates = Array.isArray(data.candidates) ? data.candidates : []
        for (const candidateValue of candidates) {
          const candidate = record(candidateValue)
          const content = record(candidate?.content)
          const parts = Array.isArray(content?.parts) ? content.parts : []
          for (const partValue of parts) {
            const part = record(partValue)
            if (typeof part?.text === 'string' && part.text.length > 0) {
              yield { type: 'text_delta', text: part.text }
            }
            const functionCall = record(part?.functionCall)
            if (functionCall) yield { type: 'tool_call', call: makeToolCall(toolIndex++, functionCall) }
          }
          finishReason = text(candidate?.finishReason) || finishReason
        }

        const usage = record(data.usageMetadata)
        promptTokens = number(usage?.promptTokenCount) ?? promptTokens
        completionTokens = number(usage?.candidatesTokenCount) ?? completionTokens
      }

      if (promptTokens !== undefined || completionTokens !== undefined) {
        yield { type: 'usage', promptTokens, completionTokens }
      }
      yield { type: 'complete', finishReason }
    }
  }
}
