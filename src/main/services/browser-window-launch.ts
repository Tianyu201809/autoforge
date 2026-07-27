export function getBrowserWindowLaunchArgs(
  engine: 'chromium' | 'firefox',
  headless: boolean
): string[] {
  return engine === 'chromium' && !headless ? ['--start-maximized'] : []
}
