import { spawn, type ChildProcess } from 'child_process'

/** 全项目统一 UTF-8 编码常量 */
export const UTF8 = 'utf-8' as const

/** 启动时强制 UTF-8 环境（Windows 控制台与子进程） */
export function bootstrapUtf8(): void {
  process.env.LANG = 'en_US.UTF-8'
  process.env.LC_ALL = 'en_US.UTF-8'
  process.env.LC_CTYPE = 'UTF-8'
  process.env.PYTHONIOENCODING = 'utf-8'
  process.env.PYTHONUTF8 = '1'

  if (process.platform !== 'win32') return

  try {
    process.stdout.setDefaultEncoding('utf8')
    process.stderr.setDefaultEncoding('utf8')
  } catch {
    /* 非 TTY 时忽略 */
  }
}

/** 子进程环境变量：继承当前进程并确保 UTF-8 */
export function utf8ChildEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  bootstrapUtf8()
  return {
    ...process.env,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    LC_CTYPE: 'UTF-8',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    ...extra
  }
}

/** 将子进程输出 Buffer 解码为 UTF-8 字符串 */
export function decodeUtf8(chunk: Buffer): string {
  return chunk.toString(UTF8)
}

/**
 * Windows 下通过 cmd 执行命令并强制代码页 65001 (UTF-8)。
 * 用于 npm 等可能在 GBK 控制台下输出乱码的子进程。
 */
export function spawnUtf8Command(
  command: string,
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): ChildProcess {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'cmd.exe'
    return spawn(comspec, ['/d', '/s', '/c', `chcp 65001 >nul && ${command}`], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: utf8ChildEnv(options.env)
    })
  }

  return spawn('sh', ['-c', command], {
    cwd: options.cwd,
    shell: false,
    env: utf8ChildEnv(options.env)
  })
}
