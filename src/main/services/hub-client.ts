import type { HubCredentialStore } from './hub-credential-store'
import { HubClientError, type HubPlugin, type HubPluginListResult, type HubPluginQuery, type HubSession, type HubTeam, type HubUser } from '../../shared/hub-types'

type ResponseLike = { ok: boolean; status: number; json(): Promise<unknown> }
type InstallResult = { scriptId: string; name: string; status: 'installed' | 'updated' | 'duplicate_cancelled' }

function toUser(value: unknown): HubUser | null {
  if (!value || typeof value !== 'object') return null
  const user = value as Record<string, unknown>
  if (typeof user.id !== 'string' || typeof user.email !== 'string') return null
  return { id: user.id, email: user.email, displayName: typeof user.displayName === 'string' ? user.displayName : user.email, avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : '', teamCount: typeof user.teamCount === 'number' ? user.teamCount : 0 }
}

function errorFor(status: number, message: string): HubClientError {
  const code = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 409 ? 'busy' : status === 429 ? 'quota_exceeded' : 'network'
  return new HubClientError(code, message || 'AutoforgeHub 请求失败', status)
}

export function createHubClient(options: {
  getHubUrl(): string
  credentials: HubCredentialStore
  request(url: string, init?: RequestInit): Promise<ResponseLike>
  install(input: { zipUrl: string; scriptName: string; hubScriptId: string }): Promise<InstallResult>
}) {
  function baseUrl(): string {
    try {
      const url = new URL(options.getHubUrl().trim())
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
      return url.toString().replace(/\/$/, '')
    } catch {
      throw new HubClientError('hub_not_configured', '请先在设置中配置有效的 AutoforgeHub 地址')
    }
  }
  async function request(path: string, init?: RequestInit, auth = true): Promise<unknown> {
    const token = auth ? options.credentials.load() : null
    if (auth && !token) throw new HubClientError('unauthorized', '请先登录 AutoforgeHub')
    let response: ResponseLike
    try {
      response = await options.request(`${baseUrl()}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } })
    } catch {
      throw new HubClientError('network', '无法连接 AutoforgeHub')
    }
    const body = await response.json().catch(() => ({})) as { message?: unknown }
    if (!response.ok) {
      if (response.status === 401) options.credentials.clear()
      throw errorFor(response.status, typeof body.message === 'string' ? body.message : '')
    }
    return body
  }
  return {
    async session(): Promise<HubSession> {
      if (!options.credentials.load()) return { authenticated: false, persistent: options.credentials.isPersistent(), user: null }
      try {
        const user = toUser(await request('/api/auth/me'))
        if (!user) throw new HubClientError('invalid_response', 'AutoforgeHub 返回了无效会话')
        return { authenticated: true, persistent: options.credentials.isPersistent(), user }
      } catch (error) {
        if (error instanceof HubClientError && error.code === 'unauthorized') return { authenticated: false, persistent: options.credentials.isPersistent(), user: null }
        throw error
      }
    },
    async login(email: string, password: string): Promise<HubSession> {
      const body = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) }, false) as { token?: unknown; user?: unknown }
      if (typeof body.token !== 'string') throw new HubClientError('invalid_response', 'AutoforgeHub 登录响应无效')
      const user = toUser(body.user)
      if (!user) throw new HubClientError('invalid_response', 'AutoforgeHub 登录响应无效')
      options.credentials.save(body.token)
      return { authenticated: true, persistent: options.credentials.isPersistent(), user }
    },
    logout(): void { options.credentials.clear() },
    async listTeams(): Promise<HubTeam[]> { return await request('/api/teams') as HubTeam[] },
    async listPlugins(query: HubPluginQuery): Promise<HubPluginListResult> {
      const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), scope: query.scope === 'team' ? 'personal' : query.scope })
      if (query.teamId) params.set('teamId', query.teamId)
      if (query.q) params.set('q', query.q)
      if (query.category) params.set('category', query.category)
      if (query.language) params.set('language', query.language)
      if (query.sort) params.set('sort', query.sort)
      return await request(`/api/scripts?${params}`) as HubPluginListResult
    },
    async getPlugin(id: string): Promise<HubPlugin> { return await request(`/api/scripts/${encodeURIComponent(id)}`) as HubPlugin },
    async installPlugin(id: string): Promise<InstallResult> {
      const body = await request(`/api/scripts/${encodeURIComponent(id)}/install-token`, { method: 'POST' }) as Record<string, unknown>
      if (typeof body.zipUrl !== 'string' || typeof body.scriptName !== 'string' || typeof body.hubScriptId !== 'string') throw new HubClientError('invalid_response', 'AutoforgeHub 安装响应无效')
      try { return await options.install({ zipUrl: body.zipUrl, scriptName: body.scriptName, hubScriptId: body.hubScriptId }) }
      catch (error) { throw new HubClientError('install_failed', error instanceof Error ? error.message : '插件安装失败') }
    }
  }
}
