import type { SqliteDatabase } from '../database'
import type { EnvCipher } from '../environment-secrets'
import { CategoryRepository } from './category-repository'
import { ConfigRepository } from './config-repository'
import { EnvironmentRepository } from './environment-repository'
import { ExecutionRepository } from './execution-repository'
import { ExecutableTrustRepository } from './executable-trust-repository'
import { ScriptRepository } from './script-repository'
import { AiWorkspaceRepository } from './ai-workspace-repository'

export interface Repositories {
  scripts: ScriptRepository
  environments: EnvironmentRepository
  categories: CategoryRepository
  config: ConfigRepository
  execution: ExecutionRepository
  executableTrust: ExecutableTrustRepository
  aiWorkspace: AiWorkspaceRepository
}

export function createRepositories(db: SqliteDatabase, cipher: EnvCipher): Repositories {
  return {
    scripts: new ScriptRepository(db),
    environments: new EnvironmentRepository(db, cipher),
    categories: new CategoryRepository(db),
    config: new ConfigRepository(db),
    execution: new ExecutionRepository(db),
    executableTrust: new ExecutableTrustRepository(db),
    aiWorkspace: new AiWorkspaceRepository(db)
  }
}
