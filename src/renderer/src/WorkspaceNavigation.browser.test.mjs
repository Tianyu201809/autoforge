import assert from 'node:assert/strict'
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

// Use the actual App routing fragment so removing its cache reproduces this bug.
const appSource = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
const route = appSource.slice(appSource.indexOf('      <AiProjectWorkspace'), appSource.indexOf('      <div v-', appSource.indexOf('      <AiProjectWorkspace')))
const prefix = appSource.slice(0, appSource.indexOf('      <AiProjectWorkspace')).trimEnd().endsWith('<KeepAlive>') ? '<KeepAlive>' : ''

test('page navigation preserves a running chat and analysis until completion or cancellation', async () => {
  const server = await createServer({configFile:false, root:process.cwd(), plugins:[vue(),{
    name:'navigation-regression',
    configureServer(server){server.middlewares.use('/navigation-test',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<div id="app"></div><script type="module" src="/@navigation-entry"></script>')})},
    resolveId(id){if(id==='/@navigation-entry')return '\0navigation-entry';if(id==='/@navigation-test')return '/virtual-navigation-test.vue'},
    load(id){if(id==='\0navigation-entry')return "import {createApp} from 'vue';import App from '/@navigation-test';createApp(App).mount('#app')";if(id==='/virtual-navigation-test.vue')return `<script setup>import {reactive} from 'vue'; import AiProjectWorkspace from '/src/renderer/src/components/AiProjectWorkspace.vue'; const workspaceNavigation={state:reactive({view:'projects',inspectorOpen:true,inspectorWidth:300,activeProjectId:'p'}),toggleInspector(){},setWidths(){},setActiveProject(){}}</script><template><button id="away" @click="workspaceNavigation.state.view = 'settings'">Settings</button><button id="back" @click="workspaceNavigation.state.view = 'projects'">Projects</button>${prefix}${route}</template>`}
  }],optimizeDeps:{noDiscovery:true,include:['vue','lucide-vue-next','markdown-it','dompurify']},server:{host:'127.0.0.1',port:0}})
  await server.listen()
  const executable=join(resolve(realpathSync('node_modules'),'..','resources','browsers'),'chromium-1228','chrome-win64','chrome.exe')
  const browser=await chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})})
  try{
    const page=await browser.newPage()
    page.on('pageerror',error=>console.log(error.message))
    await page.addInitScript(()=>{
      const project={id:'p',name:'Project',rootPath:'C:/project',language:'javascript',profileId:'model',status:'ready'}
      const listeners=new Set();let turns=[];let finish;let started=0
      const run=async()=>{
        if(finish)throw Error('项目已有正在运行的任务')
        started++
        const turn={id:'answer-'+started,projectId:'p',role:'assistant',content:'',status:'running'}
        turns.push(turn)
        return new Promise(resolve=>{finish=status=>{
          turn.status=status;turn.content='## Completed '+started
          for(const cb of listeners)cb({type:'turn_finished',projectId:'p',turnId:turn.id,status})
          finish=null;resolve({...turn})
        }})
      }
      window.testAgent={complete:()=>finish?.('complete'),delta:text=>{for(const cb of listeners)cb({type:'assistant_delta',projectId:'p',turnId:'answer-'+started,text})},calls:()=>started}
      window.autoforge={ai:{listProjects:async()=>[project],getProject:async()=>project,listProjectTurns:async()=>structuredClone(turns),listProfiles:async()=>({profiles:[],activeProfileId:'model',credentialPersistent:true}),onAgentEvent:cb=>{listeners.add(cb);return()=>listeners.delete(cb)},startTurn:run,importProject:run,cancelTurn:async()=>{finish?.('cancelled');return true}}}
    })
    await page.goto(server.resolvedUrls.local[0]+'navigation-test')
    page.setDefaultTimeout(8000)
    const input=page.locator('textarea')
    await input.fill('Generate a script')
    await page.getByRole('button',{name:'发送消息',exact:true}).click()
    await page.locator('#away').click()
    await page.evaluate(()=>window.testAgent.delta('## Still working'))
    await page.locator('#back').click()
    assert.equal(await input.isDisabled(),true,'returning must retain busy state')
    assert.equal(await page.getByRole('button',{name:'停止生成',exact:true}).count(),1)
    assert.match(await page.locator('.ai-markdown').last().textContent(),/Still working/)
    await page.evaluate(()=>window.testAgent.complete())
    await input.waitFor()
    await page.waitForFunction(()=>!document.querySelector('textarea').disabled)
    assert.match(await page.locator('.ai-conversation').textContent(),/Completed 1/)
    await page.getByRole('button',{name:'导入脚本',exact:true}).click()
    await page.locator('#away').click()
    await page.locator('#back').click()
    assert.equal(await input.isDisabled(),true,'analysis must remain busy across navigation')
    await page.getByRole('button',{name:'停止生成',exact:true}).click()
    await page.waitForFunction(()=>!document.querySelector('textarea').disabled)
    assert.match(await page.locator('.ai-conversation').textContent(),/已停止/)
    await input.fill('Finish while away')
    await page.getByRole('button',{name:'发送消息',exact:true}).click()
    await page.locator('#away').click()
    await page.evaluate(()=>window.testAgent.complete())
    await page.locator('#back').click()
    await page.waitForFunction(()=>!document.querySelector('textarea').disabled)
    assert.match(await page.locator('.ai-conversation').textContent(),/Completed 3/)
    assert.equal(await page.evaluate(()=>window.testAgent.calls()),3)
    assert.equal(await page.locator('[role="alert"]').count(),0)
  }finally{await browser.close();await server.close()}
})
