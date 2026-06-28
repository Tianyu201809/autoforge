import type { ScheduledTask } from 'node-cron'
import cron from 'node-cron'
import type { ScriptMeta } from '../../shared/types/script'

export class SchedulerService {
  private tasks = new Map<string, ScheduledTask>()
  private onRun: (scriptId: string) => Promise<unknown>

  constructor(onRun: (scriptId: string) => Promise<unknown>) {
    this.onRun = onRun
  }

  reload(scripts: ScriptMeta[]): void {
    for (const task of this.tasks.values()) {
      task.stop()
    }
    this.tasks.clear()

    for (const script of scripts) {
      if (!script.schedule?.enabled || !script.schedule.expression) continue
      if (!cron.validate(script.schedule.expression)) continue

      const task = cron.schedule(script.schedule.expression, () => {
        void this.onRun(script.id)
      })
      this.tasks.set(script.id, task)
    }
  }
}
