import initSqlJs, { type Database as SqlJsDatabase, type Statement as SqlJsStatement } from 'sql.js'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname } from 'path'
import { createRequire } from 'module'
import { createDirtyScheduler, removeStaleTemp, replaceFileAtomically } from './sqlite-persist'

export interface RunResult {
  changes: number
}

export interface SqliteStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
  run(...params: unknown[]): RunResult
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  pragma(source: string, value?: string | number | boolean): unknown
  transaction<F extends (...args: never[]) => unknown>(fn: F): F
  flush(): void
  close(): void
}

/** 解析 sql.js wasm 文件路径（开发 / 打包均可用） */
function resolveWasmPath(): string {
  const require = createRequire(__filename)
  return require.resolve('sql.js/dist/sql-wasm.wasm')
}

function bindParams(stmt: SqlJsStatement, params: unknown[]): void {
  if (params.length === 0) return

  const first = params[0]
  if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
    const bound: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(first as Record<string, unknown>)) {
      const paramKey =
        key.startsWith('@') || key.startsWith(':') || key.startsWith('$') ? key : `@${key}`
      bound[paramKey] = value ?? null
    }
    stmt.bind(bound)
    return
  }

  stmt.bind(params as (string | number | null | Uint8Array)[])
}

class SqlJsAdapter implements SqliteDatabase {
  private inTransaction = false
  private dirty = false
  private nextSavepoint = 0
  private readonly scheduler: { markDirty: () => void; flushNow: () => void }

  constructor(
    private sql: initSqlJs.SqlJsStatic,
    private db: SqlJsDatabase,
    private dbPath: string
  ) {
    this.scheduler = createDirtyScheduler({
      now: () => Date.now(),
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms)
        return { cancel: () => clearTimeout(timer) }
      },
      flush: () => {
        if (!this.dirty) return
        this.persist()
        this.dirty = false
      }
    })
  }

  prepare(sql: string): SqliteStatement {
    const db = this.db
    const markDirty = () => this.markDirty()

    return {
      get: (...params: unknown[]) => {
        const stmt = db.prepare(sql)
        try {
          bindParams(stmt, params)
          if (stmt.step()) return stmt.getAsObject() as Record<string, unknown>
          return undefined
        } finally {
          stmt.free()
        }
      },
      all: (...params: unknown[]) => {
        const stmt = db.prepare(sql)
        const rows: Record<string, unknown>[] = []
        try {
          bindParams(stmt, params)
          while (stmt.step()) {
            rows.push(stmt.getAsObject() as Record<string, unknown>)
          }
          return rows
        } finally {
          stmt.free()
        }
      },
      run: (...params: unknown[]) => {
        const stmt = db.prepare(sql)
        try {
          bindParams(stmt, params)
          stmt.step()
          markDirty()
          return { changes: db.getRowsModified() }
        } finally {
          stmt.free()
        }
      }
    }
  }

  exec(sql: string): void {
    this.db.exec(sql)
    this.markDirty()
  }

  pragma(source: string, value?: string | number | boolean): unknown {
    if (value === undefined) {
      const stmt = this.db.prepare(`PRAGMA ${source}`)
      try {
        if (stmt.step()) {
          const row = stmt.getAsObject() as Record<string, unknown>
          return Object.values(row)[0]
        }
        return undefined
      } finally {
        stmt.free()
      }
    }
    this.db.exec(`PRAGMA ${source} = ${JSON.stringify(value)}`)
    return undefined
  }

  transaction<F extends (...args: never[]) => unknown>(fn: F): F {
    const adapter = this
    const wrapped = ((...args: Parameters<F>) => {
      const outer = !adapter.inTransaction
      let savepoint: string | null = null
      let committed = false

      if (outer) {
        adapter.inTransaction = true
        adapter.db.exec('BEGIN IMMEDIATE')
      } else {
        savepoint = `sp_${++adapter.nextSavepoint}`
        adapter.db.exec(`SAVEPOINT ${savepoint}`)
      }

      try {
        const result = fn(...args)
        if (outer) {
          adapter.db.exec('COMMIT')
          committed = true
          adapter.flush()
        } else if (savepoint) {
          adapter.db.exec(`RELEASE SAVEPOINT ${savepoint}`)
        }
        return result
      } catch (err) {
        if (outer) {
          if (!committed) adapter.db.exec('ROLLBACK')
        } else if (savepoint) {
          adapter.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          adapter.db.exec(`RELEASE SAVEPOINT ${savepoint}`)
        }
        throw err
      } finally {
        if (outer) {
          adapter.inTransaction = false
        }
      }
    }) as F
    return wrapped
  }

  flush(): void {
    this.scheduler.flushNow()
  }

  close(): void {
    this.flush()
    this.db.close()
  }

  private markDirty(): void {
    this.dirty = true
    if (this.inTransaction) return
    this.scheduler.markDirty()
  }

  private persist(): void {
    replaceFileAtomically(this.dbPath, this.db.export())
  }
}

/** 打开或创建基于 sql.js 的 SQLite 数据库（无需 native 编译） */
export async function openSqliteDatabase(dbPath: string): Promise<SqliteDatabase> {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  removeStaleTemp(dbPath)

  const wasmPath = resolveWasmPath()
  const SQL = await initSqlJs({ locateFile: () => wasmPath })

  let db: SqlJsDatabase
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  const adapter = new SqlJsAdapter(SQL, db, dbPath)
  adapter.pragma('foreign_keys = ON')
  return adapter
}
