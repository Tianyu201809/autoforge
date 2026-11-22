# sql.js 原子落盘 Implementation Plan

> **状态：已完成**（实现已合入 `feature/v1.42.0`，桌面端单测通过）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** sql.js 的写盘改为短防抖，并用临时文件替换 `autoforge.db`，避免写到一半损坏原库。

**Architecture:** 调度和替换是两个纯函数。`SqlJsAdapter` 在事务外只标记脏数据；事务提交、迁移结束和 `close()` 立即刷盘。

**Tech Stack:** 现有 sql.js 适配器、Node `fs`、`node:test`。

## Global Constraints

- 继续使用 sql.js，不引入 `node:sqlite` 或 `better-sqlite3`。
- 事务外的 `run` / `exec`：最后一次变脏后再等 300ms；同一批从第一次变脏起最晚 1000ms 必须刷盘。
- `transaction()` 在 `COMMIT` 成功后立即落盘，并取消等待中的防抖。
- 迁移和启动初始化结束后立即落盘。
- `close()` 取消定时器并同步刷盘。
- 字节写入同目录 `autoforge.db.tmp`，`fsync` 后替换 `autoforge.db`。替换完成前不删除、不截断原文件。
- 启动时删除残留的 `autoforge.db.tmp`，不用它打开数据库。
- 查询和只读 `PRAGMA` 不落盘。

---

### Task 1: 临时文件替换

**Files:**
- Create: `src/main/db/sqlite-persist.ts`
- Test: `src/main/db/sqlite-persist.test.ts`
- Modify: `package.json` 的 `test:unit`

**Interfaces:**
- Consumes: 无
- Produces: `replaceFileAtomically(targetPath: string, bytes: Uint8Array): void`、`removeStaleTemp(targetPath: string): void`

- [x] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test } from 'node:test'
import { removeStaleTemp, replaceFileAtomically } from './sqlite-persist'

test('replaces the target only after the temp file is synced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-replace-'))
  const target = join(dir, 'autoforge.db')
  writeFileSync(target, 'old')
  replaceFileAtomically(target, Buffer.from('new'))
  assert.equal(readFileSync(target, 'utf8'), 'new')
  assert.equal(existsSync(`${target}.tmp`), false)
})

test('removes a leftover temp file and leaves the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-tmp-'))
  const target = join(dir, 'autoforge.db')
  writeFileSync(target, 'keep')
  writeFileSync(`${target}.tmp`, 'partial')
  removeStaleTemp(target)
  assert.equal(readFileSync(target, 'utf8'), 'keep')
  assert.equal(existsSync(`${target}.tmp`), false)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/db/sqlite-persist.test.ts`

Expected: FAIL。

- [x] **Step 3: Write minimal implementation**

```ts
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'fs'

export function replaceFileAtomically(targetPath: string, bytes: Uint8Array): void {
  const tmpPath = `${targetPath}.tmp`
  const fd = openSync(tmpPath, 'w')
  try {
    writeSync(fd, Buffer.from(bytes))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmpPath, targetPath)
}

