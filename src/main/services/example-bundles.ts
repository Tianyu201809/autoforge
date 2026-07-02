import { app } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { UTF8 } from '../../shared/encoding'
import { hasManifest } from './script-workspace'
import { scriptWorkspace } from './script-workspace'
import type { ScriptMeta } from '../../shared/types/script'

export interface BundledExample {
  id: string
  name: string
  description: string
  version: string
  category: string
  categoryLabel: string
  sourcePath: string
}

/** 开发模式：项目根 examples/；打包后：resources/examples/ */
export function getExamplesRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'examples')
  }
  return join(app.getAppPath(), 'examples')
}

export function listBundledExamples(): BundledExample[] {
  const root = getExamplesRoot()
  if (!existsSync(root)) return []

  const results: BundledExample[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    if (!hasManifest(dir)) continue

    try {
      const manifest = scriptWorkspace.readManifest(dir)
      results.push({
        id: entry.name,
        name: manifest.name,
        description: manifest.description ?? '',
        version: manifest.version ?? '1.0.0',
        category: manifest.category ?? 'local',
        categoryLabel: manifest.categoryLabel ?? manifest.category ?? 'local',
        sourcePath: dir
      })
    } catch {
      /* skip invalid packages */
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export function importBundledExample(exampleId: string): ScriptMeta {
  const example = listBundledExamples().find((e) => e.id === exampleId)
  if (!example) throw new Error(`示例不存在: ${exampleId}`)
  return scriptWorkspace.importFromDirectory(example.sourcePath)
}

/** 去掉 Cursor skill 文件顶部的 YAML frontmatter */
function stripYamlFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown
  const end = markdown.indexOf('---', 3)
  if (end === -1) return markdown
  return markdown.slice(end + 3).replace(/^\s*\n/, '')
}

/** 读取开发规范 markdown（docs/script-spec.md） */
export function readDevGuideMarkdown(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'docs', 'script-spec.md')]
    : [join(app.getAppPath(), 'docs', 'script-spec.md')]

  for (const path of candidates) {
    if (existsSync(path)) {
      return readFileSync(path, UTF8)
    }
  }
  return '# 脚本开发规范\n\n未找到 script-spec.md'
}

/** 读取脚本创建流程（skills/autoforge-script-create/SKILL.md） */
export function readDevGuideSkillCreateMarkdown(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'skills', 'autoforge-script-create', 'SKILL.md')]
    : [join(app.getAppPath(), 'skills', 'autoforge-script-create', 'SKILL.md')]

  for (const path of candidates) {
    if (existsSync(path)) {
      return stripYamlFrontmatter(readFileSync(path, UTF8))
    }
  }
  return '# 脚本创建流程\n\n未找到 autoforge-script-create/SKILL.md'
}
