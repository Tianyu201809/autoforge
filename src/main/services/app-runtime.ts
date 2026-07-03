import { app } from 'electron'
import { join } from 'node:path'

/** 是否从 electron-builder 安装包运行（与 dev/prod 模式独立）。 */
export function isPackagedApp(): boolean {
  return app.isPackaged
}

/** 未打包时使用项目根；打包后使用 extraResources 目录。 */
export function getBundledResourceRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath()
}

export function getBundledIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build/icon.ico')
}
