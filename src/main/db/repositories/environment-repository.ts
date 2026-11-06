import type { SqliteDatabase } from '../database'
import type { EnvironmentProfile } from '../../../shared/types/script'
import { openVariables, sealVariables, type EnvCipher } from '../environment-secrets'
import { environmentToRow, rowToEnvironment, type EnvironmentRow } from '../row-mappers'

type StoredVariables = {
  variables: Record<string, string>
  variablesReadable: boolean
  needsMigration: boolean
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === 'string')
}

export class EnvironmentRepository {
  constructor(
    private db: SqliteDatabase,
    private cipher: EnvCipher
  ) {}

  listAll(): EnvironmentProfile[] {
    const rows = this.db.prepare('SELECT * FROM environments ORDER BY is_default DESC, name ASC').all()
    return rows.map((row) => this.toProfile(row as EnvironmentRow))
  }

  getById(id: string): EnvironmentProfile | undefined {
    const row = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(id)
    return row ? this.toProfile(row as EnvironmentRow) : undefined
  }

  getDefault(): EnvironmentProfile {
    const envs = this.listAll()
    return (
      envs.find((e) => e.isDefault) ?? envs[0] ?? {
        id: 'default',
        name: '默认环境',
        description: '未指定时的默认环境变量集',
        variables: {},
        isDefault: true
      }
    )
  }

  insert(env: EnvironmentProfile): void {
    const row = environmentToRow(env, sealVariables(env.variables ?? {}, this.cipher))
    this.db
      .prepare(
        'INSERT INTO environments (id, name, description, variables, is_default) VALUES (@id, @name, @description, @variables, @is_default)'
      )
      .run(row)
  }

  update(id: string, patch: Partial<EnvironmentProfile>): EnvironmentProfile | null {
    const current = this.getById(id)
    if (!current) return null
    if (current.variablesReadable === false) return null

    if (patch.isDefault) {
      this.db.prepare('UPDATE environments SET is_default = 0').run()
    }

    const next = { ...current, ...patch }
    const row = environmentToRow(next, sealVariables(next.variables ?? {}, this.cipher))
    this.db
      .prepare(
        'UPDATE environments SET name = @name, description = @description, variables = @variables, is_default = @is_default WHERE id = @id'
      )
      .run(row)
    return next
  }

  delete(id: string): boolean {
    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM environments').get() as { count: number }).count
    if (count <= 1) return false

    const target = this.getById(id)
    if (!target) return false

    this.db.prepare('DELETE FROM environments WHERE id = ?').run(id)

    if (target.isDefault) {
      const first = this.db.prepare('SELECT id FROM environments LIMIT 1').get() as { id: string } | undefined
      if (first) {
        this.db.prepare('UPDATE environments SET is_default = 1 WHERE id = ?').run(first.id)
      }
    }
    return true
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM environments').run()
  }

  migratePlaintext(): void {
    const rows = this.db.prepare('SELECT id, variables FROM environments').all() as { id: string; variables: unknown }[]
    const update = this.db.prepare('UPDATE environments SET variables = ? WHERE id = ?')
    for (const row of rows) {
      const opened = this.openStored(row.variables)
      if (!opened.needsMigration) continue
      update.run(sealVariables(opened.variables, this.cipher), row.id)
    }
  }

  private toProfile(row: EnvironmentRow): EnvironmentProfile {
    const opened = this.openStored(row.variables)
    return rowToEnvironment(row, opened.variables, opened.variablesReadable)
  }

  private openStored(stored: unknown): StoredVariables {
    const text = typeof stored === 'string' ? stored : ''
    const opened = openVariables(text, this.cipher)
    if (!opened.readable || !isStringMap(opened.variables)) {
      return { variables: {}, variablesReadable: false, needsMigration: false }
    }
    return {
      variables: opened.variables,
      variablesReadable: true,
      needsMigration: opened.needsMigration
    }
  }
}
