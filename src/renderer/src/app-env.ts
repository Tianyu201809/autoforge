import type { AppEnv } from '@shared/app-env'

/** 渲染进程运行环境（与 Vite mode 一致）。 */
export const appEnv: AppEnv = import.meta.env.DEV ? 'development' : 'production'
export const isDev = import.meta.env.DEV
export const isProd = import.meta.env.PROD
