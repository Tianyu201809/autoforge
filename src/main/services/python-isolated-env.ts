import { utf8ChildEnv } from '../../shared/encoding'

const UTF8_ENV_KEYS = ['LANG', 'LC_ALL', 'LC_CTYPE', 'PYTHONIOENCODING', 'PYTHONUTF8'] as const

const PASSTHROUGH_KEYS = [
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'PUBLIC',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER'
]

/** 构建 Python 子进程环境：保留系统运行必需变量 + UTF-8 编码 + Autoforge 注入项 */
export function buildIsolatedPythonEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = utf8ChildEnv()
  const env: NodeJS.ProcessEnv = {}

  for (const key of UTF8_ENV_KEYS) {
    const value = base[key]
    if (value) env[key] = value
  }

  for (const key of PASSTHROUGH_KEYS) {
    const value = base[key]
    if (value) env[key] = value
  }

  return { ...env, ...extra }
}
