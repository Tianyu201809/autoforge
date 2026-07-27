export interface BrowserDisconnectEmitter {
  once(event: 'disconnected', listener: () => void): unknown
}

export function attachBrowserDisconnectHandler(
  browser: BrowserDisconnectEmitter,
  onDisconnected: () => void,
  schedule: (callback: () => void) => void = setImmediate
): void {
  browser.once('disconnected', () => schedule(onDisconnected))
}
