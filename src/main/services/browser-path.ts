import { app } from 'electron'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Browser } from 'playwright-core'
import { chromium, firefox } from 'playwright-core'
import type { AppConfig } from '../../shared/types/script'

const BROWSERS_DIR = 'browsers'

export type BrowserEngine = 'chromium' | 'firefox'
export type BrowserId = 'custom' | 'bundled' | 'chrome' | 'edge' | 'firefox'

export interface BrowserLaunchPlan {
  engine: BrowserEngine
  id: BrowserId
  label: string
  headless: boolean
  executablePath?: string
  channel?: 'chrome' | 'msedge' | 'firefox'
}

export interface DetectedBrowser {
  id: BrowserId
  label: string
  path: string
}

/** 内置 Chromium 目录：开发时在项目 resources/，打包后在 extraResources */
export function getPlaywrightBrowsersPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, BROWSERS_DIR)
  }
  return join(process.cwd(), 'resources', BROWSERS_DIR)
}

export function applyPlaywrightBrowsersPath(): void {
  process.env.PLAYWRIGHT_BROWSERS_PATH = getPlaywrightBrowsersPath()
}

function getSystemBrowserPaths(): Record<'chrome' | 'edge' | 'firefox', string[]> {
  if (process.platform === 'win32') {
    const programFiles = process.env['PROGRAMFILES'] ?? 'C:\\Program Files'
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
    const localAppData = process.env['LOCALAPPDATA'] ?? ''

    return {
      chrome: [
        join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
      ],
      edge: [
        join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      ],
      firefox: [
        join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
        join(programFilesX86, 'Mozilla Firefox', 'firefox.exe')
      ]
    }
  }

  if (process.platform === 'darwin') {
    return {
      chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      firefox: ['/Applications/Firefox.app/Contents/MacOS/firefox']
    }
  }

  return {
    chrome: [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ],
    edge: ['/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge'],
    firefox: ['/usr/bin/firefox', '/snap/bin/firefox']
  }
}

