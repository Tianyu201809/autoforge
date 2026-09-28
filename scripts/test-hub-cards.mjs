import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const preview = process.argv.includes('--preview')
const screenshots = process.env.HUB_CARD_SCREENSHOTS || join(tmpdir(), 'autoforge-hub-card-check')
const fixtureModule = '/__hub-card-fixture.js'
const fixtureId = '\0hub-card-fixture'

// Mount the real panel with an in-memory IPC bridge, without touching accounts or installing files.
const fixture = `
import { createApp } from 'vue'
import HubPanel from '/src/renderer/src/components/HubPluginCenterPanel.vue'
import '/src/renderer/src/assets/main.css'

const entries = [
  ['图片边缘裁切-1.0.0', '使用 Sharp 裁切 PNG、JPG、JPEG 和 WebP 图片的透明或白色边缘，并保留 Alpha 通道。', '实用工具', 'image', 'JavaScript', 0],
  ['文件比对-v1.0.2', '上传两个文件，在本地 Web 工作台生成差异标注图。支持原文标注、对比结果和报告导出。', '实用工具', 'file-archive', 'JavaScript', 4],
  ['换装数据验证-1.1.0', '基于 Three.js 的浏览器可视化工具，用于检查户型、墙体、洞口、家具与贴图等换装 JSON 数据。', '其他', 'package', '', 1],
  ['TAPD-迭代任务导出-1.0.4', '根据检索条件导出每个迭代的任务标题。', '自动化', 'workflow', 'JavaScript', 1],
  ['简历筛选', 'AI 简历筛选（千问 LLM 版本）', '数据处理', 'file-spreadsheet', 'Python', 3],
  ['API 请求调试', '批量验证接口响应，汇总状态码和请求耗时。', '开发工具', 'terminal', 'TypeScript', 28]
]
const items = entries.map(([title, description, category, icon, language, installCount], index) => ({
  id: String(index), title, description, category, icon, language, installCount,
  tags: [], ownerDisplayName: '张天宇', ownerId: 'fixture', ownerAvatarUrl: '',
  createdAt: '2026-08-' + String(11 - index).padStart(2, '0') + 'T08:00:00Z',
  updatedAt: '2026-08-11T08:00:00Z', visibility: 'private', readme: description
}))
let onProgress = () => {}
const pending = new Map()
const fixtureState = {
  items, calls: [],
  progress(value) { onProgress(value) },
  finish(id, fail = false) {
    const task = pending.get(id)
    if (!task) throw new Error('No pending installation for ' + id)
    pending.delete(id)
    if (fail) task.reject(new Error('测试安装失败，请重试'))
    else task.resolve({ status: 'installed', name: items.find(item => item.id === id).title })
  }
}
window.__hubFixture = fixtureState
window.autoforge = { hub: {
  session: async () => ({ authenticated: true, persistent: true, user: { id: 'fixture', displayName: '张天宇', email: 'fixture@example.test', teamCount: 1 } }),
  listTeams: async () => [{ id: 'team', name: '测试团队' }],
  listPlugins: async query => {
    fixtureState.calls.push(query)
    return {
      items: items.filter(item => (!query.category || item.category === query.category) && (!query.q || item.title.includes(query.q))),
      distributions: { category: Object.fromEntries([...new Set(items.map(item => item.category))].map(category => [category, items.filter(item => item.category === category).length])) }
    }
  },
  installPlugin: id => {
    fixtureState.calls.push({ install: id })
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  },
  onInstallProgress: fn => { onProgress = fn; return () => {} },
  onHubAuthorized: () => () => {},
  beginAuthorization: async () => {}, cancelAuthorization: async () => {}, logout: async () => {}
}}
const theme = new URLSearchParams(location.search).get('theme') || 'ivory'
document.documentElement.dataset.theme = theme === 'obsidian' ? 'dark' : 'light'
document.documentElement.dataset.skin = theme
createApp(HubPanel, { open: true }).mount('#app')
`

const server = await createServer({
  configFile: false,
  root,
  resolve: { alias: { '@build': join(root, 'build') } },
  plugins: [vue(), tailwindcss(), {
    name: 'hub-card-fixture',
    resolveId(id) { if (id === fixtureModule) return fixtureId },
    load(id) { if (id === fixtureId) return fixture },
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/__hub-card-preview') return next()
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Autoforge 脚本卡片预览</title></head><body><div id="app"></div><script type="module" src="' + fixtureModule + '"></script></body></html>')
      })
    }
  }],
  server: { host: '127.0.0.1', port: preview ? 5181 : 0 }
})

await server.listen()
const address = server.httpServer.address()
const url = `http://127.0.0.1:${address.port}/__hub-card-preview`