export function removeStaleTemp(targetPath: string): void {
  rmSync(`${targetPath}.tmp`, { force: true })
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/db/sqlite-persist.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/db/sqlite-persist.ts src/main/db/sqlite-persist.test.ts package.json
git commit -m "fix: 用临时文件替换 SQLite 库文件"
```

### Task 2: 300ms 防抖和 1000ms 上限

**Files:**
- Modify: `src/main/db/sqlite-persist.ts`
- Modify: `src/main/db/sqlite-persist.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `createDirtyScheduler(options: { now: () => number; schedule: (fn: () => void, ms: number) => { cancel: () => void }; flush: () => void; debounceMs?: number; maxWaitMs?: number }): { markDirty: () => void; flushNow: () => void }`

- [x] **Step 1: Write the failing test**

```ts
test('waits 300ms after the last write and flushes by 1000ms', () => {
  let now = 0
  const due: { at: number; fn: () => void }[] = []
  let flushed = 0
  const scheduler = createDirtyScheduler({
    now: () => now,
    schedule: (fn, ms) => {
      const at = now + ms
      due.push({ at, fn })
      return { cancel() { const i = due.findIndex((item) => item.fn === fn); if (i >= 0) due.splice(i, 1) } }
    },
    flush: () => { flushed += 1 }
  })
  scheduler.markDirty()
  now = 200
  scheduler.markDirty()
  assert.equal(due.at(-1)?.at, 500)
  now = 900
  scheduler.markDirty()
  assert.equal(due.at(-1)?.at, 1000)
  due.at(-1)?.fn()
  assert.equal(flushed, 1)
})

test('flushNow cancels the timer and writes immediately', () => {
  let flushed = 0
  let cancelled = false
  const scheduler = createDirtyScheduler({
    now: () => 0,
    schedule: () => ({ cancel() { cancelled = true } }),
    flush: () => { flushed += 1 }
  })
  scheduler.markDirty()
  scheduler.flushNow()
  assert.equal(cancelled, true)
  assert.equal(flushed, 1)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/db/sqlite-persist.test.ts`

Expected: FAIL，`createDirtyScheduler` 不存在。

- [x] **Step 3: Write minimal implementation**

```ts
export function createDirtyScheduler(options: {
  now: () => number
  schedule: (fn: () => void, ms: number) => { cancel: () => void }
  flush: () => void
  debounceMs?: number
  maxWaitMs?: number
}): { markDirty: () => void; flushNow: () => void } {
  const debounceMs = options.debounceMs ?? 300
  const maxWaitMs = options.maxWaitMs ?? 1000
  let timer: { cancel: () => void } | null = null
  let firstDirtyAt: number | null = null
  const clear = () => {
    timer?.cancel()
    timer = null
    firstDirtyAt = null
  }
  return {
    markDirty() {
      const now = options.now()
      if (firstDirtyAt === null) firstDirtyAt = now
      timer?.cancel()
      const wait = Math.max(0, Math.min(debounceMs, firstDirtyAt + maxWaitMs - now))
      timer = options.schedule(() => {
        timer = null
        firstDirtyAt = null
        options.flush()
      }, wait)
    },
    flushNow() {
      clear()
      options.flush()
    }
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/db/sqlite-persist.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/db/sqlite-persist.ts src/main/db/sqlite-persist.test.ts
git commit -m "fix: 合并短时间内的 SQLite 全库导出"
```

### Task 3: 适配器接入防抖和立即刷盘

**Files:**
- Modify: `src/main/db/sqlite-adapter.ts`
- Modify: `src/main/db/database.ts` 的 `openAndMigrate`，在 `runMigrations` 和 `migrateFromJsonIfNeeded` 之后调用 `database.flush()`

**Interfaces:**
- Consumes: `replaceFileAtomically`、`removeStaleTemp`、`createDirtyScheduler`
- Produces: `SqliteDatabase.flush(): void`。`close()` 内部调用它。

- [x] **Step 1: Write the failing test**

在 `sqlite-persist.test.ts` 不重复测适配器的 sql.js。给 `SqliteDatabase` 增加 `flush` 后，新增 `src/main/db/sqlite-adapter.test.ts`：打开临时库，执行一条 `run`，在 300ms 内断言目标文件仍是打开时的字节或尚不存在新写入；调用 `flush()` 后文件内容变化且没有 `.tmp`。只读 `get` 之后文件 mtime 不变。

用假时钟不可行，因为适配器内部要用真实 `setTimeout`。测试只断言 `flush()` 立即落盘，以及 `openSqliteDatabase` 会删掉预先放好的 `.tmp`。防抖时间由 Task 2 覆盖。

```ts
test('open removes a stale temp and flush writes the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-'))
  const dbPath = join(dir, 'autoforge.db')
  writeFileSync(`${dbPath}.tmp`, 'partial')
  const db = await openSqliteDatabase(dbPath)
  assert.equal(existsSync(`${dbPath}.tmp`), false)
  db.exec('CREATE TABLE t (id INTEGER)')
  db.flush()
  assert.equal(existsSync(dbPath), true)
  assert.equal(existsSync(`${dbPath}.tmp`), false)
  db.close()
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/db/sqlite-adapter.test.ts`

Expected: FAIL，`flush` 不是函数，或 `.tmp` 仍在。

- [x] **Step 3: Write minimal implementation**

`openSqliteDatabase` 在 `readFileSync` 之前调用 `removeStaleTemp(dbPath)`。`SqlJsAdapter.persist` 改为 `replaceFileAtomically(this.dbPath, this.db.export())`。`markDirty` 在事务中只设 `dirty`；事务外调用 `scheduler.markDirty()`。`transaction` 的外层 `COMMIT` 成功后调用 `this.flush()`。`close` 调用 `this.flush()` 再 `this.db.close()`。`flush` 就是 `scheduler.flushNow()`，但若当前不脏则不要 `export`。用一个 `dirty` 标志：`flushNow` 前由适配器包一层，只有 `dirty` 时才 `persist` 并清掉 `dirty`。

`SqliteDatabase` 接口增加 `flush(): void`。`database.ts` 的 `openAndMigrate` 在两次迁移函数返回后调用 `database.flush()`。

查询和 `pragma` 的读路径保持不调用 `markDirty`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/db/sqlite-adapter.test.ts src/main/db/sqlite-persist.test.ts`

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main/db/sqlite-adapter.ts src/main/db/sqlite-adapter.test.ts src/main/db/database.ts
git commit -m "fix: SQLite 写入改为防抖并在退出时刷盘"
```
