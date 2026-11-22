import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IPC } from '../../../shared/ipc-channels'
import { registerModelProfileIpcHandlers } from './model-profile-ipc'

test('rejects malformed profile payloads at the IPC boundary', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  let upsertCalls = 0
  registerModelProfileIpcHandlers((channel, handler) => handlers.set(channel, handler), {
    listProfiles: () => ({ profiles: [], activeProfileId: null, credentialPersistent: true }),
    upsertProfile: () => { upsertCalls += 1; throw new Error('should not be called') },
    deleteProfile: () => false,
    setActiveProfile: () => ({ profiles: [], activeProfileId: null, credentialPersistent: true }),
    setCredentials: () => { throw new Error('unused') },
    clearCredentials: () => { throw new Error('unused') },
    testProfile: async () => ({ ok: false, message: 'unused' })
  }, [])

  await assert.rejects(
    async () => handlers.get(IPC.AI_PROFILES_UPSERT)?.({}, { profile: null }),
    /模型配置输入无效/
  )
  assert.equal(upsertCalls, 0)
})

test('rejects malformed secret payloads before calling the credential store', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  let credentialCalls = 0
  registerModelProfileIpcHandlers((channel, handler) => handlers.set(channel, handler), {
    listProfiles: () => ({ profiles: [], activeProfileId: null, credentialPersistent: true }),
    upsertProfile: () => { throw new Error('unused') },
    deleteProfile: () => false,
    setActiveProfile: () => ({ profiles: [], activeProfileId: null, credentialPersistent: true }),
    setCredentials: () => { credentialCalls += 1; throw new Error('should not be called') },
    clearCredentials: () => { throw new Error('unused') },
    testProfile: async () => ({ ok: false, message: 'unused' })
  }, [])

  await assert.rejects(
    async () => handlers.get(IPC.AI_PROFILES_SET_CREDENTIALS)?.({}, 'profile-1', null),
    /模型凭据输入无效/
  )
  assert.equal(credentialCalls, 0)
})
