import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const storeModule = import('./model-credential-store').catch(() => null)

function cipher(available = true) {
  return {
    isAvailable: () => available,
    encrypt: (value: string) => Buffer.from(`sealed:${value}`, 'utf8'),
    decrypt: (value: Buffer) => {
      const text = value.toString('utf8')
      if (!text.startsWith('sealed:')) throw new Error('invalid ciphertext')
      return text.slice('sealed:'.length)
    }
  }
}

async function createStore(filePath: string, encryption = cipher()) {
  const module = await storeModule
  assert.ok(module, 'model credential store module should be available')
  return module.createModelCredentialStore({ filePath, encryption })
}

function tempFile(): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'autoforge-ai-credentials-'))
  return { dir, filePath: join(dir, 'credentials.json') }
}

test('isolates credentials by profile', async () => {
  const temp = tempFile()
  try {
    const store = await createStore(temp.filePath)
    store.set('profile-a', { apiKey: 'key-a', extraHeaders: { 'X-Tenant': 'tenant-a' } })
    store.set('profile-b', { apiKey: 'key-b', extraHeaders: { 'X-Tenant': 'tenant-b' } })

    assert.deepEqual(store.get('profile-a'), { apiKey: 'key-a', extraHeaders: { 'X-Tenant': 'tenant-a' } })
    assert.deepEqual(store.get('profile-b'), { apiKey: 'key-b', extraHeaders: { 'X-Tenant': 'tenant-b' } })
  } finally {
    rmSync(temp.dir, { recursive: true, force: true })
  }
})

test('stores key and custom headers as ciphertext', async () => {
  const temp = tempFile()
  try {
    const store = await createStore(temp.filePath)
    store.set('profile-a', {
      apiKey: 'sentinel-api-key',
      extraHeaders: { Authorization: 'sentinel-header-value' }
    })

    const stored = readFileSync(temp.filePath, 'utf8')
    assert.equal(stored.includes('sentinel-api-key'), false)
    assert.equal(stored.includes('sentinel-header-value'), false)
    assert.equal(stored.includes('sealed:'), false)
  } finally {
    rmSync(temp.dir, { recursive: true, force: true })
  }
})

test('deletes one profile credentials without changing other profiles', async () => {
  const temp = tempFile()
  try {
    const store = await createStore(temp.filePath)
    store.set('profile-a', { apiKey: 'key-a', extraHeaders: {} })
    store.set('profile-b', { apiKey: 'key-b', extraHeaders: {} })
    store.delete('profile-a')

    assert.equal(store.get('profile-a'), null)
    assert.deepEqual(store.get('profile-b'), { apiKey: 'key-b', extraHeaders: {} })
  } finally {
    rmSync(temp.dir, { recursive: true, force: true })
  }
})

test('ignores a corrupt profile ciphertext', async () => {
  const temp = tempFile()
  try {
    writeFileSync(temp.filePath, JSON.stringify({ version: 1, entries: { 'profile-a': 'broken' } }))
    const store = await createStore(temp.filePath)

    assert.equal(store.get('profile-a'), null)
  } finally {
    rmSync(temp.dir, { recursive: true, force: true })
  }
})

test('uses memory when safeStorage is unavailable', async () => {
  const temp = tempFile()
  try {
    const store = await createStore(temp.filePath, cipher(false))
    store.set('profile-a', { apiKey: 'memory-only', extraHeaders: {} })

    assert.equal(store.isPersistent(), false)
    assert.deepEqual(store.get('profile-a'), { apiKey: 'memory-only', extraHeaders: {} })
    assert.equal(existsSync(temp.filePath), false)
  } finally {
    rmSync(temp.dir, { recursive: true, force: true })
  }
})

test('rejects malformed profile ids', async () => {
  const temp = tempFile()
  try {
    const store = await createStore(temp.filePath)

    assert.throws(
      () => store.set('../profile', { apiKey: 'key', extraHeaders: {} }),
      /配置 ID/
    )
    assert.equal(store.get('../profile'), null)
  } finally {
    rmSync(temp.dir, { recursive: true, force: true })
  }
})
