import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildArchiveRequest,
  parseRepoUrl,
  RepoUrlError,
  resolveRefFromArchiveDir,
  selectFetchStrategy,
  supportsArchiveFetch
} from './repo-url'

test('parseRepoUrl 解析标准 https 地址', () => {
  const ref = parseRepoUrl('https://github.com/octocat/Hello-World')
  assert.equal(ref.provider, 'github')
  assert.equal(ref.owner, 'octocat')
  assert.equal(ref.repo, 'Hello-World')
  assert.equal(ref.ref, undefined)
  assert.equal(ref.url, 'https://github.com/octocat/Hello-World')
  assert.equal(ref.transport, 'https')
  assert.equal(ref.cloneUrl, 'https://github.com/octocat/Hello-World.git')
})

test('parseRepoUrl 去除 .git 后缀', () => {
  const ref = parseRepoUrl('https://github.com/octocat/Hello-World.git')
  assert.equal(ref.repo, 'Hello-World')
})

test('parseRepoUrl 识别 /tree/<ref> 片段', () => {
  const ref = parseRepoUrl('https://github.com/octocat/Hello-World/tree/feature/x')
  assert.equal(ref.ref, 'feature/x')
})

test('parseRepoUrl 支持 gitee', () => {
  const ref = parseRepoUrl('https://gitee.com/oschina/git-osc')
  assert.equal(ref.provider, 'gitee')
  assert.equal(ref.owner, 'oschina')
  assert.equal(ref.repo, 'git-osc')
})

test('parseRepoUrl 支持 git@ scp 形式并标记为 ssh', () => {
  const ref = parseRepoUrl('git@github.com:octocat/Hello-World.git')
  assert.equal(ref.provider, 'github')
  assert.equal(ref.owner, 'octocat')
  assert.equal(ref.repo, 'Hello-World')
  assert.equal(ref.transport, 'ssh')
  assert.equal(ref.cloneUrl, 'git@github.com:octocat/Hello-World.git')
  assert.equal(ref.url, 'https://github.com/octocat/Hello-World')
})

test('parseRepoUrl 支持 gitee 的 SSH 地址', () => {
  const ref = parseRepoUrl('git@gitee.com:Tianyu201809/coordinate-tool.git')
  assert.equal(ref.provider, 'gitee')
  assert.equal(ref.transport, 'ssh')
  assert.equal(ref.cloneUrl, 'git@gitee.com:Tianyu201809/coordinate-tool.git')
})

test('parseRepoUrl 支持 ssh:// 形式', () => {
  const ref = parseRepoUrl('ssh://git@gitee.com/Tianyu201809/coordinate-tool.git')
  assert.equal(ref.provider, 'gitee')
  assert.equal(ref.owner, 'Tianyu201809')
  assert.equal(ref.repo, 'coordinate-tool')
  assert.equal(ref.transport, 'ssh')
  assert.equal(ref.cloneUrl, 'git@gitee.com:Tianyu201809/coordinate-tool.git')
})

test('parseRepoUrl 支持不带用户名的 ssh:// 形式', () => {
  const ref = parseRepoUrl('ssh://gitee.com/oschina/git-osc.git')
  assert.equal(ref.transport, 'ssh')
  assert.equal(ref.cloneUrl, 'git@gitee.com:oschina/git-osc.git')
})

test('parseRepoUrl 支持省略协议', () => {
  const ref = parseRepoUrl('gitee.com/oschina/git-osc')
  assert.equal(ref.provider, 'gitee')
  assert.equal(ref.transport, 'https')
})

test('parseRepoUrl 拒绝不支持的托管方', () => {
  assert.throws(() => parseRepoUrl('https://gitlab.com/owner/repo'), RepoUrlError)
})

test('parseRepoUrl 拒绝缺少 owner/repo', () => {
  assert.throws(() => parseRepoUrl('https://github.com/octocat'), RepoUrlError)
})

test('parseRepoUrl 拒绝空输入', () => {
  assert.throws(() => parseRepoUrl('   '), RepoUrlError)
})

test('parseRepoUrl 拒绝 git:// 协议', () => {
  assert.throws(() => parseRepoUrl('git://github.com/octocat/Hello-World.git'), RepoUrlError)
})

test('supportsArchiveFetch 仅 GitHub 支持归档下载', () => {
  assert.equal(supportsArchiveFetch('github'), true)
  assert.equal(supportsArchiveFetch('gitee'), false)
})

test('selectFetchStrategy 按传输方式与托管方选择', () => {
  assert.equal(selectFetchStrategy(parseRepoUrl('https://github.com/octocat/Hello-World')), 'archive')
  assert.equal(selectFetchStrategy(parseRepoUrl('https://gitee.com/oschina/git-osc')), 'git')
  assert.equal(selectFetchStrategy(parseRepoUrl('git@github.com:octocat/Hello-World.git')), 'git')
  assert.equal(selectFetchStrategy(parseRepoUrl('git@gitee.com:oschina/git-osc.git')), 'git')
})

test('buildArchiveRequest 无 token 时走公开归档地址', () => {
  const ref = parseRepoUrl('https://github.com/octocat/Hello-World')
  const request = buildArchiveRequest(ref)
  assert.equal(request.url, 'https://github.com/octocat/Hello-World/archive/HEAD.zip')
  assert.equal(request.headers.Authorization, undefined)
})

test('buildArchiveRequest 指定分支时写入归档路径', () => {
  const ref = parseRepoUrl('https://github.com/octocat/Hello-World')
  const pinned = buildArchiveRequest({ ...ref, ref: 'main' })
  assert.equal(pinned.url, 'https://github.com/octocat/Hello-World/archive/main.zip')
})

test('buildArchiveRequest 有 token 时走 GitHub API', () => {
  const ref = parseRepoUrl('https://github.com/octocat/Hello-World')
  const request = buildArchiveRequest(ref, 'secret-token')
  assert.equal(request.url, 'https://api.github.com/repos/octocat/Hello-World/zipball')
  assert.equal(request.headers.Authorization, 'Bearer secret-token')
})

test('buildArchiveRequest 对 Gitee 明确报错', () => {
  const ref = parseRepoUrl('https://gitee.com/oschina/git-osc')
  assert.throws(() => buildArchiveRequest(ref), RepoUrlError)
})

test('resolveRefFromArchiveDir 从顶层目录名推断分支', () => {
  assert.equal(resolveRefFromArchiveDir('Hello-World-main', 'Hello-World'), 'main')
  assert.equal(resolveRefFromArchiveDir('git-osc-master', 'git-osc'), 'master')
  assert.equal(resolveRefFromArchiveDir('unexpected', 'Hello-World'), 'unexpected')
})