if (preview) {
  console.log(`Mock-data preview: ${url}`)
} else {
  let browser
  try {
    await mkdir(screenshots, { recursive: true })
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    const cards = page.locator('.hub-card')
    await cards.first().waitFor()
    assert.equal(await cards.count(), 6)
    assert.equal(await page.locator('.hub-plugin-icon svg').count(), 6)
    assert.equal(await page.locator('.hub-plugin-icon').first().innerText(), '')
    const accents = await cards.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).getPropertyValue('--hub-card-accent')))
    assert.ok(new Set(accents).size >= 4, 'Categories should have distinct accents')
    await page.getByRole('button', { name: '我的脚本', exact: true }).click()
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(screenshots, 'desktop-light.png'), fullPage: true })

    await cards.first().focus()
    await page.keyboard.press('Enter')
    await page.getByRole('complementary', { name: '脚本详情' }).waitFor()
    assert.equal(await cards.first().getAttribute('class'), 'hub-card selected')
    await page.getByRole('button', { name: '关闭详情' }).click()
    const installButton = cards.first().getByRole('button')
    const buttonBefore = await installButton.boundingBox()
    await installButton.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.hub-card.installing'))
    assert.equal(await page.locator('.hub-detail').count(), 0, 'Install keyboard events must not open details')
    assert.equal(await installButton.isDisabled(), true)
    const buttonDuring = await installButton.boundingBox()
    assert.equal(buttonBefore.width, buttonDuring.width)
    assert.equal(buttonBefore.height, buttonDuring.height)
    await page.evaluate(() => window.__hubFixture.progress({ hubScriptId: '0', phase: 'downloading', message: '正在下载', percent: 42, downloadedBytes: 42000, totalBytes: 100000 }))
    assert.ok((await cards.first().innerText()).includes('42%'))
    await page.screenshot({ path: join(screenshots, 'installation-progress.png'), fullPage: true })
    await page.evaluate(() => window.__hubFixture.finish('0', true))
    await cards.first().getByRole('button', { name: /重试安装/ }).waitFor()
    assert.ok((await cards.first().innerText()).includes('测试安装失败'))
    await cards.first().getByRole('button', { name: /重试安装/ }).click()
    await page.evaluate(() => window.__hubFixture.finish('0'))
    await page.waitForFunction(() => !document.querySelector('.hub-card.installing'))
    assert.equal(await cards.first().locator('.hub-install-progress').count(), 0)
    for (let index = 0; index < 5; index++) await cards.nth(index).getByRole('button').click()
    assert.equal(await cards.nth(5).getByRole('button').isDisabled(), true, 'Concurrent install limit remains five')
    for (let index = 0; index < 5; index++) await page.evaluate(id => window.__hubFixture.finish(id), String(index))
    await page.waitForFunction(() => !document.querySelector('.hub-card.installing'))

    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
      document.documentElement.dataset.skin = 'obsidian'
    })
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(screenshots, 'desktop-dark.png'), fullPage: true })
    await page.locator('select[aria-label="按分类筛选"]').selectOption('数据处理')
    await page.waitForFunction(() => document.querySelectorAll('.hub-card').length === 1)
    await page.locator('select[aria-label="按分类筛选"]').selectOption('')
    await page.waitForFunction(() => document.querySelectorAll('.hub-card').length === 6)
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
      document.documentElement.dataset.skin = 'ivory'
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(screenshots, 'mobile-light.png'), fullPage: true })

    await page.evaluate(() => {
      const item = window.__hubFixture.items[0]
      item.title = 'VeryLongUnbrokenScriptName'.repeat(12)
      item.description = '很长的脚本说明用于测试窄窗口内容边界。'.repeat(20)
      item.ownerDisplayName = '很长的上传者名称'.repeat(12)
      item.language = 'ExtremelyLongRuntimeName'.repeat(8)
      item.category = '很长的分类名称'.repeat(8)
      item.icon = 'unknown-icon'
      item.iconColor = '#c45475'
    })
    await page.getByRole('button', { name: '刷新脚本列表' }).click()
    await page.waitForFunction(() => document.querySelector('.hub-card h2')?.textContent?.startsWith('VeryLong'))
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      const overflow = await page.locator('.hub-content').evaluate(node => node.scrollWidth > node.clientWidth)
      assert.equal(overflow, false, `No catalog overflow at ${width}px`)
      const collisions = await cards.evaluateAll(nodes => nodes.flatMap(node => {
        const title = node.querySelector('h2').getBoundingClientRect()
        const desc = node.querySelector('.hub-card__body p').getBoundingClientRect()
        const credits = node.querySelector('.hub-card__credits').getBoundingClientRect()
        const footer = node.querySelector('.hub-card__footer').getBoundingClientRect()
        return title.bottom > desc.top || desc.bottom > credits.top || credits.bottom > footer.top + 1 ? [node.innerText] : []
      }))
      assert.deepEqual(collisions, [], `No overlapping content at ${width}px`)
      await page.screenshot({ path: join(screenshots, `edge-case-${width}.png`), fullPage: true })
    }
    assert.deepEqual(errors, [], 'No browser runtime errors')
    console.log(`PASS: icons, category colors, keyboard detail/install, progress, retry, success, five-install limit, filters, dark theme, 1024/390/320px layouts. Screenshots: ${screenshots}`)
  } finally {
    await browser?.close()
    await server.close()
  }
}
