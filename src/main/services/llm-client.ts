import type { LlmProfile, LlmTestResult } from '../../shared/llm-types'
import { DEFAULT_LLM_MAX_OUTPUT_TOKENS, DEFAULT_LLM_TIMEOUT_SECONDS } from '../../shared/llm-types'

export class LlmClientError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'config'
      | 'auth'
      | 'not_found'
      | 'rate_limit'
      | 'network'
      | 'timeout'
      | 'server'
      | 'cancelled'
      | 'invalid_response'
  ) {
    super(message)
    this.name = 'LlmClientError'
  }
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmChatInput {
  baseUrl: string
  model: string
  apiKey: string
  messages: LlmChatMessage[]
  temperature?: number
  maxOutputTokens?: number
  /** 非流式请求的总超时（秒） */
  timeoutSeconds?: number
  /** 额外请求头，JSON 对象字符串（与 LlmProfile.extraHeaders 一致） */
  extraHeaders?: string
  /** 要求模型返回 JSON 对象 */
  json?: boolean
}

export interface LlmStreamInput extends LlmChatInput {
  /** 每收到一段内容回调一次；totalChars 为累计字符数 */
  onDelta?: (delta: string, totalChars: number) => void
  /** 每收到一段思考过程回调一次；参数是截至目前的完整思考文本 */
  onReasoning?: (thinking: string) => void
  /**
   * 空闲超时（秒）：多久没有收到新内容视为卡死。
   * 流式下不使用总超时，避免长输出被误杀。
   */
  idleTimeoutSeconds?: number
  /** 外部取消信号（用户点击停止） */
  signal?: AbortSignal
}

export interface LlmChatResult {
  content: string
  /** 与正文分开的思考过程；模型未提供时为空 */
  reasoning?: string
  model?: string
  promptTokens?: number
  completionTokens?: number
  /** 'stop' 表示正常结束；'length' 表示达到输出上限被截断 */
  finishReason?: string
  /** 本次是否为流式返回 */
  streamed?: boolean
}

export interface LlmClientDeps {
  /** 注入的 HTTP 客户端；主进程使用 electron 的 net.fetch 以获得系统代理支持 */
  request: (url: string, init?: RequestInit) => Promise<Response>
}

export const DEFAULT_IDLE_TIMEOUT_SECONDS = 60
const HARD_STREAM_TIMEOUT_MS = 15 * 60 * 1000

/** 把用户填写的 baseUrl 归一化为 chat/completions 端点 */
export function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/, '')
  if (!trimmed) throw new LlmClientError('请填写接口地址', 'config')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  return `${trimmed}/chat/completions`
}

export function parseExtraHeaders(raw?: string): Record<string, string> {
  const text = raw?.trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') headers[key] = value
    }
    return headers
  } catch {
    return {}
  }
}

function describeHttpFailure(status: number, body: string): LlmClientError {
  const detail = body.trim().slice(0, 300)
  const suffix = detail ? `：${detail}` : ''
  if (status === 401 || status === 403) {
    return new LlmClientError(`认证失败（HTTP ${status}），请检查 API Key 是否正确${suffix}`, 'auth')
  }
  if (status === 404) {
    return new LlmClientError(
      `接口不存在（HTTP 404），请检查接口地址是否包含正确的路径（如 /v1）${suffix}`,
      'not_found'
    )
  }
  if (status === 429) {
    return new LlmClientError(`请求被限流或额度不足（HTTP 429），请稍后重试${suffix}`, 'rate_limit')
  }
  if (status >= 500) {
    return new LlmClientError(`模型服务返回错误（HTTP ${status}），请稍后重试${suffix}`, 'server')
  }
  return new LlmClientError(`请求失败（HTTP ${status}）${suffix}`, 'invalid_response')
}

/** 判断错误是否可能源于网关不支持 response_format，可去掉后重试 */
function isJsonModeUnsupported(error: unknown): boolean {
  return (
    error instanceof LlmClientError &&
    (error.code === 'invalid_response' || error.code === 'server') &&
    /response_format|json_object|unsupported|invalid_request/i.test(error.message)
  )
}

interface ChatCompletionResponse {
  model?: string
  choices?: Array<{
    message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }
    delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }
    finish_reason?: unknown
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

function buildBody(input: LlmChatInput, stream: boolean, json: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model?.trim(),
    messages: input.messages,
    temperature: input.temperature ?? 0.2,
    max_tokens: input.maxOutputTokens ?? DEFAULT_LLM_MAX_OUTPUT_TOKENS,
    stream
  }
  if (json) body.response_format = { type: 'json_object' }
  return body
}

function buildHeaders(input: LlmChatInput): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
    Authorization: `Bearer ${input.apiKey}`,
    ...parseExtraHeaders(input.extraHeaders)
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 思考过程优先读 reasoning_content，没有则读 reasoning。正文不从这里取。 */
export function readReasoningDelta(record: unknown): string {
  if (!record || typeof record !== 'object') return ''
  const source = record as { reasoning_content?: unknown; reasoning?: unknown }
  if (typeof source.reasoning_content === 'string' && source.reasoning_content) return source.reasoning_content
  if (typeof source.reasoning === 'string' && source.reasoning) return source.reasoning
  return ''
}

