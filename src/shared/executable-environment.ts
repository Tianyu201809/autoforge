export function normalizeExecutableParamKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

export function assertExecutableParamKeys(params: Array<{ key: string }>): void {
  const seen = new Map<string, string>()
  for (const item of params) {
    const normalized = normalizeExecutableParamKey(item.key)
    const previous = seen.get(normalized)
    if (previous !== undefined) {
      throw new Error(`参数环境变量冲突: ${previous} 与 ${item.key}`)
    }
    seen.set(normalized, item.key)
  }
}

export interface ExecutableEnvironmentInput {
  baseEnv: NodeJS.ProcessEnv
  env: Record<string, string>
  params: Record<string, string>
  sessionId: string
  scriptId: string
  scriptDir: string
}

export function buildExecutableEnvironment(input: ExecutableEnvironmentInput): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = { ...input.baseEnv, ...input.env }
  const seen = new Map<string, string>()
  for (const [key, value] of Object.entries(input.params)) {
    const normalized = normalizeExecutableParamKey(key)
    const previous = seen.get(normalized)
    if (previous !== undefined) {
      throw new Error(`参数环境变量冲突: ${previous} 与 ${key}`)
    }
    seen.set(normalized, key)
    output[`AUTOFORGE_PARAM_${normalized}`] = value
  }
  output.AUTOFORGE_PARAMS_JSON = JSON.stringify(input.params)
  output.AUTOFORGE_SESSION_ID = input.sessionId
  output.AUTOFORGE_SCRIPT_ID = input.scriptId
  output.AUTOFORGE_SCRIPT_DIR = input.scriptDir
  return output
}
