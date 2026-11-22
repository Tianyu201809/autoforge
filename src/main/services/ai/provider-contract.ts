import type {
  LlmMessage,
  LlmProfile,
  LlmProfileView,
  LlmProviderKind,
  LlmStreamEvent,
  LlmToolDefinition
} from '../../../shared/ai-types'

export interface ModelCredentials {
  apiKey?: string
  extraHeaders: Record<string, string>
}

export interface LlmRequest {
  profile: LlmProfile
  credentials: ModelCredentials
  messages: LlmMessage[]
  tools: LlmToolDefinition[]
  signal?: AbortSignal
}

export interface LlmProviderAdapter {
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'config' | 'auth' | 'rate_limit' | 'network' | 'timeout' | 'invalid_response' | 'cancelled',
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'LlmProviderError'
  }
}

const PROVIDER_KINDS = new Set<LlmProviderKind>([
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible'
])

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export type LlmProfileInput = Omit<LlmProfile, 'createdAt' | 'updatedAt'> & {
  createdAt?: string
  updatedAt?: string
}

export function normalizeLlmProfile(
  input: LlmProfileInput,
  now: string,
  previous?: LlmProfile
): LlmProfile {
  const id = input.id?.trim()
  const name = input.name?.trim()
  const model = input.model?.trim()
  const rawBaseUrl = input.baseUrl?.trim()

  if (!id) throw new Error('配置 ID 不能为空')
  if (!name) throw new Error('配置名称不能为空')
  if (!PROVIDER_KINDS.has(input.provider)) throw new Error('模型供应商无效')
  if (!rawBaseUrl) throw new Error('请填写接口地址')
  if (!model) throw new Error('请填写模型名称')

  let baseUrl: string
  try {
    const url = new URL(rawBaseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('protocol')
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('url-components')
    }
    baseUrl = url.toString().replace(/\/+$/, '')
  } catch {
    throw new Error('接口地址必须是有效的 HTTP 或 HTTPS URL')
  }

  const timeoutSeconds = Number(input.timeoutSeconds)
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 900) {
    throw new Error('请求超时必须在 5 到 900 秒之间')
  }

  const seenHeaderNames = new Set<string>()
  const extraHeaderNames = (input.extraHeaderNames ?? []).map((header) => header.trim()).filter((header) => {
    const normalized = header.toLowerCase()
    if (seenHeaderNames.has(normalized)) return false
    seenHeaderNames.add(normalized)
    return true
  })
  if (extraHeaderNames.some((header) => !HEADER_NAME.test(header))) {
    throw new Error('额外请求头名称无效')
  }

  return {
    id,
    name,
    provider: input.provider,
    baseUrl,
    model,
    timeoutSeconds,
    extraHeaderNames,
    presetId: input.presetId?.trim() || undefined,
    createdAt: previous?.createdAt ?? input.createdAt ?? now,
    updatedAt: now
  }
}

export function toLlmProfileView(profile: LlmProfile, credentials?: ModelCredentials): LlmProfileView {
  const extraHeaderNames = [...new Set([
    ...profile.extraHeaderNames,
    ...Object.keys(credentials?.extraHeaders ?? {})
  ])]
  return {
    ...profile,
    extraHeaderNames,
    hasApiKey: Boolean(credentials?.apiKey?.trim())
  }
}
