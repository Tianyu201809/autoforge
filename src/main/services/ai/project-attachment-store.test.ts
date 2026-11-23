import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectAttachmentStore, ATTACHMENT_LIMITS } from './project-attachment-store'

test('stages owned UTF-8 text and real image bytes, survives reload, isolates deletion', t => {
  const root = mkdtempSync(join(tmpdir(), 'ai-assets-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const storeRoot = join(root, 'private')
  const text = join(root, 'notes.md')
  writeFileSync(text, '# 需求')
  const png = join(root, 'shot.png')
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
  const store = createProjectAttachmentStore(storeRoot)
  const [a, image] = store.stage('project-a', [text, png])
  assert.equal(a.kind, 'text')
  assert.equal(image.mimeType, 'image/png')
  assert.equal(JSON.stringify(a).includes(root), false)
  assert.equal(store.read('project-a', a.id).text, '# 需求')
  assert.match(store.preview('project-a', image.id).dataUrl!, /^data:image\/png;base64,/)
  assert.throws(() => store.read('project-b', a.id))
  assert.throws(() => store.read('../escape', '../escape'))
  const [b] = store.stage('project-b', [text])
  assert.equal(createProjectAttachmentStore(storeRoot).read('project-a', a.id).text, '# 需求')
  store.removeProject('project-a')
  assert.throws(() => store.read('project-a', a.id))
  assert.equal(store.read('project-b', b.id).text, '# 需求')
  assert.equal(existsSync(text), true)
})

test('rejects invalid content, oversized inputs and partial batches without staging anything', t => {
  const root = mkdtempSync(join(tmpdir(), 'ai-assets-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = createProjectAttachmentStore(join(root, 'private'))
  for (const [name, bytes] of [ ['fake.png', Buffer.from('<svg/>')], ['bad.txt', Buffer.from([0xff, 0xfe])], ['image.svg', Buffer.from('<svg/>')], ['tool.exe', Buffer.from('MZ')], ['big.txt', Buffer.alloc(ATTACHMENT_LIMITS.textBytes + 1, 65)] ] as const) {
    const file = join(root, name)
    writeFileSync(file, bytes)
    assert.throws(() => store.stage('p', [file]))
  }
  const good = join(root, 'ok.txt')
  writeFileSync(good, 'ok')
  assert.throws(() => store.stage('p', Array(ATTACHMENT_LIMITS.count + 1).fill(good)))
})
test('supports JPEG, GIF and WebP signatures', t => {
  const root=mkdtempSync(join(tmpdir(),'ai-image-types-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const store=createProjectAttachmentStore(join(root,'private'))
  for(const [name,bytes,mime] of [
    ['photo.jpg',Buffer.from([255,216,255,224,0,0]),'image/jpeg'],
    ['animation.gif',Buffer.from('GIF89a0000'),'image/gif'],
    ['web.webp',Buffer.from('RIFF0000WEBPVP8 '),'image/webp']
  ] as const){
    const path=join(root,name);writeFileSync(path,bytes)
    const [asset]=store.stage('p',[path])
    assert.equal(asset.mimeType,mime)
    assert.deepEqual(store.read('p',asset.id).bytes,bytes)
  }
})
