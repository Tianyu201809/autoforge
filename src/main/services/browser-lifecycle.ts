export interface BrowserDisconnectEmitter {
  once(event: 'disconnected', listener: () => void): unknown
  close(options?: { reason?: string }): Promise<void>
}

export type BrowserDisconnectKind = 'intentional' | 'unexpected'

export function attachBrowserDisconnectHandler(
  browser: BrowserDisconnectEmitter,
  onDisconnected: (kind: BrowserDisconnectKind) => void,
  schedule: (callback: () => void) => void = setImmediate
): void {
  let intentionalClose = false
  const originalClose = browser.close.bind(browser)
  browser.close = async (options) => {
    intentionalClose = true
    await originalClose(options)
  }
  browser.once('disconnected', () => {
    schedule(() => onDisconnected(intentionalClose ? 'intentional' : 'unexpected'))
  })
}
