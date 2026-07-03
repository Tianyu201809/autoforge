/**
 * 应用运行环境（与 electron-builder 是否打包无关）。
 *
 * - development：`npm run dev`（electron-vite dev / Vite dev server）
 * - production：`npm run build`、`npm run preview`、`npm run dist` 及安装包
 *
 * 解析优先级：AUTOFORGE_APP_ENV → NODE_ENV → ELECTRON_RENDERER_URL（dev server）→ production
 */
export type AppEnv = 'development' | 'production'

export function resolveAppEnv(): AppEnv {
  const explicit = process.env.AUTOFORGE_APP_ENV?.trim()
  if (explicit === 'development' || explicit === 'production') {
    return explicit
  }

  const nodeEnv = process.env.NODE_ENV?.trim()
  if (nodeEnv === 'development') return 'development'
  if (nodeEnv === 'production') return 'production'

  if (process.env.ELECTRON_RENDERER_URL) return 'development'

  return 'production'
}

export const appEnv: AppEnv = resolveAppEnv()
export const isDev = appEnv === 'development'
export const isProd = appEnv === 'production'