function findSystemBrowserExecutable(kind: 'chrome' | 'edge' | 'firefox'): string | null {
  for (const candidate of getSystemBrowserPaths()[kind]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

function findBundledChromiumExecutable(): string | null {
  const base = getPlaywrightBrowsersPath()
  if (!existsSync(base)) return null

  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('chromium-')) continue
    const root = join(base, entry.name)
    const candidates =
      process.platform === 'win32'
        ? [join(root, 'chrome-win64', 'chrome.exe'), join(root, 'chrome-win', 'chrome.exe')]
        : process.platform === 'darwin'
          ? [join(root, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')]
          : [join(root, 'chrome-linux', 'chrome')]

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }

  return null
}

function inferEngineFromPath(path: string): BrowserEngine {
  return /firefox/i.test(path) ? 'firefox' : 'chromium'
}

/** 检测本机已安装的浏览器（不含自定义路径） */
export function detectInstalledBrowsers(): DetectedBrowser[] {
  const found: DetectedBrowser[] = []

  const bundled = findBundledChromiumExecutable()
  if (bundled) {
    found.push({ id: 'bundled', label: '内置 Chromium', path: bundled })
  }

  const chrome = findSystemBrowserExecutable('chrome')
  if (chrome) {
    found.push({ id: 'chrome', label: 'Google Chrome', path: chrome })
  }

  const edge = findSystemBrowserExecutable('edge')
  if (edge) {
    found.push({ id: 'edge', label: 'Microsoft Edge', path: edge })
  }

  const firefoxPath = findSystemBrowserExecutable('firefox')
  if (firefoxPath) {
    found.push({ id: 'firefox', label: 'Mozilla Firefox', path: firefoxPath })
  }

  return found
}

/** 按优先级返回可尝试的浏览器启动方案 */
export function resolveBrowserLaunchPlans(
  config: AppConfig,
  options?: { headless?: boolean }
): BrowserLaunchPlan[] {
  applyPlaywrightBrowsersPath()

  const headless = options?.headless ?? false
  const customPath = config.browser?.executablePath?.trim()

  if (customPath) {
    if (!existsSync(customPath)) return []
    const engine = inferEngineFromPath(customPath)
    return [
      {
        engine,
        id: 'custom',
        label: `自定义浏览器`,
        headless,
        ...(engine === 'firefox'
          ? { channel: 'firefox' as const }
          : { executablePath: customPath })
      }
    ]
  }

  const plans: BrowserLaunchPlan[] = []

  const bundled = findBundledChromiumExecutable()
  if (bundled) {
    plans.push({
      engine: 'chromium',
      id: 'bundled',
      label: '内置 Chromium',
      headless,
      executablePath: bundled
    })
  }

  const chrome = findSystemBrowserExecutable('chrome')
  if (chrome) {
    plans.push({
      engine: 'chromium',
      id: 'chrome',
      label: 'Google Chrome',
      headless,
      executablePath: chrome
    })
  }

  const edge = findSystemBrowserExecutable('edge')
  if (edge) {
    plans.push({
      engine: 'chromium',
      id: 'edge',
      label: 'Microsoft Edge',
      headless,
      executablePath: edge
    })
  }

  if (findSystemBrowserExecutable('firefox')) {
    plans.push({
      engine: 'firefox',
      id: 'firefox',
      label: 'Mozilla Firefox',
      headless,
      channel: 'firefox'
    })
  }

  return plans
}

export interface ChromiumLaunchOptions {
  headless: boolean
  executablePath?: string
  channel?: 'chrome' | 'msedge'
}

/** @deprecated 请使用 resolveBrowserLaunchPlans */
export function resolveChromiumLaunchOptions(
  config: AppConfig,
  options?: { headless?: boolean }
): ChromiumLaunchOptions {
  const plans = resolveBrowserLaunchPlans(config, options).filter((plan) => plan.engine === 'chromium')
  const first = plans[0]
  if (!first) {
    return { headless: options?.headless ?? false, channel: 'chrome' }
  }
  return {
    headless: first.headless,
    executablePath: first.executablePath,
    channel: first.channel as 'chrome' | 'msedge' | undefined
  }
}

async function launchBrowserPlan(plan: BrowserLaunchPlan): Promise<Browser> {
  const options = {
    headless: plan.headless,
    ...(plan.executablePath ? { executablePath: plan.executablePath } : {}),
    ...(plan.channel ? { channel: plan.channel } : {})
  }

  if (plan.engine === 'firefox') {
    return firefox.launch(options)
  }
  return chromium.launch(options)
}

export interface LaunchBrowserResult {
  browser: Browser
  plan: BrowserLaunchPlan
}

/** 依次尝试可用浏览器，直到有一个成功启动 */
export async function launchBrowserWithFallback(
  config: AppConfig,
  log: (level: 'INFO' | 'WARN' | 'ERROR', message: string) => void,
  options?: { headless?: boolean }
): Promise<LaunchBrowserResult> {
  const plans = resolveBrowserLaunchPlans(config, options)

  if (plans.length === 0) {
    const customPath = config.browser?.executablePath?.trim()
    if (customPath) {
      throw new Error(`指定的浏览器路径不存在：${customPath}`)
    }
    throw new Error(
      '未找到可用浏览器。请安装 Google Chrome、Microsoft Edge 或 Mozilla Firefox，或运行 npm run install:browsers 安装内置 Chromium。'
    )
  }

  const detected = detectInstalledBrowsers()
  if (detected.length > 0) {
    log('INFO', `检测到本机浏览器：${detected.map((b) => b.label).join('、')}`)
  }

  let lastError: unknown = null
  for (const plan of plans) {
    log('INFO', `尝试启动 ${plan.label}（headless: ${plan.headless}）…`)
    try {
      const browser = await launchBrowserPlan(plan)
      log('INFO', `已启动 ${plan.label}`)
      return { browser, plan }
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      log('WARN', `${plan.label} 启动失败：${message}`)
    }
  }

  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(
    `所有可用浏览器均启动失败（已尝试 ${plans.map((p) => p.label).join('、')}）。\n最后错误：${lastMessage}\n可运行 npm run install:browsers 安装内置 Chromium，或在设置中指定浏览器路径。`
  )
}

export function getBrowserStatus(): {
  bundled: boolean
  path: string
  executable: string | null
  installed: DetectedBrowser[]
} {
  applyPlaywrightBrowsersPath()
  const path = getPlaywrightBrowsersPath()
  const executable = findBundledChromiumExecutable()
  return {
    bundled: Boolean(executable),
    path,
    executable,
    installed: detectInstalledBrowsers()
  }
}

export function assertBundledBrowserAvailable(): void {
  const { bundled, path, installed } = getBrowserStatus()
  if (bundled || installed.some((b) => b.id !== 'bundled')) return

  throw new Error(
    `未找到可用浏览器。请安装 Chrome、Edge 或 Firefox，或在开发环境运行：npm run install:browsers\n（内置 Chromium 期望路径：${path}）`
  )
}
