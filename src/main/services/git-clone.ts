import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { utf8ChildEnv } from '../../shared/encoding'
import type { RepoProvider } from '../../shared/repo-types'

export class GitCloneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitCloneError'
  }
}

export interface GitProgress {
  message: string
  percent?: number
}

export interface GitCloneInput {
  cloneUrl: string
  ref?: string
  destDir: string
  provider: RepoProvider
  /** 仅 GitHub 支持通过 http.extraHeader 注入 Bearer 令牌 */
  token?: string
  onProgress?: (progress: GitProgress) => void
  timeoutMs?: number
}

export interface GitCloneResult {
  commitSha: string | null
  branch: string | null
}

export const DEFAULT_CLONE_TIMEOUT_MS = 10 * 60 * 1000
const GIT_PROBE_TIMEOUT_MS = 5_000
const GIT_QUERY_TIMEOUT_MS = 10_000

const STAGE_LABELS: Record<string, string> = {
  'Enumerating objects': '枚举对象',
  'Counting objects': '统计对象',
  'Compressing objects': '压缩对象',
  'Receiving objects': '接收对象',
  'Resolving deltas': '解析差异',
  'Updating files': '检出文件',
  'Checking out files': '检出文件'
}

const STAGE_PATTERN = /^([A-Za-z ]+):\s+(\d{1,3})%/

function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      /* ignore */
    }
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    /* ignore */
  }
}

function gitEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return utf8ChildEnv({
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
    ...extra
  })
}

let gitVersionCache: string | null | undefined

/** 检测本机 git 可用性；结果在进程内缓存 */
export function detectGitVersion(): Promise<string | null> {
  if (gitVersionCache !== undefined) return Promise.resolve(gitVersionCache)

  return new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      gitVersionCache = value
      resolve(value)
    }

    let child: ChildProcess
    try {
      child = spawn('git', ['--version'], { windowsHide: true, env: gitEnv() })
    } catch {
      finish(null)
      return
    }

    let output = ''
    const timer = setTimeout(() => {
      killTree(child)
      finish(null)
    }, GIT_PROBE_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf-8')
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code === 0 && output.trim() ? output.trim() : null)
    })
  })
}

function runGitCapture(args: string[], cwd: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    let child: ChildProcess
    try {
      child = spawn('git', args, { cwd, windowsHide: true, env: gitEnv() })
    } catch {
      finish(null)
      return
    }

    let output = ''
    const timer = setTimeout(() => {
      killTree(child)
      finish(null)
    }, GIT_QUERY_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf-8')
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code === 0 ? output.trim() : null)
    })
  })
}

function createLineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = ''
  return (chunk) => {
    buffer += chunk.toString('utf-8')
    const parts = buffer.split(/\r\n|\r|\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (line) onLine(line)
    }
  }
}

function parseProgressLine(rawLine: string): GitProgress | null {
  const line = rawLine.replace(/^remote:\s*/, '')
  const match = line.match(STAGE_PATTERN)
  if (!match) return null
  const percent = Number(match[2])
  if (!Number.isFinite(percent)) return null
  const stage = match[1].trim()
  return { message: STAGE_LABELS[stage] ?? stage, percent }
}

interface FailureContext {
  provider: RepoProvider
  cloneUrl: string
  ref?: string
}

