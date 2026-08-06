import { timingSafeEqual } from 'crypto'
import { createServer, type Server as NetServer, type Socket } from 'net'
import { MCP_LIMITS, MCP_PROTOCOL_VERSION, parseControlMessage, serializeControlMessage, type ControlEvent, type ControlErrorResponse, type ControlRequest, type ControlResponse, type McpErrorCode } from '../../shared/mcp-control-protocol'
import type { AppEnv } from '../../shared/app-env'
import { formatMcpCommandLine } from '../../shared/mcp-client-config'
import type { McpClientConfig, McpStatus, ScriptListInput } from '../../shared/mcp-types'
import type { ExecutionHistoryQuery, EnvironmentProfile } from '../../shared/types/script'
import { sanitizeErrorMessage, sanitizeEnvironment, sanitizeLogLine, sanitizeScriptItem, sanitizeSession } from './mcp-sanitizers'
import type { AutoforgeControlFacade } from './autoforge-control-facade'
import { McpAuditService, type McpAuditEntry } from './mcp-audit'
import { RunEventStore, type RunLogEvent } from './run-event-store'
import { cleanupMcpSocket, createMcpEndpointDescriptor, getMcpRuntimeDirectory, removeMcpEndpointDescriptor, writeMcpEndpointDescriptor, type McpEndpointOptions } from './mcp-endpoint'

export interface McpControlServerOptions {
  appVersion: string
  appEnv: AppEnv
  facade: AutoforgeControlFacade
  eventStore: RunEventStore
  audit: McpAuditService
  onStatus?: (status: McpStatus) => void
  endpoint?: string
  runtimeDirectory?: string
  token?: string
}

type Connection = {
  id: string
  socket: Socket
  buffer: string
  handshaken: boolean
  inFlight: Set<string>
  closed: boolean
}

type Params = Record<string, unknown>

const READ_METHODS = new Set([
  'app.status',
  'scripts.list',
  'scripts.get',
  'scripts.list-files',
  'scripts.read-file',
  'environments.list',
  'environments.get',
  'sessions.list',
  'sessions.get',
  'sessions.logs',
  'sessions.wait',
  'history.query'
])

const MUTATION_METHODS = new Set([
  'scripts.create',
  'scripts.import',
  'scripts.write-file',
  'scripts.update-meta',
  'scripts.delete',
  'environments.create',
  'environments.update',
  'environments.delete',
  'scripts.set-env',
  'scripts.set-params'
])

const RUN_METHODS = new Set(['scripts.start', 'sessions.stop', 'scripts.stop'])

function asParams(value: unknown): Params {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_params: params must be an object')
  return value as Params
}

function requiredString(params: Params, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid_params: ${key} must be a non-empty string`)
  return value.trim()
}

function stringValue(params: Params, key: string): string {
  const value = params[key]
  if (typeof value !== 'string') throw new Error(`invalid_params: ${key} must be a string`)
  return value
}

function optionalString(params: Params, key: string): string | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  return requiredString(params, key)
}

function booleanValue(params: Params, key: string, fallback = false): boolean {
  const value = params[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`invalid_params: ${key} must be boolean`)
  return value
}

function objectValue(params: Params, key: string): Record<string, unknown> {
  const value = params[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid_params: ${key} must be an object`)
  return value as Record<string, unknown>
}

function mapErrorCode(error: unknown): McpErrorCode {
  const message = error instanceof Error ? error.message : String(error)
  const prefix = message.match(/^([a-z_]+):/i)?.[1]
  if (prefix && ['app_not_ready', 'auth_failed', 'protocol_mismatch', 'invalid_params', 'not_found', 'confirmation_required', 'path_forbidden', 'validation_failed', 'conflict', 'busy', 'timeout', 'internal'].includes(prefix)) {
    return prefix as McpErrorCode
  }
  if (/not found|不存在|no such|missing/i.test(message)) return 'not_found'
  if (/invalid|must be|不能为空|非法/i.test(message)) return 'invalid_params'
  if (/busy|concurrent|并发|上限/i.test(message)) return 'busy'
  if (/timeout|超时/i.test(message)) return 'timeout'
  return 'internal'
}

