import { connect as connectSocket, type Socket } from 'net'
import type { AppEnv } from '../shared/app-env'
import { MCP_LIMITS, parseControlMessage, serializeControlMessage, type ControlEvent, type ControlMessage, type ControlResponse, type McpErrorCode } from '../shared/mcp-control-protocol'
import { readMcpEndpointDescriptor } from '../main/services/mcp-endpoint'

export interface EndpointDiscoveryOptions {
  appEnv: AppEnv
  endpoint?: string
  runtimeDirectory?: string
}

export class McpControlClientError extends Error {
  readonly code: McpErrorCode
  readonly retryable: boolean
  readonly details?: unknown

  constructor(code: McpErrorCode, message: string, retryable = false, details?: unknown) {
    super(message)
    this.name = 'McpControlClientError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function asClientError(response: Extract<ControlResponse, { ok: false }>): McpControlClientError {
  return new McpControlClientError(response.error.code, response.error.message, response.error.retryable, response.error.details)
}

export class McpControlClient {
  private socket: Socket | null = null
  private descriptor: ReturnType<typeof readMcpEndpointDescriptor> = null
  private buffer = ''
  private counter = 0
  private pending = new Map<string, Pending>()
  private listeners = new Set<(event: ControlEvent) => void>()
  private connected = false
  private options: EndpointDiscoveryOptions | null = null
  private connectPromise: Promise<void> | null = null

  async connect(options: EndpointDiscoveryOptions): Promise<void> {
    this.options = { ...options }
    await this.disconnect()
    await this.ensureConnected()
  }

  private async openConnection(options: EndpointDiscoveryOptions): Promise<void> {
    await this.disconnect()
    const descriptor = readMcpEndpointDescriptor(options.appEnv, options.runtimeDirectory)
    if (!descriptor) throw new McpControlClientError('app_not_ready', 'Autoforge MCP is disabled or not running', true)
    this.descriptor = descriptor
    const endpoint = options.endpoint ?? descriptor.endpoint
    const socket = connectSocket(endpoint)
    this.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string | Buffer) => {
      if (this.socket === socket) this.onData(String(chunk))
    })
    socket.on('error', (error) => {
      if (this.socket === socket) this.onSocketError(error)
    })
    socket.on('close', () => this.onSocketClose(socket))
    await new Promise<void>((resolve, reject) => {
      const onConnect = (): void => {
        socket.removeListener('error', onError)
        resolve()
      }
      const onError = (error: Error): void => {
        socket.removeListener('connect', onConnect)
        reject(new McpControlClientError('app_not_ready', 'Unable to connect to Autoforge MCP', true, error.message))
      }
      socket.once('connect', onConnect)
      socket.once('error', onError)
    })
    await this.requestInternal('handshake', {
      protocolVersion: descriptor.protocolVersion,
      adapter: 'autoforge-mcp',
      token: descriptor.token
    })
    this.connected = true
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureConnected()
    return this.requestInternal<T>(method, params)
  }

  onEvent(listener: (event: ControlEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async close(): Promise<void> {
    this.options = null
    await this.disconnect()
  }

  private async ensureConnected(): Promise<void> {
    if (!this.options) throw new McpControlClientError('app_not_ready', 'Autoforge MCP connection is not configured', true)
    if (this.socket && !this.socket.destroyed && this.connected) {
      const current = readMcpEndpointDescriptor(this.options.appEnv, this.options.runtimeDirectory)
      if (
        current &&
        this.descriptor &&
        current.pid === this.descriptor.pid &&
        current.token === this.descriptor.token &&
        current.endpoint === this.descriptor.endpoint
      ) return
      await this.disconnect()
    }
    if (!this.connectPromise) {
      this.connectPromise = this.openConnection(this.options).finally(() => {
        this.connectPromise = null
      })
    }
    await this.connectPromise
  }

  private async disconnect(): Promise<void> {
    const socket = this.socket
    this.socket = null
    this.connected = false
    this.descriptor = null
    this.buffer = ''
    if (!socket) return
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new McpControlClientError('app_not_ready', 'MCP connection closed', true))
    }
    this.pending.clear()
    if (socket.destroyed) return
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.destroy()
    })
  }

  private requestInternal<T = unknown>(method: string, params?: unknown): Promise<T> {
    const socket = this.socket
    if (!socket || socket.destroyed) return Promise.reject(new McpControlClientError('app_not_ready', 'MCP connection is unavailable', true))
    const id = `${++this.counter}`
    const request = serializeControlMessage({ type: 'request', id, method, params })
    if (Buffer.byteLength(request, 'utf8') > MCP_LIMITS.maxFrameBytes) return Promise.reject(new McpControlClientError('invalid_params', 'request exceeds maximum frame size'))
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new McpControlClientError('timeout', 'MCP request timed out', true))
      }, MCP_LIMITS.requestTimeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      socket.write(request)
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer, 'utf8') > MCP_LIMITS.maxFrameBytes) {
      this.onSocketError(new McpControlClientError('invalid_params', 'control frame exceeds maximum size'))
      return
    }
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const raw = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (raw.trim()) this.onMessage(raw)
      newline = this.buffer.indexOf('\n')
    }
  }

  private onMessage(raw: string): void {
    let message: ControlMessage
    try {
      message = parseControlMessage(raw)
    } catch {
      this.onSocketError(new McpControlClientError('invalid_params', 'malformed control response'))
      return
    }
    if (message.type === 'event') {
      for (const listener of this.listeners) listener(message)
      return
    }
    if (message.type !== 'response') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(asClientError(message))
  }

  private onSocketError(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private onSocketClose(socket: Socket): void {
    if (this.socket !== socket) return
    this.connected = false
    this.socket = null
    this.descriptor = null
    this.buffer = ''
    this.onSocketError(new McpControlClientError('app_not_ready', 'MCP connection closed', true))
  }
}