/** 把 git 的 stderr 翻译成可操作的中文提示 */
export function describeGitFailure(stderr: string, context: FailureContext): string {
  const text = stderr.toLowerCase()

  if (text.includes('permission denied (publickey)') || text.includes('could not read from remote repository')) {
    return 'SSH 认证失败：请确认本机已生成 SSH 密钥，并把公钥添加到该托管平台的账号设置中'
  }
  if (text.includes('host key verification failed')) {
    return 'SSH 主机密钥校验失败：请先在终端手动执行一次 git clone 以确认主机指纹'
  }
  if (text.includes('authentication failed') || text.includes('invalid username or password') || text.includes('403')) {
    return '认证失败：仓库可能是私有的，请使用 SSH 地址或配置本机 git 凭据管理器'
  }
  if (text.includes('could not resolve host') || text.includes('failed to connect') || text.includes('timed out')) {
    return '网络不可达：无法连接仓库服务器，请检查网络或代理设置'
  }
  if (text.includes('remote branch') && text.includes('not found')) {
    return `分支不存在：该仓库没有「${context.ref ?? ''}」分支或标签`
  }
  if (text.includes('repository not found') || text.includes('not found') || text.includes('does not exist')) {
    return '仓库不存在：请检查 owner/repo 是否正确，或该仓库是否为私有'
  }
  if (text.includes('unsupported protocol')) {
    return '不支持的地址协议：请使用 https 或 ssh 形式的仓库地址'
  }
  if (text.includes('dubious ownership')) {
    return 'git 安全检查失败：目标目录归属异常，请删除该转换工作区后重试'
  }

  const firstLine = stderr.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  return firstLine ? `克隆失败：${firstLine}` : '克隆失败：git 未返回具体原因'
}

/**
 * 浅克隆仓库到目标目录，并回读 commit 与分支。
 *
 * 使用 `shell: false` + 参数数组，避免地址与分支名被 shell 解释；
 * `GIT_TERMINAL_PROMPT=0` 与 SSH `BatchMode` 确保缺少凭据时快速失败而不是挂起。
 */
export async function cloneRepository(input: GitCloneInput): Promise<GitCloneResult> {
  const { cloneUrl, ref, destDir, provider, token, onProgress } = input
  const timeoutMs = input.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS

  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true })

  const args = ['clone', '--depth', '1', '--single-branch', '--no-tags', '--progress']
  if (ref?.trim()) args.push('--branch', ref.trim())
  args.push('--', cloneUrl, destDir)

  const extraEnv: NodeJS.ProcessEnv = {}
  if (token?.trim() && provider === 'github') {
    extraEnv.GIT_CONFIG_COUNT = '1'
    extraEnv.GIT_CONFIG_KEY_0 = 'http.extraHeader'
    extraEnv.GIT_CONFIG_VALUE_0 = `Authorization: Bearer ${token.trim()}`
  }

  const stderrChunks: string[] = []
  let lastPercent = -1

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let timedOut = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }

    let child: ChildProcess
    try {
      child = spawn('git', args, { windowsHide: true, env: gitEnv(extraEnv) })
    } catch (error) {
      reject(new GitCloneError(error instanceof Error ? error.message : String(error)))
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)

    const handleLine = (line: string): void => {
      stderrChunks.push(line)
      if (stderrChunks.length > 400) stderrChunks.shift()
      const progress = parseProgressLine(line)
      if (!progress) return
      if (progress.percent === lastPercent) return
      lastPercent = progress.percent ?? -1
      onProgress?.({ message: progress.message, percent: progress.percent })
    }

    const splitter = createLineSplitter(handleLine)
    child.stderr?.on('data', splitter)
    child.stdout?.on('data', splitter)

    child.on('error', (error) => {
      const message =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? '未找到 git 命令：请先安装 git 并确保它在 PATH 中'
          : error.message
      finish(new GitCloneError(message))
    })

    child.on('close', (code) => {
      if (timedOut) {
        finish(new GitCloneError('克隆超时：仓库过大或网络过慢，请稍后重试'))
        return
      }
      if (code === 0) {
        finish()
        return
      }
      finish(new GitCloneError(describeGitFailure(stderrChunks.join('\n'), { provider, cloneUrl, ref })))
    })
  })

  const commitSha = await runGitCapture(['rev-parse', 'HEAD'], destDir)
  const rawBranch = await runGitCapture(['rev-parse', '--abbrev-ref', 'HEAD'], destDir)
  const branch = rawBranch && rawBranch !== 'HEAD' ? rawBranch : (ref?.trim() ?? null)

  return { commitSha, branch }
}
