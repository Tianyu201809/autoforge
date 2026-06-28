import { app, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function projectRootFromMain(): string {
  return join(__dirname, '../..')
}

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function getAppIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icon.ico')
  }

  const root = projectRootFromMain()
  return (
    firstExisting([join(app.getAppPath(), 'build/icon.ico'), join(root, 'build/icon.ico')]) ??
    join(root, 'build/icon.ico')
  )
}

export function getTrayIconPath(): string {
  if (app.isPackaged) {
    return (
      firstExisting([
        join(process.resourcesPath, 'icon-tray.png'),
        join(process.resourcesPath, 'icon.ico')
      ]) ?? join(process.resourcesPath, 'icon.ico')
    )
  }

  const root = projectRootFromMain()
  return (
    firstExisting([
      join(app.getAppPath(), 'build/icon-tray.png'),
      join(root, 'build/icon-tray.png'),
      join(app.getAppPath(), 'build/icon.ico'),
      join(root, 'build/icon.ico')
    ]) ?? join(root, 'build/icon.ico')
  )
}

export function getAppIconImage(): Electron.NativeImage {
  return nativeImage.createFromPath(getAppIconPath())
}

export function getTrayIcon(): Electron.NativeImage {
  const iconPath = getTrayIconPath()
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    console.warn('[tray] icon missing at', iconPath)
    return icon
  }

  const { width, height } = icon.getSize()
  if (iconPath.endsWith('.png') && width <= 32 && height <= 32) {
    return icon
  }

  return icon.resize({ width: 16, height: 16 })
}
