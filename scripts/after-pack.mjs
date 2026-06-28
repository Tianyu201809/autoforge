import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rcedit } from 'rcedit'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {import('app-builder-lib').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  if (context.packager.platformSpecificBuildOptions.signAndEditExecutable !== false) return

  const exePath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const iconPath = join(root, 'build', 'icon.ico')

  if (!existsSync(exePath)) {
    console.warn('[after-pack] skip icon embed: exe missing at', exePath)
    return
  }
  if (!existsSync(iconPath)) {
    console.warn('[after-pack] skip icon embed: icon missing at', iconPath)
    return
  }

  const appInfo = context.packager.appInfo
  console.log('[after-pack] embedding application icon via rcedit')

  await rcedit(exePath, {
    icon: iconPath,
    'file-version': appInfo.shortVersion || appInfo.buildVersion,
    'product-version': appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm(),
    'version-string': {
      FileDescription: appInfo.description || appInfo.productName,
      ProductName: appInfo.productName
    }
  })
}
