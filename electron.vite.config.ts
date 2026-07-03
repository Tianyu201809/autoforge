import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import type { AppEnv } from './src/shared/app-env'

function resolveBuildAppEnv(mode: string): AppEnv {
  return mode === 'development' ? 'development' : 'production'
}

export default defineConfig(({ mode }) => {
  const appEnv = resolveBuildAppEnv(mode)
  const envDefine = {
    'process.env.AUTOFORGE_APP_ENV': JSON.stringify(appEnv)
  }

  return {
    main: {
      define: envDefine,
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      }
    },
    preload: {
      define: envDefine,
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      }
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared'),
          '@build': resolve('build')
        }
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/renderer/index.html'),
            terminal: resolve('src/renderer/terminal.html'),
            editor: resolve('src/renderer/editor.html'),
            'floating-ball': resolve('src/renderer/floating-ball.html')
          }
        }
      },
      plugins: [vue(), tailwindcss()]
    }
  }
})
