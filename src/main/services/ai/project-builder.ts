import { spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { utf8ChildEnv } from '../../../shared/encoding'
import type { ProjectCheckResult } from './project-checks'

export function createProjectBuilder(options: { timeoutMs?: number } = {}) {
  return async (projectPath: string, signal?: AbortSignal): Promise<ProjectCheckResult> => {
    const result = (status: ProjectCheckResult['status'], code: string, message: string, diagnostics: string[] = []): ProjectCheckResult => ({ status, code, message, diagnostics })
    if (signal?.aborted) return result('blocked', 'build_cancelled', '构建已取消')
    const packagePath = join(projectPath, 'package.json')
    try {
      if (!existsSync(packagePath)) return result('passed', 'build_not_required', '无需构建（未配置 build 脚本）')
      const stat = lstatSync(packagePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('package.json 必须是有效的普通文件')
      const config: unknown = JSON.parse(readFileSync(packagePath, 'utf8'))
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('package.json 必须是 JSON 对象')
      const scripts = (config as Record<string, unknown>).scripts
      if (scripts !== undefined && (!scripts || typeof scripts !== 'object' || Array.isArray(scripts))) throw new Error('scripts 必须是对象')
      const build = (scripts as Record<string, unknown> | undefined)?.build
      if (build === undefined) return result('passed', 'build_not_required', '无需构建（未配置 build 脚本）')
      if (typeof build !== 'string' || !build.trim()) throw new Error('scripts.build 必须是非空字符串')
    } catch (error) {
      return result('failed', 'build_config_invalid', '构建配置无效', [error instanceof Error ? error.message : String(error)])
    }
    return new Promise<ProjectCheckResult>((resolve) => {
      const windows = process.platform === 'win32'
      const child = spawn(windows ? process.env.ComSpec || 'cmd.exe' : 'sh',
        windows ? ['/d', '/s', '/c', 'chcp 65001 >nul && npm run build'] : ['-c', 'npm run build'], {
          cwd: projectPath, windowsHide: true, detached: !windows,
          env: utf8ChildEnv({ NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: undefined })
        })
      let output = ''
      let stopCode: 'build_cancelled' | 'build_timeout' | undefined
      let killing: Promise<void> | undefined
      let finished = false
      const capture = (chunk: Buffer): void => { output = (output + chunk.toString('utf8')).slice(-64 * 1024) }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      const stop = (code: typeof stopCode): void => {
        if (finished || stopCode) return
        stopCode = code
        killing = new Promise<void>((done) => {
          if (!child.pid) { done(); return }
          if (windows) {
            const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
            killer.once('error', () => { child.kill(); done() })
            killer.once('close', () => done())
          } else {
            try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
            done()
          }
        })
      }
      const abort = (): void => stop('build_cancelled')
      const timer = setTimeout(() => stop('build_timeout'), options.timeoutMs ?? 120_000)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      const finish = async (exitCode: number | null, error?: Error): Promise<void> => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        await killing
        if (stopCode) resolve(result('blocked', stopCode, stopCode === 'build_cancelled' ? '构建已取消' : '构建超时', output ? [output] : []))
        else if (error || exitCode !== 0) resolve(result('failed', 'build_failed', '项目构建失败', [error?.message || output || `构建退出码：${exitCode}`]))
        else resolve(result('passed', 'build_passed', '项目构建通过'))
      }
      child.once('error', error => { void finish(null, error) })
      child.once('close', code => { void finish(code) })
    })
  }
}
