import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const targetDir = join(root, 'node_modules', 'sql.js')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = (pkg.dependencies?.['sql.js'] ?? '1.13.0').replace(/^[\^~]/, '')

/** 确保 sql.js 已安装（避免 npm prune 卡住时缺依赖） */
function main() {
  if (isSqlJsReady()) {
    console.log('[install-sqljs] sql.js already present')
    return
  }

  console.log(`[install-sqljs] installing sql.js@${version}...`)
  const tgz = join(root, `sql.js-${version}.tgz`)
  const pack = spawnSync('npm', ['pack', `sql.js@${version}`, '--pack-destination', root], {
    cwd: root,
    stdio: 'inherit',
    shell: true
  })
  if (pack.status !== 0) {
    console.warn('[install-sqljs] npm pack failed')
    process.exit(0)
  }

  const packed = existsSync(tgz) ? tgz : join(root, `sql.js-${version}.tgz`)
  if (!existsSync(packed)) {
    console.warn('[install-sqljs] tarball missing after npm pack')
    process.exit(0)
  }

  const extract = spawnSync('tar', ['-xf', packed, '-C', root], { cwd: root, stdio: 'inherit', shell: true })
  if (extract.status !== 0) {
    console.warn('[install-sqljs] tar extract failed')
    process.exit(0)
  }

  const staged = join(root, 'package')
  if (!existsSync(staged)) {
    console.warn('[install-sqljs] extracted package/ folder missing')
    process.exit(0)
  }

  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(dirname(targetDir), { recursive: true })
  spawnSync(process.platform === 'win32' ? 'xcopy' : 'cp', process.platform === 'win32'
    ? ['/E', '/I', '/Y', staged, targetDir]
    : ['-R', staged, targetDir], { stdio: 'inherit', shell: true })

  rmSync(staged, { recursive: true, force: true })
  rmSync(packed, { force: true })

  if (isSqlJsReady()) {
    console.log('[install-sqljs] sql.js installed successfully')
  } else {
    console.warn('[install-sqljs] install finished but module still missing')
  }
}

function isSqlJsReady() {
  try {
    const require = createRequire(join(root, 'package.json'))
    require.resolve('sql.js/dist/sql-wasm.js')
    return true
  } catch {
    return existsSync(join(targetDir, 'dist', 'sql-wasm.js'))
  }
}

main()
