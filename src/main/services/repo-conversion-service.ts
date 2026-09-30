import { app, net } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { UTF8 } from '../../shared/encoding'
import type { ScriptMeta } from '../../shared/types/script'
import type {
  RepoConvertProgress,
  RepoFetchRequest,
  RepoProfile,
  RepoWorkspaceInfo
} from '../../shared/repo-types'
import { scriptRegistry } from './script-registry'
import { scriptWorkspace } from './script-workspace'
import { analyzeRepoDirectory } from './repo-analyzer'
import { createRepoFetcher, type RepoFetchProgressReporter } from './repo-fetcher'
import { parseRepoUrl } from './repo-url'
import {
  buildHandoffDocument,
  buildHandoffPrompt,
  createRepoTaskId,
  detectPackageRoot,
  prepareRepoWorkspace,
  readWorkspaceProfile,
  toWorkspaceInfo,
  writeWorkspaceHandoff,
  writeWorkspaceProfile,
  getRepoWorkspacePaths
} from './repo-workspace'

const SKILL_RELATIVE_PATH = join('skills', 'repo-to-autoforge', 'SKILL.md')

/** 读取随包分发的 repo-to-autoforge 技能说明，作为交接文档的附录 */
export function readRepoToAutoforgeSkill(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, SKILL_RELATIVE_PATH)]
    : [join(app.getAppPath(), SKILL_RELATIVE_PATH)]

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        return readFileSync(path, UTF8)
      } catch {
        /* fallthrough */
      }
    }
  }
  return undefined
}

export type RepoConvertProgressReporter = (progress: RepoConvertProgress) => void

export interface RepoConversionService {
  convert(input: RepoFetchRequest, onProgress?: RepoConvertProgressReporter): Promise<RepoWorkspaceInfo>
  getWorkspace(taskId: string): RepoWorkspaceInfo | null
  importPackage(taskId: string): ScriptMeta
}

function createService(): RepoConversionService {
  const fetcher = createRepoFetcher({
    request: (url, init) => net.fetch(url, init)
  })
  let busy = false

  function report(
    taskId: string,
    onProgress: RepoConvertProgressReporter | undefined,
    progress: Omit<RepoConvertProgress, 'taskId'>
  ): void {
    onProgress?.({ taskId, ...progress })
  }

  async function convert(
    input: RepoFetchRequest,
    onProgress?: RepoConvertProgressReporter
  ): Promise<RepoWorkspaceInfo> {
    const url = typeof input?.url === 'string' ? input.url.trim() : ''
    const taskId = `pending-${Date.now()}`
    if (!url) throw new Error('请输入仓库地址')
    if (busy) throw new Error('已有仓库正在转换，请等待当前任务完成')

    busy = true
    try {
      report(taskId, onProgress, { phase: 'validating', message: '正在校验仓库地址' })
      const ref = parseRepoUrl(url)
      if (input.ref?.trim()) ref.ref = input.ref.trim()

      const finalTaskId = createRepoTaskId(ref)
      const paths = prepareRepoWorkspace(finalTaskId)

      report(finalTaskId, onProgress, {
        phase: 'downloading',
        message: `正在拉取 ${ref.owner}/${ref.repo}`,
        percent: 0
      })

      const forward: RepoFetchProgressReporter = (progress) => {
        onProgress?.({ taskId: finalTaskId, ...progress })
      }
      const { resolvedRef, commitSha, fetchMethod } = await fetcher.fetchRepo({
        ref,
        repoDir: paths.repoPath,
        token: input.token,
        onProgress: forward
      })

      report(finalTaskId, onProgress, { phase: 'analyzing', message: '正在分析仓库结构' })
      const profile: RepoProfile = analyzeRepoDirectory(paths.repoPath, ref, resolvedRef, {
        commitSha,
        fetchMethod
      })

      writeWorkspaceProfile(finalTaskId, profile)
      const document = buildHandoffDocument(profile, paths, readRepoToAutoforgeSkill())
      writeWorkspaceHandoff(finalTaskId, document)

      report(finalTaskId, onProgress, {
        phase: 'workspace-ready',
        message: '转换工作区已就绪',
        percent: 100
      })

      return toWorkspaceInfo(paths, profile, buildHandoffPrompt(profile, paths))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report(taskId, onProgress, { phase: 'error', message: '拉取失败', error: message })
      throw error
    } finally {
      busy = false
    }
  }

  function getWorkspace(taskId: string): RepoWorkspaceInfo | null {
    if (!taskId?.trim()) return null
    const profile = readWorkspaceProfile(taskId)
    if (!profile) return null
    const paths = getRepoWorkspacePaths(taskId)
    if (!existsSync(paths.workspacePath)) return null
    return toWorkspaceInfo(paths, profile, buildHandoffPrompt(profile, paths))
  }

  function importPackage(taskId: string): ScriptMeta {
    const packageRoot = detectPackageRoot(taskId)
    if (!packageRoot) {
      throw new Error('产物目录中还没有可导入的脚本包：请确认已生成 autoforge.json')
    }
    scriptWorkspace.validatePackageDirectory(packageRoot)
    return scriptRegistry.importFromPath(packageRoot)
  }

  return { convert, getWorkspace, importPackage }
}

let instance: RepoConversionService | null = null

export function getRepoConversionService(): RepoConversionService {
  if (!instance) instance = createService()
  return instance
}
