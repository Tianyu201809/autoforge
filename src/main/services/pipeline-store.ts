import { randomUUID } from 'crypto'
import type { ParamDefinition, EnvVarDefinition } from '../../shared/script-contract'
import type { PipelineMeta, PipelineNode } from '../../shared/types/script'
import { getDb } from '../db/database'
import { createRepositories, type Repositories } from '../db/repositories'
import { scriptRegistry } from './script-registry'

function aggregateSchema(nodes: PipelineNode[], kind: 'params' | 'env'): ParamDefinition[] | EnvVarDefinition[] {
  const result: (ParamDefinition | EnvVarDefinition)[] = []
  const seen = new Set<string>()
  const sourceNodes = kind === 'params' ? nodes.slice(0, 1) : nodes
  for (const node of sourceNodes) {
    const script = scriptRegistry.getById(node.scriptId)
    if (!script) continue
    const schema = kind === 'params' ? script.paramSchema : script.envSchema
    for (const field of schema) {
      const key = `${node.id}.${field.key}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        ...field,
        key,
        label: `${node.name} / ${field.label}`
      })
    }
  }
  return result as ParamDefinition[] | EnvVarDefinition[]
}

export class PipelineStore {
  private repos: Repositories | null = null

  private get repositories(): Repositories {
    if (!this.repos) this.repos = createRepositories(getDb())
    return this.repos
  }

  list(): PipelineMeta[] {
    return this.repositories.pipelines.listAll().map((pipeline) => this.refreshSchemas(pipeline))
  }

  get(id: string): PipelineMeta | undefined {
    const pipeline = this.repositories.pipelines.getById(id)
    return pipeline ? this.refreshSchemas(pipeline) : undefined
  }

  create(input: { name: string; description?: string; nodes: PipelineNode[] }): PipelineMeta {
    const nodes = this.normalizeNodes(input.nodes)
    this.validateNodes(nodes)
    const pipeline: PipelineMeta = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      nodes,
      envSchema: aggregateSchema(nodes, 'env') as EnvVarDefinition[],
      paramSchema: aggregateSchema(nodes, 'params') as ParamDefinition[],
      configByEnv: {},
      paramsByEnv: {},
      starred: false,
      archived: false
    }
    if (!pipeline.name) throw new Error('流水线名称不能为空')
    this.repositories.pipelines.insert(pipeline)
    return this.get(pipeline.id)!
  }

  update(id: string, patch: Partial<Pick<PipelineMeta, 'name' | 'description' | 'nodes' | 'starred' | 'archived'>>): PipelineMeta {
    const current = this.get(id)
    if (!current) throw new Error('流水线不存在')
    const nodes = patch.nodes ? this.normalizeNodes(patch.nodes) : current.nodes
    this.validateNodes(nodes)
    const nextPatch: Partial<PipelineMeta> = {
      ...patch,
      name: patch.name?.trim() ?? current.name,
      nodes,
      envSchema: aggregateSchema(nodes, 'env') as EnvVarDefinition[],
      paramSchema: aggregateSchema(nodes, 'params') as ParamDefinition[]
    }
    return this.repositories.pipelines.update(id, nextPatch)!
  }

  delete(id: string): boolean {
    return this.repositories.pipelines.delete(id)
  }

  private refreshSchemas(pipeline: PipelineMeta): PipelineMeta {
    return {
      ...pipeline,
      envSchema: aggregateSchema(pipeline.nodes, 'env') as EnvVarDefinition[],
      paramSchema: aggregateSchema(pipeline.nodes, 'params') as ParamDefinition[]
    }
  }

  setValues(id: string, envId: string, values: { config?: Record<string, string>; params?: Record<string, string> }): PipelineMeta {
    const current = this.get(id)
    if (!current) throw new Error('流水线不存在')
    const configByEnv = { ...(current.configByEnv ?? {}) }
    const paramsByEnv = { ...(current.paramsByEnv ?? {}) }
    if (values.config) configByEnv[envId] = { ...(configByEnv[envId] ?? {}), ...values.config }
    if (values.params) paramsByEnv[envId] = { ...(paramsByEnv[envId] ?? {}), ...values.params }
    return this.repositories.pipelines.update(id, { configByEnv, paramsByEnv })!
  }

  private normalizeNodes(nodes: PipelineNode[]): PipelineNode[] {
    return nodes.map((node, index) => ({ ...node, id: node.id || randomUUID(), order: index }))
  }

  private validateNodes(nodes: PipelineNode[]): void {
    if (!nodes.length) throw new Error('流水线至少需要一个脚本节点')
    for (const node of nodes) {
      if (!scriptRegistry.getById(node.scriptId)) throw new Error(`节点引用的脚本不存在: ${node.scriptId}`)
      const script = scriptRegistry.getById(node.scriptId)!
      const keys = new Set(script.paramSchema.map((field) => field.key))
      for (const mapping of node.inputMappings ?? []) {
        if (!keys.has(mapping.targetParam)) throw new Error(`节点 ${node.name} 的目标参数不存在: ${mapping.targetParam}`)
        if (mapping.sourcePath && !/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+|\.\d+)*$/.test(mapping.sourcePath)) {
          throw new Error(`节点 ${node.name} 的映射路径格式不合法`)
        }
      }
    }
  }
}

export const pipelineStore = new PipelineStore()