function mapError(error: unknown): ControlErrorResponse['error'] {
  const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error))
  const code = mapErrorCode(error)
  return {
    code,
    message,
    retryable: code === 'app_not_ready' || code === 'invalid_params' || code === 'not_found' || code === 'busy' || code === 'timeout',
    details: undefined
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export class McpControlServer {
  private readonly options: McpControlServerOptions
  private readonly connections = new Map<string, Connection>()
  private netServer: NetServer | null = null
  private descriptor: ReturnType<typeof createMcpEndpointDescriptor> | null = null
  private lastConnectionAt: string | undefined
  private enabled = false
  private stopping = false

  constructor(options: McpControlServerOptions) {
    this.options = options
  }

  attachEventStore(): void {
    this.options.eventStore.on('session', this.onSession)
    this.options.eventStore.on('log', this.onLog)
  }

  detachEventStore(): void {
    this.options.eventStore.removeListener('session', this.onSession)
    this.options.eventStore.removeListener('log', this.onLog)
  }

  getStatus(): McpStatus {
    return {
      enabled: this.enabled,
      running: this.netServer !== null,
      appVersion: this.options.appVersion,
      appEnv: this.options.appEnv,
      transport: this.descriptor?.transport,
      endpoint: this.descriptor?.endpoint,
      connectionCount: this.connections.size,
      lastConnectionAt: this.lastConnectionAt
    }
  }

  async start(): Promise<McpStatus> {
    if (this.netServer) {
      this.enabled = true
      return this.getStatus()
    }
    this.stopping = false
    const runtimeDirectory = getMcpRuntimeDirectory(this.options.appEnv, this.options.runtimeDirectory)
    this.descriptor = createMcpEndpointDescriptor(this.options.appVersion, this.options.appEnv, {
      endpoint: this.options.endpoint,
      runtimeDirectory,
      token: this.options.token
    } satisfies McpEndpointOptions)
    cleanupMcpSocket(this.descriptor.endpoint, this.descriptor.transport)
    const server = createServer((socket) => this.accept(socket))
    this.netServer = server
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.removeListener('listening', onListening)
          reject(error)
        }
        const onListening = (): void => {
          server.removeListener('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(this.descriptor!.endpoint)
      })
      writeMcpEndpointDescriptor(this.descriptor, runtimeDirectory)
    } catch (error) {
      this.stopping = true
      for (const connection of this.connections.values()) connection.socket.destroy()
      this.connections.clear()
      this.netServer = null
      await closeNetServer(server)
      cleanupMcpSocket(this.descriptor.endpoint, this.descriptor.transport)
      removeMcpEndpointDescriptor(this.descriptor.appEnv, this.descriptor, runtimeDirectory)
      this.descriptor = null
      this.enabled = false
      throw error
    }
    this.enabled = true
    this.publishStatus()
    return this.getStatus()
  }

  async stop(): Promise<void> {
    if (!this.netServer && !this.descriptor) {
      this.enabled = false
      return
    }
    this.stopping = true
    for (const connection of this.connections.values()) connection.socket.destroy()
    this.connections.clear()
    const server = this.netServer
    this.netServer = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (this.descriptor) {
      cleanupMcpSocket(this.descriptor.endpoint, this.descriptor.transport)
      removeMcpEndpointDescriptor(this.descriptor.appEnv, this.descriptor, this.options.runtimeDirectory)
    }
    this.descriptor = null
    this.enabled = false
    this.publishStatus()
  }

  async rotateToken(): Promise<McpStatus> {
    const wasEnabled = this.enabled
    await this.stop()
    if (!wasEnabled) return this.getStatus()
    this.options.token = undefined
    return this.start()
  }

  async dispose(): Promise<void> {
    await this.stop()
  }

  private publishStatus(): void {
    this.options.onStatus?.(this.getStatus())
  }

  private accept(socket: Socket): void {
    if (this.stopping || this.connections.size >= MCP_LIMITS.maxConnections) {
      socket.destroy()
      return
    }
    const connection: Connection = {
      id: `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      socket,
      buffer: '',
      handshaken: false,
      inFlight: new Set(),
      closed: false
    }
    this.connections.set(connection.id, connection)
    this.lastConnectionAt = new Date().toISOString()
    this.publishStatus()
    socket.setEncoding('utf8')
    socket.setTimeout(MCP_LIMITS.requestTimeoutMs, () => socket.destroy())
    socket.on('data', (chunk: string | Buffer) => this.onData(connection, String(chunk)))
    socket.on('close', () => this.closeConnection(connection))
    socket.on('error', () => this.closeConnection(connection))
  }

  private closeConnection(connection: Connection): void {
    if (connection.closed) return
    connection.closed = true
    this.connections.delete(connection.id)
    this.publishStatus()
  }

  private onData(connection: Connection, chunk: string): void {
    if (connection.closed) return
    connection.buffer += chunk
    if (Buffer.byteLength(connection.buffer, 'utf8') > MCP_LIMITS.maxFrameBytes) {
      this.sendError(connection, 'frame-too-large', 'invalid_params', 'control frame exceeds maximum size')
      connection.socket.destroy()
      return
    }
    let newline = connection.buffer.indexOf('\n')
    while (newline >= 0) {
      const raw = connection.buffer.slice(0, newline).replace(/\r$/, '')
      connection.buffer = connection.buffer.slice(newline + 1)
      if (raw.trim()) {
        void this.handleRaw(connection, raw)
      }
      newline = connection.buffer.indexOf('\n')
    }
  }

  private async handleRaw(connection: Connection, raw: string): Promise<void> {
    let message: ReturnType<typeof parseControlMessage>
    try {
      if (Buffer.byteLength(raw, 'utf8') > MCP_LIMITS.maxFrameBytes) throw new Error('frame-too-large')
      message = parseControlMessage(raw)
    } catch {
      this.sendError(connection, 'malformed', 'invalid_params', 'malformed control message')
      connection.socket.destroy()
      return
    }
    if (message.type !== 'request') return
    if (!connection.handshaken) {
      await this.handleHandshake(connection, message)
      return
    }
    if (connection.inFlight.size >= MCP_LIMITS.maxInFlightPerConnection) {
      this.sendError(connection, message.id, 'busy', 'too many in-flight requests')
      return
    }
    if (connection.inFlight.has(message.id)) {
      this.sendError(connection, message.id, 'conflict', 'duplicate request id')
      return
    }
    connection.inFlight.add(message.id)
    const confirmed = Boolean((message.params as Params | undefined)?.confirm)
    const target = this.targetFor(message)
    const timeoutMs = message.method === 'sessions.wait'
      ? Math.min(MCP_LIMITS.maxWaitTimeoutMs, Math.max(1, Number((message.params as Params | undefined)?.timeoutMs ?? MCP_LIMITS.defaultWaitTimeoutMs)))
      : MCP_LIMITS.requestTimeoutMs
    try {
      const result = await this.withTimeout(this.dispatch(message), timeoutMs)
      this.sendResult(connection, message.id, result)
      this.recordAudit(connection, message, target, confirmed, 'success')
    } catch (error) {
      const mapped = mapError(error)
      this.sendResponse(connection, { type: 'response', id: message.id, ok: false, error: mapped })
      this.recordAudit(connection, message, target, confirmed, mapped.code === 'confirmation_required' ? 'rejected' : 'error', mapped.code)
    } finally {
      connection.inFlight.delete(message.id)
    }
  }

  private async handleHandshake(connection: Connection, request: ControlRequest): Promise<void> {
    if (request.method !== 'handshake') {
      this.sendError(connection, request.id, 'auth_failed', 'handshake required')
      connection.socket.destroy()
      return
    }
    try {
      const params = asParams(request.params)
      const version = requiredString(params, 'protocolVersion')
      const token = requiredString(params, 'token')
      if (version !== MCP_PROTOCOL_VERSION) throw new Error('protocol_mismatch: unsupported protocol version')
      const expected = Buffer.from(this.descriptor?.token ?? '', 'utf8')
      const actual = Buffer.from(token, 'utf8')
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('auth_failed: invalid token')
      connection.handshaken = true
      connection.socket.setTimeout(0)
      this.sendResult(connection, request.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        appVersion: this.options.appVersion,
        appEnv: this.options.appEnv
      })
    } catch (error) {
      this.sendResponse(connection, { type: 'response', id: request.id, ok: false, error: mapError(error) })
      connection.socket.destroy()
    }
  }

  private async dispatch(request: ControlRequest): Promise<unknown> {
    const params = asParams(request.params)
    if (!READ_METHODS.has(request.method) && !MUTATION_METHODS.has(request.method) && !RUN_METHODS.has(request.method)) {
      throw new Error('invalid_params: unknown method')
    }
    if (MUTATION_METHODS.has(request.method) || (request.method === 'scripts.start' && Boolean(params.persistParams))) {
      if (!booleanValue(params, 'confirm')) throw new Error('confirmation_required: confirm must be true')
    }

    switch (request.method) {
      case 'app.status': return this.getStatus()
      case 'scripts.list': return this.options.facade.listScripts(params as ScriptListInput)
      case 'scripts.get': {
        const script = this.options.facade.getScript(requiredString(params, 'scriptId'))
        if (!script) throw new Error('not_found: script')
        return sanitizeScriptItem(script)
      }
      case 'scripts.list-files': {
        const result = this.options.facade.listScriptFiles(requiredString(params, 'scriptId'))
        if (!result) throw new Error('not_found: script')
        return result
      }
      case 'scripts.read-file': {
        const result = this.options.facade.readScriptFile({
          scriptId: requiredString(params, 'scriptId'),
          relativePath: requiredString(params, 'relativePath'),
          limit: params.limit === undefined ? undefined : Number(params.limit)
        })
        if (!result) throw new Error('not_found: script or file')
        return result
      }
      case 'environments.list': return this.options.facade.listEnvironments().map((item) => sanitizeEnvironment(item))
      case 'environments.get': {
        const result = this.options.facade.getEnvironment({ envId: requiredString(params, 'envId'), scriptId: optionalString(params, 'scriptId') })
        if (!result) throw new Error('not_found: environment')
        return result
      }
      case 'sessions.list': {
        const scriptId = optionalString(params, 'scriptId')
        return this.options.facade.listSessions().filter((session) => !scriptId || session.scriptId === scriptId).map(sanitizeSession)
      }
      case 'sessions.get': {
        const result = this.options.facade.getSession(requiredString(params, 'sessionId'))
        if (!result) throw new Error('not_found: session')
        return sanitizeSession(result)
      }
      case 'sessions.logs': {
        const sessionId = requiredString(params, 'sessionId')
        const cursor = Number(params.cursor ?? 0)
        const limit = Number(params.limit ?? 200)
        if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1) throw new Error('invalid_params: cursor and limit must be positive integers')
        const page = this.options.eventStore.getLogs(sessionId, cursor, limit)
        return { sessionId, ...page, lines: page.lines.map(sanitizeLogLine) }
      }
      case 'sessions.wait': {
        const sessionId = requiredString(params, 'sessionId')
        const timeoutMs = Math.min(MCP_LIMITS.maxWaitTimeoutMs, Math.max(1, Number(params.timeoutMs ?? MCP_LIMITS.defaultWaitTimeoutMs)))
        if (!Number.isFinite(timeoutMs)) throw new Error('invalid_params: timeoutMs must be a number')
        return this.options.eventStore.waitForTerminal(sessionId, timeoutMs).then(sanitizeSession)
      }
      case 'history.query': return this.options.facade.queryHistory(params as ExecutionHistoryQuery)
      case 'scripts.start': return this.options.facade.startScript({
        scriptId: requiredString(params, 'scriptId'),
        envId: optionalString(params, 'envId'),
        params: params.params === undefined ? undefined : this.stringMap(params.params, 'params'),
        persistParams: booleanValue(params, 'persistParams'),
        browserOverride: params.browserOverride as { headless?: boolean } | undefined
      }).then(sanitizeSession)
      case 'sessions.stop': {
        const result = this.options.facade.stopSession(requiredString(params, 'sessionId'))
        if (!result) throw new Error('not_found: session')
        return sanitizeSession(result)
      }
      case 'scripts.stop': {
        const scriptId = requiredString(params, 'scriptId')
        if (!this.options.facade.getScript(scriptId)) throw new Error('not_found: script')
        this.options.facade.stopScript(scriptId)
        return { scriptId, stopped: true }
      }
      case 'scripts.create': {
        const input = params.input && typeof params.input === 'object'
          ? objectValue(params, 'input')
          : { manifest: params.manifest, files: params.files }
        if (!input.manifest || !Array.isArray(input.files)) throw new Error('invalid_params: manifest and files are required')
        const result = this.options.facade.createScript(input as never)
        return sanitizeScriptItem(result)
      }
      case 'scripts.import': {
        const sourcePath = requiredString(params, 'sourcePath')
        if (!isAbsolutePath(sourcePath)) throw new Error('path_forbidden: sourcePath must be absolute')
        return sanitizeScriptItem(this.options.facade.importScript(sourcePath))
      }
      case 'scripts.write-file': {
        const result = this.options.facade.writeScriptFile({
          scriptId: requiredString(params, 'scriptId'),
          relativePath: requiredString(params, 'relativePath'),
          content: stringValue(params, 'content'),
          encoding: params.encoding as 'utf8' | 'base64' | undefined
        })
        if (!result) throw new Error('not_found: script')
        return sanitizeScriptItem(result)
      }
      case 'scripts.update-meta': {
        const result = this.options.facade.updateScriptMeta({ scriptId: requiredString(params, 'scriptId'), patch: objectValue(params, 'patch') as never })
        if (!result) throw new Error('not_found: script')
        return sanitizeScriptItem(result)
      }
      case 'scripts.delete': {
        const scriptId = requiredString(params, 'scriptId')
        if (!this.options.facade.deleteScript(scriptId)) throw new Error('not_found: script')
        return { scriptId, deleted: true }
      }
      case 'environments.create': {
        const profile = objectValue(params, 'profile') as Omit<EnvironmentProfile, 'id'>
        return sanitizeEnvironment(this.options.facade.createEnvironment(profile))
      }
      case 'environments.update': {
        const id = requiredString(params, 'envId')
        const result = this.options.facade.updateEnvironment(id, objectValue(params, 'patch') as Partial<EnvironmentProfile>)
        if (!result) throw new Error('not_found: environment')
        return sanitizeEnvironment(result)
      }
      case 'environments.delete': {
        const id = requiredString(params, 'envId')
        if (!this.options.facade.deleteEnvironment(id)) throw new Error('not_found: environment')
        return { envId: id, deleted: true }
      }
      case 'scripts.set-env': return this.setScriptValues(params, 'env')
      case 'scripts.set-params': return this.setScriptValues(params, 'params')
      default: throw new Error('invalid_params: unsupported method')
    }
  }

  private setScriptValues(params: Params, kind: 'env' | 'params'): unknown {
    const input = {
      scriptId: requiredString(params, 'scriptId'),
      envId: requiredString(params, 'envId'),
      values: this.stringMap(params.values, 'values')
    }
    const result = kind === 'env' ? this.options.facade.setScriptEnv(input) : this.options.facade.setScriptParams(input)
    if (!result) throw new Error('not_found: script or environment')
    const script = sanitizeScriptItem(result)
    return { scriptId: input.scriptId, envId: input.envId, changedKeys: Object.keys(input.values), script }
  }

  private stringMap(value: unknown, key: string): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid_params: ${key} must be an object`)
    const result: Record<string, string> = {}
    for (const [name, item] of Object.entries(value)) {
      if (typeof item !== 'string') throw new Error(`invalid_params: ${key}.${name} must be a string`)
      result[name] = item
    }
    return result
  }

  private targetFor(request: ControlRequest): string | undefined {
    const params = request.params && typeof request.params === 'object' ? request.params as Params : {}
    for (const key of ['scriptId', 'sessionId', 'envId', 'sourcePath']) {
      if (typeof params[key] === 'string') return params[key] as string
    }
    return undefined
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout: request exceeded timeout')), timeoutMs)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private recordAudit(connection: Connection, request: ControlRequest, target: string | undefined, confirmed: boolean, outcome: McpAuditEntry['outcome'], errorCode?: McpErrorCode): void {
    this.options.audit.record({
      ts: new Date().toISOString(),
      connectionId: connection.id,
      requestId: request.id,
      operation: request.method,
      target,
      confirmed,
      outcome,
      errorCode
    })
  }

  private sendResult(connection: Connection, id: string, result: unknown): void {
    this.sendResponse(connection, { type: 'response', id, ok: true, result: clone(result) })
  }

  private sendError(connection: Connection, id: string, code: McpErrorCode | string, message: string): void {
    const validCode = code as McpErrorCode
    this.sendResponse(connection, { type: 'response', id, ok: false, error: { code: validCode, message, retryable: false } })
  }

  private sendResponse(connection: Connection, response: ControlResponse): void {
    if (connection.closed || connection.socket.destroyed) return
    connection.socket.write(serializeControlMessage(response))
  }

  private broadcast(event: ControlEvent): void {
    for (const connection of this.connections.values()) {
      if (connection.handshaken) this.sendResponse(connection, event as never)
    }
  }

  private readonly onSession = (session: unknown): void => {
    this.broadcast({ type: 'event', event: 'session.updated', data: sanitizeSession(session as never) })
  }

  private readonly onLog = (event: RunLogEvent): void => {
    this.broadcast({ type: 'event', event: 'log.appended', data: { ...event, line: sanitizeLogLine(event.line) } })
  }
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')
}

