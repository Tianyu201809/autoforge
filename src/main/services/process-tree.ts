import { execFile } from 'node:child_process'

const PROCESS_LIST_TIMEOUT_MS = 8_000
const DEFAULT_POLL_MS = 400

export function parentMapFromWmicCsv(text: string): Map<number, number> {
  const parents = new Map<number, number>()
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const header = lines[0]?.split(',') ?? []
  const pidIndex = header.findIndex((column) => column.toLowerCase() === 'processid')
  const parentIndex = header.findIndex((column) => column.toLowerCase() === 'parentprocessid')
  if (pidIndex < 0 || parentIndex < 0) return parents
  for (const line of lines.slice(1)) {
    const columns = line.split(',')
    const pid = Number(columns[pidIndex])
    const parent = Number(columns[parentIndex])
    if (Number.isInteger(pid) && pid > 0 && Number.isInteger(parent) && parent >= 0) {
      parents.set(pid, parent)
    }
  }
  return parents
}

export function parentMapFromProcessRecords(records: unknown): Map<number, number> {
  const parents = new Map<number, number>()
  const rows = Array.isArray(records) ? records : records ? [records] : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as { ProcessId?: unknown; ParentProcessId?: unknown }
    const pid = Number(record.ProcessId)
    const parent = Number(record.ParentProcessId)
    if (Number.isInteger(pid) && pid > 0 && Number.isInteger(parent) && parent >= 0) {
      parents.set(pid, parent)
    }
  }
  return parents
}

export function collectDescendantPids(rootPid: number, parentByPid: Map<number, number>): number[] {
  const children = new Map<number, number[]>()
  for (const [pid, parent] of parentByPid) {
    if (pid === parent) continue
    const list = children.get(parent)
    if (list) list.push(pid)
    else children.set(parent, [pid])
  }
  const descendants: number[] = []
  const seen = new Set<number>([rootPid])
  const stack = [...(children.get(rootPid) ?? [])]
  while (stack.length > 0) {
    const pid = stack.pop()
    if (pid == null || seen.has(pid)) continue
    seen.add(pid)
    descendants.push(pid)
    for (const child of children.get(pid) ?? []) stack.push(child)
  }
  return descendants
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function execText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: PROCESS_LIST_TIMEOUT_MS },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      }
    )
  })
}

/** 枚举本机进程的父 PID。失败时返回 null，调用方不要把“未知”当成“没有子进程”。 */
export async function listParentPidMap(): Promise<Map<number, number> | null> {
  if (process.platform !== 'win32') return null
  try {
    const stdout = await execText('wmic', ['process', 'get', 'ProcessId,ParentProcessId', '/FORMAT:CSV'])
    const parsed = parentMapFromWmicCsv(stdout)
    if (parsed.size > 0) return parsed
  } catch {
    // wmic 在新系统上可能被移除，改用 PowerShell。
  }
  try {
    const stdout = await execText('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'
    ])
    const parsed = parentMapFromProcessRecords(JSON.parse(stdout))
    return parsed.size > 0 ? parsed : null
  } catch {
    return null
  }
}

const trackedDescendants = new Map<number, number[]>()

export function noteDescendants(rootPid: number, pids: readonly number[]): void {
  trackedDescendants.set(rootPid, [...pids])
}

export function trackedDescendantPids(rootPid: number): number[] {
  return [...(trackedDescendants.get(rootPid) ?? [])]
}

export function clearTrackedDescendants(rootPid: number): void {
  trackedDescendants.delete(rootPid)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function unixProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export interface ProcessTreeWatchOptions {
  isAborted?: () => boolean
  onDescendants?: (pids: number[]) => void
  intervalMs?: number
}

/**
 * 直接子进程已经退出之后，继续等待它拉起、并且仍然活着的后代进程。
 * Windows 启动器退出后，ParentProcessId 仍指向原 PID，所以还能找到真正的程序。
 */
export async function waitUntilDescendantsExit(
  rootPid: number,
  options: ProcessTreeWatchOptions = {}
): Promise<{ hadDescendants: boolean }> {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_MS
  if (process.platform !== 'win32') {
    let hadDescendants = false
    while (!options.isAborted?.()) {
      if (!unixProcessGroupAlive(rootPid)) return { hadDescendants }
      hadDescendants = true
      options.onDescendants?.([rootPid])
      await sleep(intervalMs)
    }
    return { hadDescendants }
  }

  let hadDescendants = false
  let failures = 0
  while (!options.isAborted?.()) {
    const parents = await listParentPidMap()
    if (!parents) {
      failures += 1
      if (failures >= 3) return { hadDescendants }
      await sleep(intervalMs)
      continue
    }
    failures = 0
    const alive = collectDescendantPids(rootPid, parents).filter((pid) => isPidAlive(pid))
    if (alive.length > 0) hadDescendants = true
    options.onDescendants?.(alive)
    noteDescendants(rootPid, alive)
    if (alive.length === 0) return { hadDescendants }
    await sleep(intervalMs)
  }
  return { hadDescendants }
}