export function createLlmClient(deps: LlmClientDeps): {
  chat: (input: LlmChatInput) => Promise<LlmChatResult>
  chatStream: (input: LlmStreamInput) => Promise<LlmChatResult>
  testConnection: (profile: LlmProfile, apiKey: string) => Promise<LlmTestResult>
} {
  async function send(input: LlmChatInput, json: boolean): Promise<LlmChatResult> {
    const url = resolveChatCompletionsUrl(input.baseUrl)
    const timeoutMs = Math.max(5, input.timeoutSeconds ?? DEFAULT_LLM_TIMEOUT_SECONDS) * 1000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      let response: Response
      try {
        response = await deps.request(url, {
          method: 'POST',
          headers: buildHeaders(input),
          body: JSON.stringify(buildBody(input, false, json)),
          signal: controller.signal
        })
      } catch (error) {
        if (controller.signal.aborted) {
          throw new LlmClientError(`请求超时（${Math.round(timeoutMs / 1000)} 秒），可在配置中调大超时`, 'timeout')
        }
        const message = error instanceof Error ? error.message : String(error)
        throw new LlmClientError(`无法连接模型服务：${message}。请检查网络或代理设置`, 'network')
      }

      const text = await response.text()
      if (!response.ok) throw describeHttpFailure(response.status, text)

      let payload: ChatCompletionResponse
      try {
        payload = JSON.parse(text) as ChatCompletionResponse
      } catch {
        throw new LlmClientError('模型返回的不是合法 JSON，可能命中了网关错误页', 'invalid_response')
      }

      if (payload.error?.message) {
        throw new LlmClientError(`模型返回错误：${payload.error.message}`, 'invalid_response')
      }

      const message = payload.choices?.[0]?.message
      const content = message?.content
      if (typeof content !== 'string' || !content.trim()) {
        throw new LlmClientError('模型没有返回任何内容', 'invalid_response')
      }

      const finishReason = payload.choices?.[0]?.finish_reason
      const reasoning = readReasoningDelta(message)
      return {
        content,
        reasoning: reasoning || undefined,
        model: payload.model,
        promptTokens: asNumber(payload.usage?.prompt_tokens),
        completionTokens: asNumber(payload.usage?.completion_tokens),
        finishReason: typeof finishReason === 'string' ? finishReason : undefined,
        streamed: false
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 解析一条 SSE data 负载，返回本次增量 */
  function consumeStreamPayload(
    payload: string,
    state: {
      content: string
      reasoning: string
      finishReason?: string
      model?: string
      promptTokens?: number
      completionTokens?: number
    },
    onDelta?: (delta: string, totalChars: number) => void,
    onReasoning?: (thinking: string) => void
  ): boolean {
    if (payload === '[DONE]') return false

    let parsed: ChatCompletionResponse
    try {
      parsed = JSON.parse(payload) as ChatCompletionResponse
    } catch {
      // 部分网关会插入非 JSON 的心跳内容，忽略即可
      return true
    }

    if (parsed.error?.message) {
      throw new LlmClientError(`模型返回错误：${parsed.error.message}`, 'invalid_response')
    }
    if (parsed.model) state.model = parsed.model
    if (parsed.usage) {
      state.promptTokens = asNumber(parsed.usage.prompt_tokens) ?? state.promptTokens
      state.completionTokens = asNumber(parsed.usage.completion_tokens) ?? state.completionTokens
    }

    const choice = parsed.choices?.[0]
    const delta = choice?.delta?.content
    if (typeof delta === 'string' && delta) {
      state.content += delta
      onDelta?.(delta, state.content.length)
    }
    const reasoningDelta = readReasoningDelta(choice?.delta)
    if (reasoningDelta) {
      state.reasoning += reasoningDelta
      onReasoning?.(state.reasoning)
    }
    if (typeof choice?.finish_reason === 'string') state.finishReason = choice.finish_reason
    return true
  }

  async function streamOnce(input: LlmStreamInput, json: boolean): Promise<LlmChatResult> {
    const url = resolveChatCompletionsUrl(input.baseUrl)
    const idleMs = Math.max(1, input.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS) * 1000
    const controller = new AbortController()

    let idleTimedOut = false
    let hardTimedOut = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const refreshIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        idleTimedOut = true
        controller.abort()
      }, idleMs)
    }
    const hardTimer = setTimeout(() => {
      hardTimedOut = true
      controller.abort()
    }, HARD_STREAM_TIMEOUT_MS)

    const externalSignal = input.signal
    const onExternalAbort = (): void => controller.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    try {
      let response: Response
      refreshIdle()
      try {
        response = await deps.request(url, {
          method: 'POST',
          headers: buildHeaders(input),
          body: JSON.stringify(buildBody(input, true, json)),
          signal: controller.signal
        })
      } catch (error) {
        if (externalSignal?.aborted) throw new LlmClientError('已取消', 'cancelled')
        if (idleTimedOut) {
          throw new LlmClientError(`连接超时：${Math.round(idleMs / 1000)} 秒内没有响应`, 'timeout')
        }
        const message = error instanceof Error ? error.message : String(error)
        throw new LlmClientError(`无法连接模型服务：${message}。请检查网络或代理设置`, 'network')
      }

      if (!response.ok) {
        const text = await response.text()
        throw describeHttpFailure(response.status, text)
      }
      if (!response.body) throw new LlmClientError('流式响应为空', 'invalid_response')

      const state: {
        content: string
        reasoning: string
        finishReason?: string
        model?: string
        promptTokens?: number
        completionTokens?: number
      } = { content: '', reasoning: '' }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      /** 把中止原因翻译成可读错误 */
      const buildAbortError = (): LlmClientError => {
        if (externalSignal?.aborted) return new LlmClientError('已取消', 'cancelled')
        if (idleTimedOut) {
          return new LlmClientError(
            `生成中断：${Math.round(idleMs / 1000)} 秒内没有收到新内容，请检查网络或调大超时`,
            'timeout'
          )
        }
        if (hardTimedOut) {
          return new LlmClientError('生成中断：超过单次请求上限（15 分钟）', 'timeout')
        }
        return new LlmClientError('请求已中止', 'cancelled')
      }

      /**
       * 与中止信号竞速读取。
       * 部分网关/中间层不会把 abort 传导进响应流，直接 await reader.read() 会永久挂起。
       */
      const readChunk = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
        let onAbort: (() => void) | undefined
        try {
          return await Promise.race([
            reader.read(),
            new Promise<never>((_resolve, reject) => {
              onAbort = () => reject(buildAbortError())
              if (controller.signal.aborted) onAbort()
              else controller.signal.addEventListener('abort', onAbort, { once: true })
            })
          ])
        } finally {
          if (onAbort) controller.signal.removeEventListener('abort', onAbort)
        }
      }

      try {
        while (true) {
          const { done, value } = await readChunk()
          if (done) break
          refreshIdle()
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line || line.startsWith(':')) continue
            if (!line.startsWith('data:')) continue
            consumeStreamPayload(line.slice(5).trim(), state, input.onDelta, input.onReasoning)
          }
        }
        // 处理最后一段没有换行结尾的数据
        buffer += decoder.decode()
        for (const rawLine of buffer.split('\n')) {
          const line = rawLine.trim()
          if (!line || line.startsWith(':') || !line.startsWith('data:')) continue
          consumeStreamPayload(line.slice(5).trim(), state, input.onDelta, input.onReasoning)
        }
      } catch (error) {
        if (error instanceof LlmClientError) throw error
        const message = error instanceof Error ? error.message : String(error)
        throw new LlmClientError(`读取流式响应失败：${message}`, 'network')
      } finally {
        reader.releaseLock()
      }

      if (!state.content.trim()) {
        // 一个增量都没收到：交由上层回退到非流式请求
        throw new LlmClientError('流式响应没有任何内容', 'invalid_response')
      }

      return {
        content: state.content,
        reasoning: state.reasoning || undefined,
        model: state.model,
        promptTokens: state.promptTokens,
        completionTokens: state.completionTokens,
        finishReason: state.finishReason,
        streamed: true
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      clearTimeout(hardTimer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  async function chat(input: LlmChatInput): Promise<LlmChatResult> {
    try {
      return await send(input, input.json === true)
    } catch (error) {
      if (input.json === true && isJsonModeUnsupported(error)) {
        return send(input, false)
      }
      throw error
    }
  }

  async function chatStream(input: LlmStreamInput): Promise<LlmChatResult> {
    try {
      return await streamOnce(input, input.json === true)
    } catch (error) {
      if (input.signal?.aborted) throw error

      if (input.json === true && isJsonModeUnsupported(error)) {
        try {
          return await streamOnce(input, false)
        } catch (retryError) {
          if (!(retryError instanceof LlmClientError) || retryError.code !== 'invalid_response') {
            throw retryError
          }
          return send(input, false)
        }
      }

      // 网关不支持流式（直接报错或返回空流）：回退到一次性请求
      if (error instanceof LlmClientError && error.code === 'invalid_response') {
        return chat(input)
      }
      throw error
    }
  }

  async function testConnection(profile: LlmProfile, apiKey: string): Promise<LlmTestResult> {
    const startedAt = Date.now()
    try {
      const result = await chat({
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey,
        messages: [
          { role: 'system', content: '你是连通性测试端点，只需原样回复 OK。' },
          { role: 'user', content: 'ping' }
        ],
        maxOutputTokens: 16,
        temperature: 0,
        timeoutSeconds: Math.min(profile.timeoutSeconds ?? 30, 60),
        extraHeaders: profile.extraHeaders
      })
      return {
        ok: true,
        message: `连接正常（${result.model ?? profile.model}）：${result.content.trim().slice(0, 60)}`,
        latencyMs: Date.now() - startedAt
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message, latencyMs: Date.now() - startedAt }
    }
  }

  return { chat, chatStream, testConnection }
}
