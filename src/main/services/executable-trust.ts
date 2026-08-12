import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'
import type { ScriptMeta } from '../../shared/types/script'
import {
  assertRunnableExecutable,
  type ExecutableInspection
} from './executable-inspector'
import { resolveSafeExistingWorkspaceFile } from './script-workspace'

export interface ExecutableTrustStore {
  has(scriptId: string, entry: string, sha256: string): boolean
  grant(scriptId: string, entry: string, sha256: string): void
  deleteForScript(scriptId: string): void
}

export interface ExecutableAuthorization {
  entryPath: string
  entry: string
  sha256: string
  inspection: ExecutableInspection
}

export interface ExecutableConfirmationInput {
  script: ScriptMeta
  entry: string
  entryPath: string
  sha256: string
  inspection: ExecutableInspection
}

export class ExecutableAuthorizationCancelledError extends Error {
  constructor() {
    super('用户取消运行可执行程序')
    this.name = 'ExecutableAuthorizationCancelledError'
  }
}

export function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  const fd = openSync(filePath, 'r')
  const buffer = Buffer.alloc(1024 * 1024)
  try {
    let offset = 0
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, offset)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}

export class ExecutableTrustService {
  constructor(
    private store: ExecutableTrustStore,
    private confirm: (input: ExecutableConfirmationInput) => Promise<boolean>,
    private platform: NodeJS.Platform = process.platform
  ) {}

  private inspect(script: ScriptMeta): ExecutableAuthorization {
    const entryPath = resolveSafeExistingWorkspaceFile(script.workspacePath, script.entry)
    const inspection = assertRunnableExecutable(entryPath, this.platform)
    return {
      entryPath,
      entry: script.entry.replace(/\\/g, '/'),
      sha256: sha256File(entryPath),
      inspection
    }
  }

  requireTrusted(script: ScriptMeta): ExecutableAuthorization {
    const authorization = this.inspect(script)
    if (!this.store.has(script.id, authorization.entry, authorization.sha256)) {
      throw new Error('需要先在 Autoforge 中手动确认运行')
    }
    return authorization
  }

  async authorize(input: {
    script: ScriptMeta
    interactive: boolean
  }): Promise<ExecutableAuthorization> {
    const authorization = this.inspect(input.script)
    if (this.store.has(input.script.id, authorization.entry, authorization.sha256)) {
      return authorization
    }
    if (!input.interactive) throw new Error('需要先在 Autoforge 中手动确认运行')

    const confirmed = await this.confirm({ script: input.script, ...authorization })
    if (!confirmed) throw new ExecutableAuthorizationCancelledError()

    const current = this.inspect(input.script)
    if (current.entry !== authorization.entry || current.sha256 !== authorization.sha256) {
      throw new Error('入口文件已变化，请重新确认运行')
    }
    this.store.grant(input.script.id, current.entry, current.sha256)
    return current
  }

  assertCurrent(authorization: ExecutableAuthorization): void {
    const inspection = assertRunnableExecutable(authorization.entryPath, this.platform)
    const currentHash = sha256File(authorization.entryPath)
    if (currentHash !== authorization.sha256 || inspection.platform !== authorization.inspection.platform) {
      throw new Error('入口文件已变化，请重新确认运行')
    }
  }
}
