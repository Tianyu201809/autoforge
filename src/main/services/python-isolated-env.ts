import { utf8ChildEnv } from '../../shared/encoding'

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

/** 构建 Python 子进程环境：保留系统运行必需变量 + Autoforge 注入项 */
export function buildIsolatedPythonEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = utf8ChildEnv()
  const env: NodeJS.ProcessEnv = {}

  for (const key of PASSTHROUGH_KEYS) {
    const value = base[key]
    if (value) env[key] = value
  }

  return { ...env, ...extra }
}
