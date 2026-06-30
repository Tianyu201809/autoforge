import type { SqliteDatabase } from '../database'
import { CategoryRepository } from './category-repository'
import { ConfigRepository } from './config-repository'
import { EnvironmentRepository } from './environment-repository'
import { ExecutionRepository } from './execution-repository'
import { ScriptRepository } from './script-repository'

export interface Repositories {
  scripts: ScriptRepository
  environments: EnvironmentRepository
  categories: CategoryRepository
  config: ConfigRepository
  execution: ExecutionRepository
}

export function createRepositories(db: SqliteDatabase): Repositories {
  return {
    scripts: new ScriptRepository(db),
    environments: new EnvironmentRepository(db),
    categories: new CategoryRepository(db),
    config: new ConfigRepository(db),
    execution: new ExecutionRepository(db)
  }
}
