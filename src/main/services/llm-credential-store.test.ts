import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLlmCredentialStore } from './llm-credential-store'

/** 可逆的假加密，仅用于验证存储结构而不依赖 Electron safeStorage */
const fakeEncryption = {
  isAvailable: () => true,
  encrypt: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
  decrypt: (value: Buffer) => value.toString('utf8').replace(/^enc:/, '')
}

const unavailableEncryption = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('should not be called')
  },
  decrypt: () => {
    throw new Error('should not be called')
  }
}

function withTempFile<T>(run: (filePath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'autoforge-llm-cred-'))
  try {
    return run(join(dir, 'llm-credentials.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('按配置 id 独立保存与读取密钥', () => {
  withTempFile((filePath) => {
    const store = createLlmCredentialStore({ filePath, encryption: fakeEncryption })
    store.save('profile-a', 'key-a')
    store.save('profile-b', 'key-b')

    assert.equal(store.load('profile-a'), 'key-a')
    assert.equal(store.load('profile-b'), 'key-b')
    assert.equal(store.has('profile-a'), true)
    assert.equal(store.has('profile-c'), false)
  })
})

test('清除单个配置的密钥不影响其他配置', () => {
  withTempFile((filePath) => {
    const store = createLlmCredentialStore({ filePath, encryption: fakeEncryption })
    store.save('profile-a', 'key-a')
    store.save('profile-b', 'key-b')

    store.clear('profile-a')
    assert.equal(store.load('profile-a'), null)
    assert.equal(store.load('profile-b'), 'key-b')
    assert.equal(store.isPersistent(), true)
  })
})

test('清空全部密钥后删除凭据文件', () => {
  withTempFile((filePath) => {
    const store = createLlmCredentialStore({ filePath, encryption: fakeEncryption })
    store.save('profile-a', 'key-a')
    assert.equal(existsSync(filePath), true)

    store.clear('profile-a')
    assert.equal(existsSync(filePath), false)
  })
})

test('落盘内容不包含明文密钥', () => {
  withTempFile((filePath) => {
    const store = createLlmCredentialStore({ filePath, encryption: fakeEncryption })
    store.save('profile-a', 'super-secret-key')

    const raw = readFileSync(filePath, 'utf8')
    assert.ok(!raw.includes('super-secret-key'))
    assert.equal(store.load('profile-a'), 'super-secret-key')
  })
})

test('加密不可用时退化为内存存储', () => {
  withTempFile((filePath) => {
    const store = createLlmCredentialStore({ filePath, encryption: unavailableEncryption })
    store.save('profile-a', 'key-a')

    assert.equal(store.load('profile-a'), 'key-a')
    assert.equal(store.isPersistent(), false)
    assert.equal(existsSync(filePath), false)

    // 新实例无法读到内存中的密钥，符合「重启后需重填」的预期
    const fresh = createLlmCredentialStore({ filePath, encryption: unavailableEncryption })
    assert.equal(fresh.load('profile-a'), null)
  })
})

test('空 profileId 不写入也不读取', () => {
  withTempFile((filePath) => {
    const store = createLlmCredentialStore({ filePath, encryption: fakeEncryption })
    store.save('', 'key')
    assert.equal(store.load(''), null)
    assert.equal(store.has(''), false)
  })
})
