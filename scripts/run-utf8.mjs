/**
 * 在 UTF-8 代码页下执行子命令（Windows 强制 chcp 65001）。
 * 用法: node scripts/run-utf8.mjs <command> [args...]
 */
import { spawn } from 'node:child_process'

const [, , cmd, ...args] = process.argv
if (!cmd) {
  console.error('Usage: node scripts/run-utf8.mjs <command> [args...]')
  process.exit(1)
}

process.env.LANG = 'en_US.UTF-8'
process.env.LC_ALL = 'en_US.UTF-8'
process.env.LC_CTYPE = 'UTF-8'

const fullCommand = [cmd, ...args].join(' ')
const isWin = process.platform === 'win32'

const child = isWin
  ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `chcp 65001 >nul && ${fullCommand}`], {
      stdio: 'inherit',
      shell: false,
      env: process.env
    })
  : spawn(cmd, args, { stdio: 'inherit', shell: false, env: process.env })

child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (err) => {
  console.error(err)
  process.exit(1)
})
