async def run(ctx):
    url = ctx.env.get("PAGE_URL", "https://example.com").strip()
    if not url:
        raise ValueError("请在配置中填写 PAGE_URL")

    wait_ms = int(ctx.params.get("WAIT_MS", "2000") or "2000")
    wait_ms = max(0, wait_ms)

    ctx.stage(name="launch", label="启动浏览器")
    ctx.log("INFO", "正在启动 Playwright 浏览器…")

    browser = await ctx.sdk.browser.launch()
    page = await browser.new_page()

    try:
        ctx.stage(name="navigate", label="打开页面", message=url)
        ctx.log("INFO", f"正在打开: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=60_000)

        if wait_ms > 0:
            await page.wait_for_timeout(wait_ms)

        title = await page.title()
        ctx.progress(scope="task", current=1, total=1, label="读取标题", unit="步")
        ctx.log("INFO", f"页面标题: {title}")

        return {
            "url": page.url,
            "title": title
        }
    finally:
        await page.close()
        await browser.close()
