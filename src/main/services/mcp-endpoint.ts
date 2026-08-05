import { randomBytes } from 'crypto'
import { app } from 'electron'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import type { AppEnv } from '../../shared/app-env'
import { MCP_PROTOCOL_VERSION, type McpEndpointDescriptor, type McpTransportKind } from '../../shared/mcp-control-protocol'
import { UTF8 } from '../../shared/encoding'
import { getAppUserDataPath } from './app-data-root'

const DESCRIPTOR_NAME = 'mcp-endpoint.json'

function isElectronAppReady(): boolean {
  try {
    return typeof app?.isReady === 'function' && app.isReady()
  } catch {
    return false
  }
}

function resolveBaseAppDataPath(): string {
  const override = process.env.AUTOFORGE_DATA_ROOT?.trim()
  if (override) return override

  if (isElectronAppReady()) {
    try {
      return getAppUserDataPath()
    } catch {
      return join(homedir(), '.autoforge')
    }
  }

  const appData = process.platform === 'win32'
    ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(appData, `autoforge-${process.env.AUTOFORGE_APP_ENV === 'development' ? 'development' : 'production'}`)
}

export function getMcpRuntimeDirectory(appEnv: AppEnv, runtimeDirectory?: string): string {
  if (runtimeDirectory) return runtimeDirectory
  if (isElectronAppReady()) return join(resolveBaseAppDataPath(), 'runtime')

  const override = process.env.AUTOFORGE_DATA_ROOT?.trim()
  if (override) return join(override, 'runtime')
  const appData = process.platform === 'win32'
    ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(appData, `autoforge-${appEnv}`, 'runtime')
}

export function getMcpDescriptorPath(appEnv: AppEnv, runtimeDirectory?: string): string {
  return join(getMcpRuntimeDirectory(appEnv, runtimeDirectory), DESCRIPTOR_NAME)
}

function resolveUserSuffix(): string {
  const user = process.env.USERNAME || process.env.USER || basename(homedir())
  return user.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'user'
}

function resolveEndpoint(appEnv: AppEnv, transport: McpTransportKind, runtimeDirectory?: string): string {
  if (transport === 'named-pipe') {
    return `\\\\.\\pipe\\autoforge-mcp-${appEnv}-${resolveUserSuffix()}`
  }
  return join(getMcpRuntimeDirectory(appEnv, runtimeDirectory), 'mcp.sock')
}

export interface McpEndpointOptions {
  endpoint?: string
  runtimeDirectory?: string
  pid?: number
  token?: string
  createdAt?: string
}

export function createMcpEndpointDescriptor(
  appVersion: string,
  appEnv: AppEnv,
  options: McpEndpointOptions = {}
): McpEndpointDescriptor {
  const transport: McpTransportKind = process.platform === 'win32' ? 'named-pipe' : 'unix-socket'
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    appVersion,
    appEnv,
    pid: options.pid ?? process.pid,
    transport,
    endpoint: options.endpoint ?? resolveEndpoint(appEnv, transport, options.runtimeDirectory),
    token: options.token ?? randomBytes(32).toString('hex'),
    createdAt: options.createdAt ?? new Date().toISOString()
  }
}

function descriptorLooksValid(value: unknown): value is McpEndpointDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    item.protocolVersion === MCP_PROTOCOL_VERSION &&
    typeof item.appVersion === 'string' &&
    (item.appEnv === 'development' || item.appEnv === 'production') &&
    typeof item.pid === 'number' &&
    (item.transport === 'named-pipe' || item.transport === 'unix-socket') &&
    typeof item.endpoint === 'string' &&
    typeof item.token === 'string' &&
    /^[0-9a-f]{64}$/i.test(item.token) &&
    typeof item.createdAt === 'string'
  )
}

export function writeMcpEndpointDescriptor(
  descriptor: McpEndpointDescriptor,
  runtimeDirectory?: string
): void {
  const descriptorPath = getMcpDescriptorPath(descriptor.appEnv, runtimeDirectory)
  const directory = dirname(descriptorPath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  try {
    chmodSync(directory, 0o700)
  } catch {
    if (process.platform !== 'win32') throw new Error('unable to secure MCP runtime directory')
  }
  const temporaryPath = `${descriptorPath}.${process.pid}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: UTF8, mode: 0o600 })
  renameSync(temporaryPath, descriptorPath)
  try {
    chmodSync(descriptorPath, 0o600)
  } catch {
    if (process.platform !== 'win32') throw new Error('unable to secure MCP descriptor')
  }
}

export function readMcpEndpointDescriptor(
  appEnv: AppEnv,
  runtimeDirectory?: string
): McpEndpointDescriptor | null {
  const descriptorPath = getMcpDescriptorPath(appEnv, runtimeDirectory)
  if (!existsSync(descriptorPath)) return null
  try {
    const value: unknown = JSON.parse(readFileSync(descriptorPath, UTF8))
    if (!descriptorLooksValid(value)) return null
    if (value.appEnv !== appEnv) return null
    if (value.transport === 'unix-socket' && existsSync(value.endpoint)) {
      const stat = statSync(value.endpoint)
      if (!stat.isSocket()) return null
    }
    return value
  } catch {
    return null
  }
}

export function removeMcpEndpointDescriptor(
  appEnv: AppEnv,
  expected?: Pick<McpEndpointDescriptor, 'pid' | 'token'>,
  runtimeDirectory?: string
): void {
  const descriptorPath = getMcpDescriptorPath(appEnv, runtimeDirectory)
  if (!existsSync(descriptorPath)) return
  if (expected) {
    const current = readMcpEndpointDescriptor(appEnv, runtimeDirectory)
    if (!current || current.pid !== expected.pid || current.token !== expected.token) return
  }
  try {
    rmSync(descriptorPath, { force: true })
  } catch {
    return
  }
}

export function cleanupMcpSocket(endpoint: string, transport: McpTransportKind): void {
  if (transport !== 'unix-socket' || !existsSync(endpoint)) return
  try {
    rmSync(endpoint, { force: true })
  } catch {
    return
  }
}
