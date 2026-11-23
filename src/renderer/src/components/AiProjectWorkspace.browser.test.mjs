import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

test('workspace renders Markdown, attaches previews, sends and restores history', async () => {
  const server = await createServer({ configFile:false, root:process.cwd(), plugins:[vue(), {
    name:'ai-test-harness',
    configureServer(server) {
      server.middlewares.use('/ai-test', (_req,res) => { res.setHeader('Content-Type','text/html'); res.end('<div id="app"></div><script type="module" src="/@ai-harness"></script>') })
    },
    resolveId(id) { if (id === '/@ai-harness') return '\0ai-harness' },
    load(id) { if (id === '\0ai-harness') return `import {createApp} from 'vue'; import App from '/src/renderer/src/components/AiProjectWorkspace.vue'; createApp(App,{inspectorOpen:false,inspectorWidth:300,activeProjectId:'project-a'}).mount('#app')` }
  }], optimizeDeps:{noDiscovery:true,include:['vue','lucide-vue-next','markdown-it','dompurify']}, server:{host:'127.0.0.1',port:0} })
  await server.listen()
  const bundledRoot = resolve(realpathSync('node_modules'), '..', 'resources', 'browsers')
  const executable = join(bundledRoot,'chromium-1228','chrome-win64','chrome.exe')
  const browser = await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})})
  try {
    const page = await browser.newPage({viewport:{width:1440,height:960}})
    await page.addInitScript(() => {
      const project={id:'project-a',name:'Test workspace',rootPath:'C:/project',language:'javascript',profileId:'p',status:'ready',pinned:false}
      const asset={id:'asset-a',name:'reference.png',kind:'image',mimeType:'image/png',size:68}
      const img='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
      let turns=[{id:'first',projectId:project.id,role:'assistant',content:'# Plan\n\n- First\n- Second\n\n```js\nconst value = 1\n```',status:'complete'}]
      turns=JSON.parse(sessionStorage.getItem('turns') || 'null') ?? turns
      let listener=()=>{}
      window.autoforge={system:{openInExternalEditor:async path=>{window.editorPath=path;return {ok:true}}},ai:{
        listProjects:async()=>[project,{...project,id:'project-b',name:'Other project',rootPath:'C:/other-project'}],getProject:async()=>project,listProjectTurns:async()=>structuredClone(turns),
        listProfiles:async()=>({profiles:[{id:'p',name:'Vision',hasCredentials:true}],activeProfileId:'p',credentialPersistent:true}),
        onAgentEvent:cb=>{listener=cb;return()=>{}},
        pickAttachments:async()=>[asset],previewAttachment:async()=>({metadata:asset,dataUrl:img}),removeAttachment:async()=>true,
        startTurn:async(id,message,options)=>{
          window.sentOptions=options
          listener({type:'assistant_delta',projectId:id,turnId:'answer',text:'## Streaming'})
          await new Promise(resolve=>setTimeout(resolve,100))
          const answer={id:'answer',projectId:id,role:'assistant',status:'complete',content:'## Done\n\n|a|b|\n|---|---|\n|1|2|'}
          turns=[...turns,{id:'user',projectId:id,role:'user',content:message,attachments:[asset],status:'complete'},answer]
          sessionStorage.setItem('turns',JSON.stringify(turns))
          return answer
        }
      }}
    })
    await page.goto(server.resolvedUrls.local[0]+'ai-test')
    await page.locator('.ai-markdown h1').waitFor()
    assert.equal(await page.locator('.ai-markdown li').count(),2)
    await page.getByRole('button',{name:'Other project',exact:false}).click({button:'right'})
    await page.getByRole('menuitem',{name:'使用编辑器打开',exact:true}).click({timeout:2000})
    assert.equal(await page.evaluate(()=>window.editorPath),'C:/other-project')
    assert.equal(await page.getByRole('menu').count(),0)
    assert.equal(await page.locator('.ai-project-title').textContent(),'Test workspace')
    await page.getByRole('button',{name:'添加素材',exact:true}).click()
    await page.locator('.ai-composer .ai-attachment img').waitFor()
    assert.equal(await page.getByRole('button',{name:'发送消息',exact:true}).isEnabled(),true)
    await page.getByRole('button',{name:'发送消息',exact:true}).click()
    await page.locator('.ai-markdown table').waitFor()
    assert.deepEqual(await page.evaluate(()=>window.sentOptions),{attachmentIds:['asset-a']})
    assert.equal(await page.locator('.ai-turn--user .ai-attachment img').count(),1)
    assert.equal(await page.locator('.ai-composer .ai-attachment').count(),0)
    await page.reload()
    await page.locator('.ai-markdown table').waitFor()
    await page.locator('.ai-turn--user .ai-attachment img').waitFor()
  } finally {await browser.close();await server.close()}
})
