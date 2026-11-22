import type { LlmProfileInput, ModelCredentials } from './provider-contract'
import type { LlmProviderPreset } from '../../../shared/ai-types'
import { IPC } from '../../../shared/ipc-channels'

export interface ModelProfileIpcService {
  listProfiles(): unknown
  upsertProfile(input: { profile: LlmProfileInput }): unknown
  deleteProfile(id: string): unknown
  setActiveProfile(id: string): unknown
  setCredentials(id: string, credentials: ModelCredentials): unknown
  clearCredentials(id: string): unknown
  testProfile(id: string): Promise<unknown>
}

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

function nonEmptyId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('模型配置 ID 无效')
  return value.trim()
}

export function registerModelProfileIpcHandlers(
  register: (channel: string, handler: IpcHandler) => void,
  service: ModelProfileIpcService,
  presets: LlmProviderPreset[]
): void {
  register(IPC.AI_PROFILES_LIST, () => service.listProfiles())
  register(IPC.AI_PRESETS_LIST, () => presets)
  register(IPC.AI_PROFILES_UPSERT, (_event, input) => {
    if (
      !input || typeof input !== 'object' || Array.isArray(input) ||
      !('profile' in input) || !input.profile || typeof input.profile !== 'object' || Array.isArray(input.profile)
    ) {
      throw new Error('模型配置输入无效')
    }
    return service.upsertProfile({ profile: input.profile as LlmProfileInput })
  })
  register(IPC.AI_PROFILES_DELETE, (_event, id) => service.deleteProfile(nonEmptyId(id)))
  register(IPC.AI_PROFILES_SET_ACTIVE, (_event, id) => service.setActiveProfile(nonEmptyId(id)))
  register(IPC.AI_PROFILES_SET_CREDENTIALS, (_event, id, credentials) => {
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
      throw new Error('模型凭据输入无效')
    }
    return service.setCredentials(nonEmptyId(id), credentials as ModelCredentials)
  })
  register(IPC.AI_PROFILES_CLEAR_CREDENTIALS, (_event, id) => service.clearCredentials(nonEmptyId(id)))
  register(IPC.AI_PROFILES_TEST, (_event, id) => service.testProfile(nonEmptyId(id)))
}
