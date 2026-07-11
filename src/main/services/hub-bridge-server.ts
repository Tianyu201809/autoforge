import http from 'http'
import { URL } from 'url'
import pkg from '../../../package.json'
import { HubInstallError, installScriptFromHubZip } from './hub-script-installer'

export const HUB_BRIDGE_HOST = '127.0.0.1'
export const HUB_BRIDGE_PORT = 19276

const MAX_BODY_BYTES = 64 * 1024

let server: http.Server | null = null
let installing = false
let onInstalled: ((payload: { scriptId: string; name: string }) => void) | null = null

function setCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  setCors(res)
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

function statusForError(code: string): number {
  switch (code) {
    case 'invalid_request':
    case 'invalid_package':
      return 400
    case 'download_failed':
      return 502
    case 'import_failed':
      return 500
    case 'busy':
      return 409
    default:
      return 500
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0

    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new HubInstallError('invalid_request', '请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    req.on('error', (err) => {
      reject(err)
    })
  })
}

async function handleInstall(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (installing) {
    sendJson(res, 409, {
      ok: false,
      error: 'busy',
      message: '正在安装，请稍候'
    })
    return
  }

  installing = true
  try {
    const raw = await readBody(req)
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      throw new HubInstallError('invalid_request', '请求体不是合法 JSON')
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new HubInstallError('invalid_request', '请求体必须是 JSON 对象')
    }

    const input = body as {
      zipUrl?: unknown
      scriptName?: unknown
      hubScriptId?: unknown
    }

    const result = await installScriptFromHubZip({
      zipUrl: input.zipUrl as string,
      scriptName: typeof input.scriptName === 'string' ? input.scriptName : undefined,
      hubScriptId: typeof input.hubScriptId === 'string' ? input.hubScriptId : undefined
    })

    onInstalled?.({ scriptId: result.scriptId, name: result.name })
    sendJson(res, 200, { ok: true, scriptId: result.scriptId, name: result.name })
  } catch (err) {
    if (err instanceof HubInstallError) {
      sendJson(res, statusForError(err.code), {
        ok: false,
        error: err.code,
        message: err.message
      })
      return
    }

    const message = err instanceof Error ? err.message : String(err)
    sendJson(res, 500, {
      ok: false,
      error: 'import_failed',
      message
    })
  } finally {
    installing = false
  }
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const host = req.headers.host ?? `${HUB_BRIDGE_HOST}:${HUB_BRIDGE_PORT}`
  let pathname: string
  try {
    pathname = new URL(req.url ?? '/', `http://${host}`).pathname
  } catch {
    sendJson(res, 404, { ok: false, error: 'invalid_request', message: '无效路径' })
    return
  }

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      app: 'autoforge',
      version: pkg.version
    })
    return
  }

  if (req.method === 'POST' && pathname === '/install') {
    void handleInstall(req, res)
    return
  }

  sendJson(res, 404, { ok: false, error: 'invalid_request', message: '未找到接口' })
}

export function startHubBridgeServer(options: {
  onInstalled: (payload: { scriptId: string; name: string }) => void
}): void {
  if (server) {
    return
  }

  onInstalled = options.onInstalled
  server = http.createServer((req, res) => {
    handleRequest(req, res)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[hub-bridge] Port ${HUB_BRIDGE_PORT} is already in use; Hub install bridge not started.`
      )
      server = null
      onInstalled = null
      return
    }
    console.error('[hub-bridge] Server error:', err)
  })

  server.listen(HUB_BRIDGE_PORT, HUB_BRIDGE_HOST, () => {
    console.info(`[hub-bridge] Listening on http://${HUB_BRIDGE_HOST}:${HUB_BRIDGE_PORT}`)
  })
}

export function stopHubBridgeServer(): void {
  if (!server) {
    return
  }

  const current = server
  server = null
  onInstalled = null
  current.close()
}
