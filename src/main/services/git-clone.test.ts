import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeGitFailure } from './git-clone'

const CONTEXT = {
  provider: 'gitee' as const,
  cloneUrl: 'https://gitee.com/oschina/git-osc.git',
  ref: undefined
}

test('SSH 公钥认证失败给出密钥配置提示', () => {
  const message = describeGitFailure(
    'git@gitee.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
    { ...CONTEXT, cloneUrl: 'git@gitee.com:oschina/git-osc.git' }
  )
  assert.match(message, /SSH 认证失败/)
  assert.match(message, /公钥/)
})

test('主机密钥校验失败给出指纹确认提示', () => {
  const message = describeGitFailure('Host key verification failed.', CONTEXT)
  assert.match(message, /主机密钥/)
})

test('认证失败提示改用 SSH 或凭据管理器', () => {
  const message = describeGitFailure('remote: Authentication failed for user', CONTEXT)
  assert.match(message, /认证失败/)
  assert.match(message, /SSH/)
})

test('网络不可达给出网络与代理提示', () => {
  const message = describeGitFailure('fatal: unable to access ... could not resolve host: gitee.com', CONTEXT)
  assert.match(message, /网络不可达/)
})

test('分支不存在时带出分支名', () => {
  const message = describeGitFailure(
    "fatal: Remote branch release/v9 not found in upstream origin",
    { ...CONTEXT, ref: 'release/v9' }
  )
  assert.match(message, /release\/v9/)
})

test('仓库不存在给出检查 owner/repo 的提示', () => {
  const message = describeGitFailure(
    'remote: Repository not found.\nfatal: repository not found',
    CONTEXT
  )
  assert.match(message, /仓库不存在/)
})

test('未识别的失败回退到 stderr 首行', () => {
  const message = describeGitFailure('\nfatal: something odd happened', CONTEXT)
  assert.equal(message, '克隆失败：fatal: something odd happened')
})

test('空 stderr 给出兜底文案', () => {
  assert.equal(describeGitFailure('', CONTEXT), '克隆失败：git 未返回具体原因')
})
