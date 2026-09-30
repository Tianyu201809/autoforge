import type { RepoFetchMethod, RepoProvider, RepoRef, RepoTransport } from '../../shared/repo-types'

export class RepoUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepoUrlError'
  }
}

const PROVIDER_HOSTS: Record<string, RepoProvider> = {
  'github.com': 'github',
  'www.github.com': 'github',
  'gitee.com': 'gitee',
  'www.gitee.com': 'gitee'
}

/** 支持归档 zip 下载的托管方；Gitee 的公开归档端点已失效，只能走 git */
const ARCHIVE_PROVIDERS: ReadonlySet<RepoProvider> = new Set<RepoProvider>(['github'])

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/
const HAS_PROTOCOL = /^[a-z][a-z0-9+.-]*:\/\//i
const SCP_FORM = /^([^@\s]+)@([^:\s]+):(.+)$/

function normalizeSegment(raw: string, label: string): string {
  const value = raw.replace(/\.git$/i, '').trim()
  if (!value || !SEGMENT_PATTERN.test(value)) {
    throw new RepoUrlError(`${label} 含非法字符: ${raw}`)
  }
  return value
}

function assertRef(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (value.includes('..') || /[\s\\]/.test(value) || value.startsWith('/')) {
    throw new RepoUrlError(`分支名含非法字符: ${raw}`)
  }
  return value
}

interface ParsedAddress {
  host: string
  pathname: string
  transport: RepoTransport
}

function parseAddress(raw: string): ParsedAddress {
  if (!HAS_PROTOCOL.test(raw)) {
    const scp = raw.match(SCP_FORM)
    if (scp) {
      return { host: scp[2].toLowerCase(), pathname: scp[3], transport: 'ssh' }
    }
  }

  const withProtocol = HAS_PROTOCOL.test(raw) ? raw : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new RepoUrlError('仓库地址格式不正确')
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol === 'http:' || protocol === 'https:') {
    return { host: parsed.hostname.toLowerCase(), pathname: parsed.pathname, transport: 'https' }
  }
  if (protocol === 'ssh:') {
    return { host: parsed.hostname.toLowerCase(), pathname: parsed.pathname, transport: 'ssh' }
  }
  throw new RepoUrlError('仅支持 http/https/ssh 形式的仓库地址')
}

/**
 * 解析 GitHub / Gitee 仓库地址。
 *
 * 支持形式：
 * - `https://github.com/owner/repo`
 * - `https://github.com/owner/repo.git`
 * - `https://github.com/owner/repo/tree/<ref>`
 * - `git@github.com:owner/repo.git`（SSH）
 * - `ssh://git@github.com/owner/repo.git`（SSH）
 * - `gitee.com/owner/repo`
 */
export function parseRepoUrl(rawInput: string): RepoRef {
  const raw = rawInput?.trim()
  if (!raw) throw new RepoUrlError('请输入仓库地址')

  const { host, pathname, transport } = parseAddress(raw)
  const provider = PROVIDER_HOSTS[host]
  if (!provider) {
    throw new RepoUrlError('目前仅支持 github.com 与 gitee.com 的仓库地址')
  }

  const segments = pathname.split('/').map((s) => s.trim()).filter(Boolean)
  if (segments.length < 2) {
    throw new RepoUrlError('地址缺少 owner/repo，例如 https://github.com/owner/repo')
  }

  const owner = normalizeSegment(segments[0], 'owner')
  const repo = normalizeSegment(segments[1], 'repo')

  let ref = ''
  const marker = segments[2]?.toLowerCase()
  if (marker === 'tree' || marker === 'commits' || marker === 'releases' || marker === 'tag') {
    const tail = segments.slice(3).join('/')
    if (tail) ref = assertRef(decodeURIComponent(tail))
  }

  return {
    provider,
    owner,
    repo,
    ref: ref || undefined,
    url: `https://${host}/${owner}/${repo}`,
    transport,
    cloneUrl:
      transport === 'ssh'
        ? `git@${host}:${owner}/${repo}.git`
        : `https://${host}/${owner}/${repo}.git`
  }
}

/** 判断该仓库能否通过归档 zip 拉取 */
export function supportsArchiveFetch(provider: RepoProvider): boolean {
  return ARCHIVE_PROVIDERS.has(provider)
}

/**
 * 选择拉取手段。
 *
 * - SSH 地址：只能走 git（需要用户本机已配置 SSH 密钥）
 * - Gitee：公开归档端点已失效，统一走 git
 * - GitHub：优先归档 zip（更快，且不依赖本机 git）
 */
export function selectFetchStrategy(ref: RepoRef): RepoFetchMethod {
  if (ref.transport === 'ssh') return 'git'
  if (!supportsArchiveFetch(ref.provider)) return 'git'
  return 'archive'
}

/** 组装归档下载请求；GitHub 有 token 时走 API 通道以支持私有仓库 */
export function buildArchiveRequest(
  ref: RepoRef,
  token?: string
): { url: string; headers: Record<string, string> } {
  if (!supportsArchiveFetch(ref.provider)) {
    throw new RepoUrlError(`${ref.provider} 仓库不支持归档下载，请改用 git 方式拉取`)
  }

  const tokenValue = token?.trim()
  const target = ref.ref?.trim()

  if (tokenValue) {
    const suffix = target ? `/${encodeURIComponent(target)}` : ''
    return {
      url: `https://api.github.com/repos/${ref.owner}/${ref.repo}/zipball${suffix}`,
      headers: {
        Authorization: `Bearer ${tokenValue}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Autoforge'
      }
    }
  }

  return {
    url: `https://github.com/${ref.owner}/${ref.repo}/archive/${target ? encodeURIComponent(target) : 'HEAD'}.zip`,
    headers: { 'User-Agent': 'Autoforge' }
  }
}

/** 从归档顶层目录名推断实际下载到的分支 / 标签，例如 `repo-main` → `main` */
export function resolveRefFromArchiveDir(directoryName: string, repo: string): string {
  const prefix = `${repo}-`
  if (directoryName.startsWith(prefix)) {
    const tail = directoryName.slice(prefix.length)
    if (tail) return tail
  }
  return directoryName
}
