import type { ScriptLifecycleEvent, ScriptLifecyclePhase } from '../../shared/script-contract'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { broadcastToRenderers } from './window-broadcast'

export class ScriptLifecycleBus {
  private getWindow: () => BrowserWindow | null

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow
  }

  emit(
    sessionId: string,
    scriptId: string,
    phase: ScriptLifecyclePhase,
    message?: string
  ): ScriptLifecycleEvent {
    const event: ScriptLifecycleEvent = {
      sessionId,
      scriptId,
      phase,
      message,
      ts: new Date().toISOString()
    }
    broadcastToRenderers(IPC.EVENT_LIFECYCLE, event)
    return event
  }
}

export const LIFECYCLE_ORDER: ScriptLifecyclePhase[] = [
  'queued',
  'validating',
  'installing-deps',
  'starting',
  'running',
  'stopping',
  'completed',
  'failed',
  'stopped'
]