async function closeNetServer(server: NetServer): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

let configuredServer: McpControlServer | null = null

export function configureMcpControlServer(options: McpControlServerOptions): McpControlServer {
  if (configuredServer) {
    configuredServer.detachEventStore()
    void configuredServer.dispose()
  }
  configuredServer = new McpControlServer(options)
  configuredServer.attachEventStore()
  return configuredServer
}

export function getConfiguredMcpControlServer(): McpControlServer | null {
  return configuredServer
}

export async function startMcpControlServer(options?: McpControlServerOptions): Promise<McpStatus> {
  const server = options ? configureMcpControlServer(options) : configuredServer
  if (!server) throw new Error('app_not_ready: MCP control server is not configured')
  return server.start()
}

export async function stopMcpControlServer(): Promise<void> {
  if (!configuredServer) return
  await configuredServer.stop()
}

export async function rotateMcpToken(): Promise<McpStatus> {
  if (!configuredServer) throw new Error('app_not_ready: MCP control server is not configured')
  return configuredServer.rotateToken()
}

export function getMcpControlStatus(): McpStatus {
  if (!configuredServer) {
    return {
      enabled: false,
      running: false,
      appVersion: 'unknown',
      appEnv: 'production',
      connectionCount: 0
    }
  }
  return configuredServer.getStatus()
}

export function getMcpClientConfig(appEnv: AppEnv): McpClientConfig {
  if (appEnv === 'development') {
    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const args = ['--prefix', process.cwd(), 'run', 'mcp', '--', '--app-env', 'development']
    return {
      command,
      args,
      appEnv,
      displayCommand: formatMcpCommandLine(command, args)
    }
  }
  const command = process.execPath
  const displayName = process.platform === 'win32' ? 'Autoforge.exe' : 'Autoforge'
  const args = ['--mcp-stdio', '--app-env', appEnv]
  return {
    command,
    args,
    appEnv,
    displayCommand: formatMcpCommandLine(displayName, args)
  }
}
