export const MCP_PROTOCOL_VERSION = '1.0'

export const MCP_LIMITS = {
  maxFrameBytes: 8 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
  maxCreatePayloadBytes: 8 * 1024 * 1024,
  maxConnections: 8,
  maxInFlightPerConnection: 16,
  requestTimeoutMs: 30_000,
  maxWaitTimeoutMs: 60_000,
  defaultWaitTimeoutMs: 30_000
} as const

export type McpErrorCode =
  | 'app_not_ready'
  | 'auth_failed'
  | 'protocol_mismatch'
  | 'invalid_params'
  | 'not_found'
  | 'confirmation_required'
  | 'path_forbidden'
  | 'validation_failed'
  | 'conflict'
  | 'busy'
  | 'timeout'
  | 'internal'

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

export interface ControlSuccessResponse<T = unknown> {
  type: 'response'
  id: string
  ok: true
  result: T
}

export interface ControlErrorResponse {
  type: 'response'
  id: string
  ok: false
  error: {
    code: McpErrorCode
    message: string
    retryable: boolean
    details?: unknown
  }
}

export type ControlResponse<T = unknown> = ControlSuccessResponse<T> | ControlErrorResponse

export type ControlEventName = 'session.updated' | 'log.appended' | 'log.gap'

export interface ControlEvent {
  type: 'event'
  event: ControlEventName
  data: unknown
}

export type ControlMessage = ControlRequest | ControlResponse | ControlEvent

export function serializeControlMessage(message: ControlMessage): string {
  return `${JSON.stringify(message)}\n`
}

export function parseControlMessage(raw: string): ControlMessage {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('control message must be an object')
  }

  const message = value as Record<string, unknown>
  if (message.type === 'request') {
    if (typeof message.id !== 'string' || !message.id || typeof message.method !== 'string' || !message.method) {
      throw new Error('invalid control request')
    }
    return {
      type: 'request',
      id: message.id,
      method: message.method,
      params: message.params
    }
  }

  if (message.type === 'event') {
    if (message.event !== 'session.updated' && message.event !== 'log.appended' && message.event !== 'log.gap') {
      throw new Error('invalid control event')
    }
    return {
      type: 'event',
      event: message.event,
      data: message.data
    }
  }

  if (message.type === 'response') {
    if (typeof message.id !== 'string' || !message.id || typeof message.ok !== 'boolean') {
      throw new Error('invalid control response')
    }
    if (message.ok) {
      return { type: 'response', id: message.id, ok: true, result: message.result }
    }
    const error = message.error
    if (!error || typeof error !== 'object' || Array.isArray(error)) {
      throw new Error('invalid control error response')
    }
    const errorObject = error as Record<string, unknown>
    if (typeof errorObject.code !== 'string' || typeof errorObject.message !== 'string') {
      throw new Error('invalid control error details')
    }
    const parsedError: ControlErrorResponse['error'] = {
      code: errorObject.code as McpErrorCode,
      message: errorObject.message,
      retryable: errorObject.retryable === true
    }
    if (errorObject.details !== undefined) parsedError.details = errorObject.details
    return {
      type: 'response',
      id: message.id,
      ok: false,
      error: parsedError
    }
  }

  throw new Error('unknown control message type')
}
