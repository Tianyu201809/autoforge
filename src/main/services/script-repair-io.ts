import { existsSync, rmSync } from 'node:fs'
import { posix } from 'node:path'
import { MANIFEST_FILENAME } from '../../shared/script-contract'
import type { ScriptRepairContext } from '../../shared/llm-types'
import { MAX_REPAIR_CONTEXT_FILE_BYTES, MAX_REPAIR_CONTEXT_TOTAL_BYTES } from '../../shared/llm-types'
import { ConversionPlanError, resolvePackageFilePath } from './llm-converter'
import { mergeManifestPatch, validatePatchedManifest, type RepairApplyOutcome, type RepairChanges } from './llm-repair'
import { executionHistory } from './execution-history'
import { scriptRegistry } from './script-registry'
import { scriptWorkspace } from './script-workspace'

/** 修复上下文中跳过的目录 */
const SKIPPED_SEGMENTS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache'])

function shouldSkip(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]/)
    .some((segment) => SKIPPED_SEGMENTS.has(segment))
}

/** 收集交给模型修复的脚本上下文 */
export function readScriptRepairContext(
  scriptId: string,
  logs: string[]
): ScriptRepairContext | null {
  const script = scriptRegistry.getById(scriptId)
  if (!script || !existsSync(script.workspacePath)) return null

  const files: Array<{ path: string; content: string }> = []
  let used = 0
  for (const relativePath of scriptWorkspace.listWorkspaceFiles(script)) {
    if (shouldSkip(relativePath)) continue
    if (used >= MAX_REPAIR_CONTEXT_TOTAL_BYTES) break
    let file: { content: string; binary: boolean }
    try {
      file = scriptWorkspace.readWorkspaceFile(script, relativePath)
    } catch {
      continue
    }
    if (file.binary) continue
    const content =
      file.content.length > MAX_REPAIR_CONTEXT_FILE_BYTES
        ? `${file.content.slice(0, MAX_REPAIR_CONTEXT_FILE_BYTES)}\n... [已截断]`
        : file.content
    files.push({ path: relativePath.split(/[\\/]/).join(posix.sep), content })
    used += content.length
  }

  const recentRuns = executionHistory
    .listForScript(scriptId, 5)
    .map((record) => ({
      status: record.status,
      startedAt: record.startedAt,
      exitCode: record.exitCode,
      errorMessage: record.errorMessage
    }))

  return {
    scriptId,
    name: script.name,
    entry: script.entry,
    language: script.language,
    manifestText: scriptWorkspace.readManifestContent(script),
    files,
    recentRuns,
    logs: logs.filter((line) => typeof line === 'string' && line.trim()).slice(-200)
  }
}

/** 把修复结果写回脚本工作区 */
export function applyScriptRepair(scriptId: string, changes: RepairChanges): RepairApplyOutcome {
  const script = scriptRegistry.getById(scriptId)
  if (!script) throw new ConversionPlanError('脚本不存在')

  const existingFiles = new Set(
    scriptWorkspace.listWorkspaceFiles(script).map((path) => path.split(/[\\/]/).join(posix.sep))
  )

  const changedFiles: string[] = []
  for (const file of changes.files) {
    // 先做一次路径安全校验，再交给 workspace 写入
    resolvePackageFilePath(script.workspacePath, file.path)
    scriptWorkspace.writeWorkspaceFile(script, file.path, file.content)
    changedFiles.push(file.path)
  }

  const deletedFiles: string[] = []
  for (const path of changes.deleteFiles) {
    if (path === MANIFEST_FILENAME) {
      throw new ConversionPlanError('不允许删除 autoforge.json')
    }
    if (!existingFiles.has(path)) continue
    const target = resolvePackageFilePath(script.workspacePath, path)
    rmSync(target, { force: true })
    deletedFiles.push(path)
  }

  // 删除入口会让脚本无法运行，除非同一次修复重新写入了它
  const surviving = new Set([
    ...changedFiles,
    ...[...existingFiles].filter((path) => !deletedFiles.includes(path))
  ])
  if (!surviving.has(script.entry.split(/[\\/]/).join(posix.sep))) {
    throw new ConversionPlanError(`修复会删除入口文件 ${script.entry}，已中止`)
  }

  let manifestUpdated = false
  if (changes.manifestPatch) {
    const current = scriptWorkspace.readManifest(script.workspacePath)
    const merged = validatePatchedManifest(mergeManifestPatch(current, changes.manifestPatch))
    scriptWorkspace.writeManifestContent(script, JSON.stringify(merged, null, 2))
    const saved = scriptWorkspace.readManifest(script.workspacePath)
    scriptRegistry.update(scriptId, scriptWorkspace.manifestToMeta(scriptId, saved))
    manifestUpdated = true
  }

  return { changedFiles, deletedFiles, manifestUpdated }
}
