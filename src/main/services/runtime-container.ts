import { dialog, type BrowserWindow } from 'electron'
import { SchedulerService } from './scheduler'
import { ScriptRunnerService } from './script-runner'
import { scriptStore } from './script-store'
import { ExecutableTrustService } from './executable-trust'

export interface AutoforgeRuntime {
  runner: ScriptRunnerService
  scheduler: SchedulerService
}

export function createRuntimeContainer(getWindow: () => BrowserWindow | null): AutoforgeRuntime {
  const trust = new ExecutableTrustService(
    {
      has: (scriptId, entry, sha256) => scriptStore.hasExecutableTrust(scriptId, entry, sha256),
      grant: (scriptId, entry, sha256) => scriptStore.grantExecutableTrust(scriptId, entry, sha256),
      deleteForScript: (scriptId) => scriptStore.deleteExecutableTrust(scriptId)
    },
    async ({ script, entry, sha256 }) => {
      const response = await dialog.showMessageBox(getWindow() ?? undefined, {
        type: 'warning',
        title: '运行可执行程序',
        message: `是否信任并运行“${script.name}”？`,
        detail: `入口：${entry}\n来源：${script.hubScriptId ? 'Autoforge Hub' : '本地导入'}\nSHA-256：${sha256}\n\n该程序将以当前用户权限访问本机文件与网络。`,
        buttons: ['信任并运行', '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      return response.response === 0
    }
  )
  const runner = new ScriptRunnerService(getWindow, { trust })
  const scheduler = new SchedulerService((scriptId) =>
    runner.start(scriptId, undefined, undefined, { trigger: 'scheduled', interactive: false })
  )
  return { runner, scheduler }
}
