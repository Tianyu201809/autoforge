import type { BrowserWindow } from 'electron'
import { SchedulerService } from './scheduler'
import { ScriptRunnerService } from './script-runner'

export interface AutoforgeRuntime {
  runner: ScriptRunnerService
  scheduler: SchedulerService
}

export function createRuntimeContainer(getWindow: () => BrowserWindow | null): AutoforgeRuntime {
  const runner = new ScriptRunnerService(getWindow)
  const scheduler = new SchedulerService((scriptId) =>
    runner.start(scriptId, undefined, undefined, { trigger: 'scheduled' })
  )
  return { runner, scheduler }
}
