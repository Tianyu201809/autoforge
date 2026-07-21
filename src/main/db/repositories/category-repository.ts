import type { SqliteDatabase } from '../database'
import type { CategoryOverride, StoredCategory } from '../../services/category-service'
import { rowToCategoryOverride, rowToStoredCategory } from '../row-mappers'

export class CategoryRepository {
  constructor(private db: SqliteDatabase) {}

  listCategories(): StoredCategory[] {
    const rows = this.db.prepare('SELECT * FROM categories ORDER BY label ASC').all()
    return rows.map((row) =>
      rowToStoredCategory(
        row as {
          id: string
          key: string
          label: string
          color_preset: string
          parent_id?: string | null
        }
      )
    )
  }

  listOverrides(): CategoryOverride[] {
    const rows = this.db.prepare('SELECT * FROM category_overrides').all()
    return rows.map((row) =>
      rowToCategoryOverride(row as { key: string; label: string | null; color_preset: string | null })
    )
  }

  insertCategory(category: StoredCategory): void {
    this.db
      .prepare(
        'INSERT INTO categories (id, key, label, color_preset, parent_id) VALUES (@id, @key, @label, @color_preset, @parent_id)'
      )
      .run({
        id: category.id,
        key: category.key,
        label: category.label,
        color_preset: category.colorPreset,
        parent_id: category.parentId ?? null
      })
  }

  updateCategory(
    id: string,
    patch: { label?: string; colorPreset?: string; parentId?: string | null }
  ): StoredCategory | null {
    const row = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
      | { id: string; key: string; label: string; color_preset: string; parent_id?: string | null }
      | undefined
    if (!row) return null

    const next: StoredCategory = {
      id: row.id,
      key: row.key,
      label: patch.label?.trim() || row.label,
      colorPreset: patch.colorPreset ?? row.color_preset,
      parentId: patch.parentId !== undefined ? patch.parentId : (row.parent_id ?? null)
    }
    this.db
      .prepare(
        'UPDATE categories SET label = @label, color_preset = @color_preset, parent_id = @parent_id WHERE id = @id'
      )
      .run({
        id: next.id,
        label: next.label,
        color_preset: next.colorPreset,
        parent_id: next.parentId
      })
    return next
  }

  listChildren(parentId: string): StoredCategory[] {
    const rows = this.db
      .prepare('SELECT * FROM categories WHERE parent_id = ? ORDER BY label ASC')
      .all(parentId)
    return rows.map((row) =>
      rowToStoredCategory(
        row as {
          id: string
          key: string
          label: string
          color_preset: string
          parent_id?: string | null
        }
      )
    )
  }

  deleteCategory(id: string): StoredCategory | null {
    const row = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
      | { id: string; key: string; label: string; color_preset: string; parent_id?: string | null }
      | undefined
    if (!row) return null
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id)
    return rowToStoredCategory(row)
  }

  upsertOverride(override: CategoryOverride): void {
    this.db
      .prepare(
        `INSERT INTO category_overrides (key, label, color_preset) VALUES (@key, @label, @color_preset)
         ON CONFLICT(key) DO UPDATE SET label = excluded.label, color_preset = excluded.color_preset`
      )
      .run({
        key: override.key,
        label: override.label ?? null,
        color_preset: override.colorPreset ?? null
      })
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM categories').run()
    this.db.prepare('DELETE FROM category_overrides').run()
  }
}
