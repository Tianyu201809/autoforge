import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { RepoConvertProgress, RepoFetchMethod, RepoRef } from '../../shared/repo-types'
import { extractZipSecurely, MAX_ZIP_BYTES, resolveZipPackageRoot } from './safe-zip-package'
import {
  buildArchiveRequest,
  resolveRefFromArchiveDir,
  selectFetchStrategy,
  supportsArchiveFetch
} from './repo-url'
import { cloneRepository, detectGitVersion, GitCloneError } from './git-clone'

export type RepoFetchProgressReporter = (progress: Omit<RepoConvertProgress, 'taskId'>) => void

export interface RepoFetcherDeps {
  /** 注入的 HTTP 客户端；主进程使用 electron 的 net.fetch 以获得系统代理支持 */
  request: (url: string, init?: RequestInit) => Promise<Response>
}

export interface FetchRepoInput {
  ref: RepoRef
  /** 仓库落地的目标目录（工作区内的 repo/） */
  repoDir: string
  token?: string
  onProgress?: RepoFetchProgressReporter
  /** 归档下载停滞超时，默认 60 秒 */
  stallTimeoutMs?: number
  /** git 克隆总超时，默认 10 分钟 */
  cloneTimeoutMs?: number
}

export interface FetchRepoResult {
  repoDir: string
  resolvedRef: string
  commitSha: string | null
  fetchMethod: RepoFetchMethod
  downloadedBytes: number
}

export const DEFAULT_STALL_TIMEOUT_MS = 60_000
const PROGRESS_STEP_BYTES = 512 * 1024

export class RepoFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepoFetchError'
  }
}

function describeHttpStatus(status: number): string {
  if (status === 401 || status === 403) {
    return `访问被拒绝（HTTP ${status}）：仓库可能是私有的，请提供访问令牌或改用 SSH 地址`
  }
  if (status === 404) {
    return '仓库或分支不存在（HTTP 404）：请检查 owner/repo 与分支名是否正确'
  }
  if (status === 429) {
    return '触发托管方限流（HTTP 429）：请稍后重试，或改用 SSH 地址通过 git 拉取'
  }
  return `下载失败（HTTP ${status}）`
}

function gitMissingMessage(ref: RepoRef): string {
  if (ref.transport === 'ssh') {
    return '本机未检测到 git：SSH 地址需要通过 git 拉取，请先安装 git 并确保它在 PATH 中'
  }
  return '本机未检测到 git：Gitee 已不再提供公开归档下载，请先安装 git（https://git-scm.com）后重试'
}

