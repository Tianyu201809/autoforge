import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { analyzeRepoDirectory, CONVERTIBILITY_LABELS } from './repo-analyzer'
import type { RepoRef } from '../../shared/repo-types'

const REF: RepoRef = {
  provider: 'github',
  owner: 'octocat',
  repo: 'demo',
  url: 'https://github.com/octocat/demo',
  transport: 'https',
  cloneUrl: 'https://github.com/octocat/demo.git'
}

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'autoforge-repo-analyzer-'))
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf-8')
  }
  return root
}

function analyze(files: Record<string, string>) {
  const root = makeRepo(files)
  try {
    return analyzeRepoDirectory(root, REF, 'main')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const MIT_LICENSE = [
  'MIT License',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software and associated documentation files (the "Software"), to deal'
].join('\n')

test('近似单文件 JS 项目判定为 direct', () => {
  const profile = analyze({
    'index.mjs': 'export async function run(ctx) { return { ok: true } }\n',
    'package.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
    'README.md': '# demo\n',
    LICENSE: MIT_LICENSE
  })

  assert.equal(profile.convertibility, 'direct')
  assert.equal(profile.license, 'MIT')
  assert.ok(profile.entryCandidates.includes('index.mjs'))
  assert.deepEqual(profile.runtimeDependencies, [])
  assert.equal(profile.languages[0].name, 'JavaScript')
})

test('Python 项目识别语言与 pip 依赖', () => {
  const profile = analyze({
    'main.py': 'def run(ctx):\n    return {"ok": True}\n',
    'requirements.txt': 'requests>=2.31.0\n# comment\n\nclick\n'
  })

  assert.equal(profile.languages[0].name, 'Python')
  assert.deepEqual(profile.runtimeDependencies, ['click', 'requests'])
  assert.ok(profile.entryCandidates.includes('main.py'))
  assert.equal(profile.convertibility, 'direct')
})

test('Python Web 框架依赖判定为 unsupported', () => {
  const profile = analyze({
    'app.py': 'from flask import Flask\napp = Flask(__name__)\n',
    'requirements.txt': 'flask>=3.0.0\n'
  })

  assert.equal(profile.hasWebServer, true)
  assert.equal(profile.convertibility, 'unsupported')
})

test('Web 服务依赖判定为 unsupported', () => {
  const profile = analyze({
    'index.js': 'const express = require("express")\n',
    'package.json': JSON.stringify({
      name: 'demo',
      dependencies: { express: '^4.18.0' }
    })
  })

  assert.equal(profile.convertibility, 'unsupported')
  assert.equal(profile.hasWebServer, true)
  assert.equal(CONVERTIBILITY_LABELS.unsupported, '不适合脚本化')
})

test('需要构建的 TypeScript 项目判定为 needs-build', () => {
  const profile = analyze({
    'package.json': JSON.stringify({
      name: 'demo',
      scripts: { build: 'tsc -p tsconfig.json' },
      main: 'dist/index.js'
    }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
    'src/index.ts': 'export async function run(ctx: unknown) { return { ok: true } }\n'
  })

  assert.equal(profile.hasBuildScript, true)
  assert.equal(profile.convertibility, 'needs-build')
})

test('monorepo 判定为 needs-build', () => {
  const profile = analyze({
    'package.json': JSON.stringify({ name: 'demo', workspaces: ['packages/*'] }),
    'index.mjs': 'export async function run(ctx) { return { ok: true } }\n'
  })

  assert.equal(profile.hasMonorepo, true)
  assert.equal(profile.convertibility, 'needs-build')
})

test('非 JS / Python 项目判定为 unsupported', () => {
  const profile = analyze({
    'main.go': 'package main\n\nfunc main() {}\n',
    'go.mod': 'module demo\n'
  })

  assert.equal(profile.convertibility, 'unsupported')
  assert.equal(profile.languages[0].name, 'Go')
})

test('缺少许可证与 README 时写入风险提示', () => {
  const profile = analyze({
    'index.mjs': 'export async function run(ctx) { return { ok: true } }\n'
  })

  assert.equal(profile.license, null)
  assert.equal(profile.readme, null)
  assert.ok(profile.risks.some((risk) => risk.includes('许可证')))
  assert.ok(profile.risks.some((risk) => risk.includes('README')))
})

test('忽略 node_modules 等依赖目录', () => {
  const profile = analyze({
    'index.mjs': 'export async function run(ctx) { return { ok: true } }\n',
    'node_modules/left-pad/index.js': 'module.exports = () => {}\n',
    '.venv/lib/python3.11/site.py': 'pass\n'
  })

  assert.equal(profile.fileCount, 1)
})

test('从 package.json bin 收集入口候选', () => {
  const profile = analyze({
    'package.json': JSON.stringify({ name: 'demo', bin: { demo: 'cli.js' } }),
    'cli.js': '#!/usr/bin/env node\n',
    'lib/helper.js': 'module.exports = {}\n'
  })

  assert.ok(profile.entryCandidates.includes('cli.js'))
})

test('透传拉取方式与 commit，缺省为归档', () => {
  const root = makeRepo({ 'index.mjs': 'export async function run(ctx) {}\n' })
  try {
    const fallback = analyzeRepoDirectory(root, REF, 'main')
    assert.equal(fallback.fetchMethod, 'archive')
    assert.equal(fallback.commitSha, null)

    const cloned = analyzeRepoDirectory(root, REF, 'main', {
      fetchMethod: 'git',
      commitSha: '7ecf2dcd0304265ec4e250463ad40f76dcdc3597'
    })
    assert.equal(cloned.fetchMethod, 'git')
    assert.equal(cloned.commitSha, '7ecf2dcd0304265ec4e250463ad40f76dcdc3597')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
