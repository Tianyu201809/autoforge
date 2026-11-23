import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProjectBuilder } from './project-builder'

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'autoforge 构建-'))
  t.after(() => rmSync(root, {recursive:true, force:true}))
  return root
}
test('builds the configured package script in the project directory', async t => {
  const root=fixture(t)
  writeFileSync(join(root,'package.json'),JSON.stringify({scripts:{build:'node build.cjs'}}))
  writeFileSync(join(root,'build.cjs'),"require('fs').writeFileSync('entry.mjs','export function run(){}')")
  const result=await createProjectBuilder()(root)
  assert.equal(result.status,'passed',JSON.stringify(result))
  assert.equal(result.code,'build_passed')
  assert.equal(existsSync(join(root,'entry.mjs')),true)
})
test('no build script needs no build tool and leaves sources unchanged',async t=>{
  const root=fixture(t)
  assert.equal((await createProjectBuilder()(root)).code,'build_not_required')
  writeFileSync(join(root,'package.json'),'{"scripts":{"test":"node test.js"}}')
  assert.equal((await createProjectBuilder()(root)).code,'build_not_required')
})
test('reports build failure and invalid package JSON',async t=>{
  const root=fixture(t)
  writeFileSync(join(root,'package.json'),JSON.stringify({scripts:{build:'node -e "process.exit(1)"'}}))
  assert.equal((await createProjectBuilder()(root)).status,'failed')
  writeFileSync(join(root,'package.json'),'{broken')
  assert.equal((await createProjectBuilder()(root)).code,'build_config_invalid')
  for (const value of [null, [], { scripts: { build: 42 } }]) {
    writeFileSync(join(root, 'package.json'), JSON.stringify(value))
    assert.equal((await createProjectBuilder()(root)).code, 'build_config_invalid')
  }
})

test('stops a timed-out build and does not launch a pre-cancelled build', async t => {
  const root = fixture(t)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node wait.cjs' } }))
  writeFileSync(join(root, 'wait.cjs'), 'setTimeout(()=>{},30000)')
  assert.equal((await createProjectBuilder({ timeoutMs: 200 })(root)).code, 'build_timeout')
  const controller = new AbortController()
  controller.abort()
  assert.equal((await createProjectBuilder()(root, controller.signal)).code, 'build_cancelled')
})
test('cancels a build and prevents its child from writing delayed output',async t=>{
  const root=fixture(t)
  writeFileSync(join(root,'package.json'),JSON.stringify({scripts:{build:'node wait.cjs'}}))
  writeFileSync(join(root,'wait.cjs'),"require('fs').writeFileSync('started','yes');setTimeout(()=>require('fs').writeFileSync('late','bad'),1500)")
  const controller=new AbortController()
  const running=createProjectBuilder()(root,controller.signal)
  const deadline=Date.now()+10000
  while(!existsSync(join(root,'started')) && Date.now()<deadline) await new Promise(r=>setTimeout(r,25))
  assert.equal(existsSync(join(root,'started')),true)
  controller.abort()
  assert.equal((await running).code,'build_cancelled')
  await new Promise(r=>setTimeout(r,1600))
  assert.equal(existsSync(join(root,'late')),false)
})
