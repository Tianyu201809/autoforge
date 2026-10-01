import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { chmodSync, statSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import type { LogLine } from '../../shared/types/script'
import {
  clearTrackedDescendants,
  collectDescendantPids,
  listParentPidMap,
  trackedDescendantPids,
  waitUntilDescendantsExit
} from './process-tree'

export interface ExecutableRunInput {
  entryPath: string
  cwd: string
  env: NodeJS.ProcessEnv
  /** 仅供运行器单元测试复用当前 Node 可执行文件。生产调用保持 undefined。 */
  argsForTest?: string[]
}

export interface ExecutableRunCallbacks {
  log: (level: LogLine['level'], message: string) => void
  onPid: (pid: number) => void
  onChild: (child: ChildProcess | undefined) => void
  isAborted: () => boolean
}

export interface ExecutableRunOutcome {
  ok: boolean
  exitCode?: number
  signal?: NodeJS.Signals
  errorMessage?: string
  aborted?: boolean
}

export function createExecutableSpawnOptions(input: ExecutableRunInput): SpawnOptions {
  return {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    windowsHide: false,
    detached: process.platform !== 'win32'
  }
}

function attachLineStream(
  stream: NodeJS.ReadableStream | null,
  level: LogLine['level'],
  log: ExecutableRunCallbacks['log']
): () => void {
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  const emitLines = (): void => {
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line) log(level, line)
  }
  stream?.on('data', (chunk: Buffer) => {
    buffer += decoder.write(chunk)
    emitLines()
  })
  return () => {
    buffer += decoder.end()
    emitLines()
    if (buffer) log(level, buffer)
    buffer = ''
  }
}

function killWindowsPid(pid: number): void {
  spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore'
  })
}

export function killExecutableProcess(child: ChildProcess | null | undefined): void {
  if (!child?.pid) return
  const rootPid = child.pid
  if (process.platform === 'win32') {
    killWindowsPid(rootPid)
    for (const pid of trackedDescendantPids(rootPid)) killWindowsPid(pid)
    // 启动器已经退出时，/T 杀不到被过继的程序，要按父 PID 再找一轮。
    void listParentPidMap()
      .then((parents) => {
        if (!parents) return
        for (const pid of collectDescendantPids(rootPid, parents)) killWindowsPid(pid)
      })
      .catch(() => undefined)
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      // Process group already exited.
    }
  }, 2_000)
  timer.unref()
}

export async function runExecutableScript(
  input: ExecutableRunInput,
  callbacks: ExecutableRunCallbacks
): Promise<ExecutableRunOutcome> {
  if (process.platform !== 'win32' && !input.argsForTest) {
    const mode = statSync(input.entryPath).mode
    chmodSync(input.entryPath, mode | 0o100)
  }

  const child = spawn(
    input.entryPath,
    input.argsForTest ?? [],
    createExecutableSpawnOptions(input)
  )
  callbacks.onChild(child)
  if (child.pid) callbacks.onPid(child.pid)

  return new Promise((resolve) => {
    let settled = false
    let announcedHandoff = false
    let treePromise: ReturnType<typeof waitUntilDescendantsExit> | undefined
    const flushStdout = attachLineStream(child.stdout, 'INFO', callbacks.log)
    const flushStderr = attachLineStream(child.stderr, 'ERROR', callbacks.log)
    const finish = (outcome: ExecutableRunOutcome): void => {
      if (settled) return
      settled = true
      if (child.pid) clearTrackedDescendants(child.pid)
      flushStdout()
      flushStderr()
      callbacks.onChild(undefined)
      resolve(outcome)
    }

    const watchTree = (): ReturnType<typeof waitUntilDescendantsExit> => {
      if (!child.pid) return Promise.resolve({ hadDescendants: false })
      treePromise ??= waitUntilDescendantsExit(child.pid, {
        isAborted: () => settled || callbacks.isAborted(),
        onDescendants: (pids) => {
          if (announcedHandoff || pids.length === 0) return
          announcedHandoff = true
          callbacks.log('INFO', '启动进程已退出，继续监控它拉起的程序')
        }
      })
      return treePromise
    }

    child.on('error', (error) => {
      finish({ ok: false, errorMessage: error.message })
    })
    // 在 close 之前就开始查后代。Windows 启动器会马上退出，真正的程序还在。
    child.on('exit', () => {
      void watchTree()
    })
    child.on('close', (code, signal) => {
      void watchTree().then((tree) => {
        if (callbacks.isAborted()) {
          finish({ ok: false, aborted: true, exitCode: code ?? undefined, signal: signal ?? undefined })
          return
        }
        if (tree.hadDescendants) {
          finish({ ok: true, exitCode: 0, signal: signal ?? undefined })
          return
        }
        if (code === 0) {
          finish({ ok: true, exitCode: 0, signal: signal ?? undefined })
          return
        }
        const errorMessage = code != null
          ? `可执行程序退出码 ${code}`
          : signal
            ? `可执行程序被信号 ${signal} 终止`
            : '可执行程序异常退出'
        finish({
          ok: false,
          exitCode: code ?? undefined,
          signal: signal ?? undefined,
          errorMessage
        })
      })
    })
  })
}
