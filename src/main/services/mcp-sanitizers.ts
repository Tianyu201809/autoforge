import type { EnvVarDefinition, ParamDefinition } from '../../shared/script-contract'
import type { EnvironmentProfile, LogLine, RunSession, ScriptItem, ScriptMeta } from '../../shared/types/script'
import type { SanitizedEnvironment } from '../../shared/mcp-types'

function secretKeys(definitions: Array<EnvVarDefinition | ParamDefinition>): Set<string> {
  return new Set(definitions.filter((definition) => definition.secret).map((definition) => definition.key))
}

export function sanitizeValues(
  values: Record<string, string>,
  definitions: Array<EnvVarDefinition | ParamDefinition>
): Record<string, string | { present: boolean }> {
  const secrets = secretKeys(definitions)
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      secrets.has(key) ? { present: value !== undefined && value !== '' } : value
    ])
  )
}

export function sanitizeEnvironment(
  environment: EnvironmentProfile,
  script?: ScriptMeta
): SanitizedEnvironment {
  const variables = script
    ? sanitizeValues(environment.variables, script.envSchema)
    : Object.fromEntries(
        Object.entries(environment.variables).map(([key, value]) => [key, { present: value !== undefined && value !== '' }])
      )

  return {
    id: environment.id,
    name: environment.name,
    description: environment.description,
    variables,
    variableKeys: Object.keys(environment.variables).sort((a, b) => a.localeCompare(b)),
    isDefault: environment.isDefault
  }
}

export function sanitizeScriptItem(script: ScriptItem): ScriptItem {
  const envSecrets = secretKeys(script.envSchema)
  const paramSecrets = secretKeys(script.paramSchema)
  const sanitizeMap = (values: Record<string, Record<string, string>> | undefined, secrets: Set<string>) => {
    if (!values) return undefined
    return Object.fromEntries(
      Object.entries(values).map(([envId, entries]) => [
        envId,
        Object.fromEntries(Object.entries(entries).filter(([key]) => !secrets.has(key)))
      ])
    )
  }
  return {
    ...JSON.parse(JSON.stringify(script)),
    configByEnv: sanitizeMap(script.configByEnv, envSecrets),
    paramsByEnv: sanitizeMap(script.paramsByEnv, paramSecrets),
    savedParams: script.savedParams
      ? Object.fromEntries(Object.entries(script.savedParams).filter(([key]) => !paramSecrets.has(key)))
      : undefined
  }
}

export function sanitizeLogLine(line: LogLine): LogLine {
  return { ...line, message: sanitizeErrorMessage(line.message) }
}

export function sanitizeSession(session: RunSession): RunSession {
  const result = session.result
  return {
    ...JSON.parse(JSON.stringify(session)),
    result: result === undefined ? undefined : sanitizeUnknown(result)
  }
}

function sanitizeUnknown(value: unknown, key?: string): unknown {
  if (key && /token|password|secret|api[_-]?key/i.test(key)) return '[redacted]'
  if (typeof value === 'string') return sanitizeErrorMessage(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeUnknown(item, name)]))
}

export function sanitizeErrorMessage(message: string): string {
  return message.replace(/(token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
}
