import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

test('renders Markdown and keeps hostile output inert in a real browser DOM', async () => {
  const bundled = await build({ entryPoints: ['src/renderer/src/lib/ai-markdown.ts'], bundle: true, write: false, format: 'iife', globalName: 'aiMarkdown' })
  const local = 'C:/personal/autoforge/resources/browsers/chromium-1228/chrome-win64/chrome.exe'
  const browser = await chromium.launch({ headless: true, ...(existsSync(local) ? { executablePath: local } : {}) })
  try {
    const page = await browser.newPage()
    await page.addScriptTag({ content: bundled.outputFiles[0].text })
    const result = await page.evaluate(() => {
      const render = (globalThis as unknown as { aiMarkdown: { renderAiMarkdown(s: string): string } }).aiMarkdown.renderAiMarkdown
      const container = document.createElement('div')
      document.body.append(container)
      container.innerHTML = render('# Result\n\n- one\n- two\n\n```js\nconst x = 1\n```\n\n| a | b |\n|---|---|\n|1|2|\n\n<img src="https://evil.test/x" onerror="alert(1)">\n\n[click](javascript:alert(1))\n\n![image](https://evil.test/x)\n\n[relative](/evil)\n\n[valid](https://example.test)')
      return { heading: container.querySelector('h1')?.textContent, items: container.querySelectorAll('li').length, code: container.querySelector('pre code')?.className, table: !!container.querySelector('table'), active: !!container.querySelector('img,script,[onerror]'), links: Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href')) }
    })
    assert.equal(result.heading, 'Result')
    assert.equal(result.items, 2)
    assert.equal(result.code, 'language-js')
    assert.equal(result.table, true)
    assert.equal(result.active, false)
    assert.deepEqual(result.links, ['https://example.test'])
  } finally { await browser.close() }
})