export function createRepoFetcher(deps: RepoFetcherDeps): {
  fetchRepo: (input: FetchRepoInput) => Promise<FetchRepoResult>
} {
  /** 解析默认分支，失败时返回 null 由调用方回退 */
  async function resolveDefaultBranch(ref: RepoRef, token?: string): Promise<string | null> {
    const url =
      ref.provider === 'github'
        ? `https://api.github.com/repos/${ref.owner}/${ref.repo}`
        : `https://gitee.com/api/v5/repos/${ref.owner}/${ref.repo}`
    const headers: Record<string, string> = {
      'User-Agent': 'Autoforge',
      Accept: 'application/json'
    }
    if (token?.trim() && ref.provider === 'github') {
      headers.Authorization = `Bearer ${token.trim()}`
    }

    try {
      const response = await deps.request(url, { headers })
      if (!response.ok) return null
      const payload = (await response.json()) as { default_branch?: unknown }
      const branch = payload?.default_branch
      return typeof branch === 'string' && branch.trim() ? branch.trim() : null
    } catch {
      return null
    }
  }

  async function downloadArchive(
    url: string,
    headers: Record<string, string>,
    destPath: string,
    onProgress: RepoFetchProgressReporter | undefined,
    stallTimeoutMs: number
  ): Promise<number> {
    const controller = new AbortController()
    let timer = setTimeout(() => controller.abort(), stallTimeoutMs)
    const refresh = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), stallTimeoutMs)
    }

    try {
      let response: Response
      try {
        response = await deps.request(url, { headers, signal: controller.signal })
        refresh()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new RepoFetchError(`下载失败：${message}。请检查网络连接或代理设置`)
      }

      if (!response.ok) throw new RepoFetchError(describeHttpStatus(response.status))

      const contentLength = Number(response.headers.get('content-length') ?? '0')
      if (Number.isFinite(contentLength) && contentLength > MAX_ZIP_BYTES) {
        throw new RepoFetchError('仓库压缩包超过 500 MB，暂不支持转换')
      }
      if (!response.body) throw new RepoFetchError('下载失败：响应内容为空')

      let downloadedBytes = 0
      let lastReportedBytes = 0
      let lastPercent = -1
      const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined

      const report = (): void => {
        const percent = totalBytes ? Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100)) : undefined
        if (
          downloadedBytes !== 0 &&
          percent === lastPercent &&
          downloadedBytes - lastReportedBytes < PROGRESS_STEP_BYTES
        ) {
          return
        }
        lastReportedBytes = downloadedBytes
        lastPercent = percent ?? -1
        onProgress?.({
          phase: 'downloading',
          message: '正在下载仓库压缩包',
          percent,
          downloadedBytes,
          totalBytes
        })
      }

      report()
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          refresh()
          downloadedBytes += chunk.length
          if (downloadedBytes > MAX_ZIP_BYTES) {
            callback(new RepoFetchError('仓库压缩包超过 500 MB，暂不支持转换'))
            return
          }
          report()
          callback(null, chunk)
        }
      })

      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        counter,
        createWriteStream(destPath, { flags: 'wx' }),
        { signal: controller.signal }
      )

      if (downloadedBytes === 0) throw new RepoFetchError('下载失败：压缩包为空')
      return downloadedBytes
    } catch (error) {
      if (error instanceof RepoFetchError) throw error
      if (controller.signal.aborted) {
        throw new RepoFetchError('下载超时：长时间没有收到数据，请检查网络或代理')
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new RepoFetchError(`下载失败：${message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  async function archiveFetch(input: FetchRepoInput): Promise<FetchRepoResult> {
    const { ref, repoDir, token, onProgress } = input
    const stallTimeoutMs = input.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS

    // 未指定分支时先解析默认分支，便于拿到准确的分支名而不是 commit 目录名
    let effectiveRef = ref
    if (!ref.ref?.trim()) {
      const defaultBranch = await resolveDefaultBranch(ref, token)
      if (defaultBranch) effectiveRef = { ...ref, ref: defaultBranch }
    }

    const tempDir = join(repoDir, '..', `.tmp-${randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })

    try {
      const { url, headers } = buildArchiveRequest(effectiveRef, token)
      onProgress?.({ phase: 'downloading', message: '正在连接仓库', percent: 0 })

      const zipPath = join(tempDir, 'archive.zip')
      const downloadedBytes = await downloadArchive(url, headers, zipPath, onProgress, stallTimeoutMs)

      onProgress?.({ phase: 'extracting', message: '正在解压仓库' })
      const extractDir = join(tempDir, 'extracted')
      extractZipSecurely(zipPath, extractDir)
      onProgress?.({ phase: 'extracting', message: '解压完成', percent: 100 })

      const archiveRoot = resolveZipPackageRoot(extractDir)
      if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true })
      renameSync(archiveRoot, repoDir)

      const inferred = resolveRefFromArchiveDir(basename(archiveRoot), ref.repo)
      const resolvedRef = ref.ref?.trim() || (inferred === basename(archiveRoot) ? '默认分支' : inferred)

      return { repoDir, resolvedRef, commitSha: null, fetchMethod: 'archive', downloadedBytes }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }

  async function gitFetch(input: FetchRepoInput): Promise<FetchRepoResult> {
    const { ref, repoDir, token, onProgress } = input
    onProgress?.({
      phase: 'cloning',
      message: `正在克隆 ${ref.owner}/${ref.repo}`,
      percent: 0
    })

    try {
      const { commitSha, branch } = await cloneRepository({
        cloneUrl: ref.cloneUrl,
        ref: ref.ref,
        destDir: repoDir,
        provider: ref.provider,
        token,
        timeoutMs: input.cloneTimeoutMs,
        onProgress: (progress) => {
          onProgress?.({ phase: 'cloning', message: progress.message, percent: progress.percent })
        }
      })

      return {
        repoDir,
        resolvedRef: branch ?? ref.ref ?? '默认分支',
        commitSha,
        fetchMethod: 'git',
        downloadedBytes: 0
      }
    } catch (error) {
      if (error instanceof GitCloneError) throw new RepoFetchError(error.message)
      throw error
    }
  }

  async function fetchRepo(input: FetchRepoInput): Promise<FetchRepoResult> {
    const { ref } = input
    const strategy = selectFetchStrategy(ref)
    const gitVersion = await detectGitVersion()

    if (strategy === 'git') {
      if (!gitVersion) throw new RepoFetchError(gitMissingMessage(ref))
      return gitFetch(input)
    }

    if (!supportsArchiveFetch(ref.provider)) {
      if (!gitVersion) throw new RepoFetchError(gitMissingMessage(ref))
      return gitFetch(input)
    }

    try {
      return await archiveFetch(input)
    } catch (error) {
      if (!gitVersion) throw error
      input.onProgress?.({
        phase: 'cloning',
        message: '归档下载不可用，改用 git 克隆'
      })
      return gitFetch(input)
    }
  }

  return { fetchRepo }
}
