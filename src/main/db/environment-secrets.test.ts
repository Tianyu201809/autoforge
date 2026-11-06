import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openVariables, sealVariables, type EnvCipher } from './environment-secrets'

function cipher(): EnvCipher {
  return {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(value, 'utf8'),
    decrypt: (value) => value.toString('utf8')
  }
}

test('seals variables and migrates plaintext json', () => {
  const sealed = sealVariables({ TOKEN: 'secret' }, cipher())
  assert.equal(sealed.startsWith('enc:v1:'), true)
  assert.deepEqual(openVariables(sealed, cipher()), {
    variables: { TOKEN: 'secret' },
    readable: true,
    needsMigration: false
  })
  assert.deepEqual(openVariables('{"TOKEN":"secret"}', cipher()), {
    variables: { TOKEN: 'secret' },
    readable: true,
    needsMigration: true
  })
})

test('keeps plaintext when encryption is unavailable and refuses a broken ciphertext', () => {
  const off: EnvCipher = { isAvailable: () => false, encrypt: () => Buffer.from(''), decrypt: () => { throw new Error('bad') } }
  assert.equal(sealVariables({ A: '1' }, off), '{"A":"1"}')
  const broken = cipher()
  broken.decrypt = () => { throw new Error('bad') }
  assert.deepEqual(openVariables('enc:v1:aaaa', broken), {
    variables: {},
    readable: false,
    needsMigration: false
  })
})
