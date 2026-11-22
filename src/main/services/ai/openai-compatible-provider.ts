import { createOpenAiProvider, normalizeOpenAiEndpoint, type ProviderRequestDeps } from './openai-provider'

export { OPENAI_COMPATIBLE_PRESETS } from './provider-presets'
export { normalizeOpenAiEndpoint }

export function createOpenAiCompatibleProvider(deps: ProviderRequestDeps) {
  return createOpenAiProvider(deps)
}
