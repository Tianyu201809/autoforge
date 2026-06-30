import type { SqliteDatabase } from '../database'
import type { EnvironmentProfile } from '../../../shared/types/script'
import { environmentToRow, rowToEnvironment } from '../row-mappers'

export class EnvironmentRepository {
  constructor(private db: SqliteDatabase) {}

  listAll(): EnvironmentProfile[] {
    const rows = this.db.prepare('SELECT * FROM environments ORDER BY is_default DESC, name ASC').all()
    return rows.map((row) => rowToEnvironment(row as Parameters<typeof rowToEnvironment>[0]))
  }

  getById(id: string): EnvironmentProfile | undefined {
    const row = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(id)
    return row ? rowToEnvironment(row as Parameters<typeof rowToEnvironment>[0]) : undefined
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
    const row = environmentToRow(env)
    this.db
      .prepare(
        'INSERT INTO environments (id, name, description, variables, is_default) VALUES (@id, @name, @description, @variables, @is_default)'
      )
      .run(row)
  }

  update(id: string, patch: Partial<EnvironmentProfile>): EnvironmentProfile | null {
    const current = this.getById(id)
    if (!current) return null

    if (patch.isDefault) {
      this.db.prepare('UPDATE environments SET is_default = 0').run()
    }

    const next = { ...current, ...patch }
    const row = environmentToRow(next)
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
}
