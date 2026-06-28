import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

process.env.LANG = 'en_US.UTF-8'
process.env.LC_ALL = 'en_US.UTF-8'
process.env.LC_CTYPE = 'UTF-8'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const browsersPath = join(root, 'resources', 'browsers')

if (!existsSync(browsersPath)) {
  mkdirSync(browsersPath, { recursive: true })
}

function runInstall(envExtra = {}) {
  const cmd =
    process.platform === 'win32'
      ? 'chcp 65001 >nul && npx playwright install chromium'
      : 'npx playwright install chromium'
  execSync(cmd, {
    stdio: 'inherit',
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
      ...envExtra
    }
  })
}

console.log(`Installing Playwright Chromium to: ${browsersPath}`)

try {
  runInstall()
  console.log('Chromium installed successfully.')
} catch (error) {
  console.warn('Official CDN download failed, trying npmmirror mirror…')
  try {
    runInstall({ PLAYWRIGHT_DOWNLOAD_HOST: 'https://npmmirror.com/mirrors/playwright' })
    console.log('Chromium installed successfully via mirror.')
  } catch (mirrorError) {
    console.error('Failed to install Chromium from both official CDN and mirror.')
    console.error('You can retry manually: npm run install:browsers')
    process.exit(1)
  }
}
