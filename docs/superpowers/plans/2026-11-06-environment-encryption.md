# 环境变量加密 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `environments.variables` 在系统加密可用时以 `enc:v1:` 密文入库，已有明文自动迁移，解密失败时不覆盖原值。

**Architecture:** 加解密是注入 `EnvCipher` 的纯函数。仓库读写都经过它。`safeStorage` 只出现在主进程的默认 cipher 里。界面根据 `variablesReadable` 和加密是否可用决定提示。

**Tech Stack:** Electron `safeStorage`、现有环境仓库、Vue 设置页、`node:test`。

## Global Constraints

- 只加密 `variables`。名称和描述保持明文。`secret` 仍只是界面掩码。
- 密文格式是 `enc:v1:` 加 Base64。
- 交给界面和脚本的仍是 `Record<string, string>`。
- 明文是以 `{` 开头的 JSON。加密可用时，数据库打开并完成迁移后逐条写回。
- 解密失败不更新该行，不把变量显示成空对象。返回 `variablesReadable: false`，该字段不入库。设置里保存不可用，仓库拒绝保存。
- `safeStorage` 不可用时继续明文读写。设置里环境变量区域显示：`当前未能加密，变量以明文留在本机数据库`。
- 不把密文做成可在另一台机器解开的格式。

---

### Task 1: 变量密文的封存和打开

**Files:**
- Create: `src/main/db/environment-secrets.ts`
- Test: `src/main/db/environment-secrets.test.ts`
- Modify: `package.json` 的 `test:unit`

**Interfaces:**
- Consumes: 无
- Produces:
  - `EnvCipher = { isAvailable: () => boolean; encrypt: (value: string) => Buffer; decrypt: (value: Buffer) => string }`
  - `sealVariables(variables: Record<string, string>, cipher: EnvCipher): string`
  - `openVariables(stored: string, cipher: EnvCipher): { variables: Record<string, string>; readable: boolean; needsMigration: boolean }`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openVariables, sealVariables, type EnvCipher } from './environment-secrets'

function cipher(): EnvCipher {
  return {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(value, 'utf8'),
    decrypt: (value) => value.toString('utf8')
  }
}

test('seals variables and migrates plaintext json', () => {
  const sealed = sealVariables({ TOKEN: 'secret' }, cipher())
  assert.equal(sealed.startsWith('enc:v1:'), true)
  assert.deepEqual(openVariables(sealed, cipher()), {
    variables: { TOKEN: 'secret' },
    readable: true,
    needsMigration: false
  })
  assert.deepEqual(openVariables('{"TOKEN":"secret"}', cipher()), {
    variables: { TOKEN: 'secret' },
    readable: true,
    needsMigration: true
  })
})

test('keeps plaintext when encryption is unavailable and refuses a broken ciphertext', () => {
  const off: EnvCipher = { isAvailable: () => false, encrypt: () => Buffer.from(''), decrypt: () => { throw new Error('bad') } }
  assert.equal(sealVariables({ A: '1' }, off), '{"A":"1"}')
  const broken = cipher()
  broken.decrypt = () => { throw new Error('bad') }
  assert.deepEqual(openVariables('enc:v1:aaaa', broken), {
    variables: {},
    readable: false,
    needsMigration: false
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/db/environment-secrets.test.ts`

Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

`sealVariables` 在 `isAvailable()` 为假时 `JSON.stringify(variables ?? {})`。可用时返回 ``enc:v1:${cipher.encrypt(json).toString('base64')}``。

`openVariables`：以前缀 `enc:v1:` 开头则解密并 `JSON.parse`。解密或解析抛错时返回 `{ variables: {}, readable: false, needsMigration: false }`。以 `{` 开头则解析 JSON，`needsMigration` 等于 `cipher.isAvailable()`。其他文本同样视为不可读。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/db/environment-secrets.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/db/environment-secrets.ts src/main/db/environment-secrets.test.ts package.json
git commit -m "feat: 封存环境变量 JSON"
```

### Task 2: 仓库读写密文并拒绝损坏行

**Files:**
- Modify: `src/shared/types/script.ts` 的 `EnvironmentProfile`，增加可选 `variablesReadable?: boolean`
- Modify: `src/main/db/repositories/environment-repository.ts`
- Modify: `src/main/db/row-mappers.ts` 的 `rowToEnvironment` / `environmentToRow`，改为接收已经打开或封存的变量文本，不在 mapper 里调用 `safeStorage`
- Test: `src/main/db/environment-repository.test.ts`
- Modify: `package.json` 的 `test:unit`

**Interfaces:**
- Consumes: `sealVariables`、`openVariables`、`EnvCipher`
- Produces: `new EnvironmentRepository(db, cipher)`。`update` 在当前行 `variablesReadable === false` 时返回 `null` 并且不执行 `UPDATE`。`migratePlaintext(): void` 把 `needsMigration` 的行写回密文。

- [ ] **Step 1: Write the failing test**

用项目里已有的 `openSqliteDatabase` 打开临时库，建 `environments` 表，插入 `variables = '{"TOKEN":"secret"}'`。cipher 使用 Task 1 的可逆 Buffer cipher。

```ts
test('migrates plaintext and refuses to save an unreadable row', async () => {
  const db = await openSqliteDatabase(join(dir, 'autoforge.db'))
  db.exec(`CREATE TABLE environments (id TEXT PRIMARY KEY, name TEXT, description TEXT, variables TEXT, is_default INTEGER)`)
  db.prepare('INSERT INTO environments (id, name, description, variables, is_default) VALUES (?, ?, ?, ?, ?)').run('e1', '默认', '', '{"TOKEN":"secret"}', 1)
  const repo = new EnvironmentRepository(db, cipher())
  repo.migratePlaintext()
  const stored = db.prepare('SELECT variables FROM environments WHERE id = ?').get('e1') as { variables: string }
  assert.equal(stored.variables.startsWith('enc:v1:'), true)
  assert.deepEqual(repo.getById('e1')?.variables, { TOKEN: 'secret' })

  db.prepare('UPDATE environments SET variables = ? WHERE id = ?').run('enc:v1:aaaa', 'e1')
  const broken = new EnvironmentRepository(db, failingCipher())
  assert.equal(broken.getById('e1')?.variablesReadable, false)
  assert.equal(broken.update('e1', { variables: { TOKEN: 'changed' } }), null)
  const after = db.prepare('SELECT variables FROM environments WHERE id = ?').get('e1') as { variables: string }
  assert.equal(after.variables, 'enc:v1:aaaa')
  db.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/main/db/environment-repository.test.ts`

Expected: FAIL，构造函数不接收 cipher。

- [ ] **Step 3: Write minimal implementation**

`EnvironmentRepository` 增加 `cipher: EnvCipher`。`insert` / `update` 用 `sealVariables` 生成 `variables` 文本再交给现有 SQL。`rowToEnvironment` 改为接受已经得到的 `variables` 对象和 `variablesReadable`。读路径调用 `openVariables`。`migratePlaintext` 列出全部行，对 `needsMigration` 的行执行 `UPDATE environments SET variables = ? WHERE id = ?`。`update` 先 `getById`，若 `variablesReadable === false` 则返回 `null`。

`script-store.ts` 创建仓库时传入默认 cipher：

```ts
{
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value)
}
```

`initDatabase` 在迁移之后调用 `repos.environments.migratePlaintext()`，再 `database.flush()`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/main/db/environment-repository.test.ts src/main/db/environment-secrets.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/script.ts src/main/db/repositories/environment-repository.ts src/main/db/row-mappers.ts src/main/db/environment-repository.test.ts src/main/services/script-store.ts src/main/db/database.ts
git commit -m "fix: 环境变量加密入库并拒绝覆盖损坏记录"
```

### Task 3: 设置页提示加密状态

**Files:**
- Modify: `src/main/services/script-store.ts`，增加 `environmentEncryptionAvailable(): boolean`
- Modify: `src/shared/ipc-channels.ts`，在 `ENV_LIST` 旁增加 `ENV_ENCRYPTION_AVAILABLE: 'env:encryption-available'`
- Modify: `src/main/ipc/handlers.ts:418`，保留 `IPC.ENV_LIST` 仍返回 `EnvironmentProfile[]`。下一行增加 `ipcMain.handle(IPC.ENV_ENCRYPTION_AVAILABLE, () => scriptStore.environmentEncryptionAvailable())`
- Modify: `src/preload/index.ts` 的 `env.list` 旁增加 `encryptionAvailable: (): Promise<boolean> => ipcRenderer.invoke(IPC.ENV_ENCRYPTION_AVAILABLE)`
- Modify: `src/renderer/src/components/SettingsPanel.vue`，环境变量标题下方显示状态。`DetailPanel.vue`、`BatchRunPanel.vue`、`RunResultModal.vue` 继续使用 `env.list()` 的数组，不改它们的返回类型。

**Interfaces:**
- Consumes: `EnvironmentProfile.variablesReadable`、`EnvCipher.isAvailable`
- Produces: 设置页在加密不可用时显示 `当前未能加密，变量以明文留在本机数据库`。`variablesReadable === false` 时隐藏变量列表，显示「此环境的变量无法读取」，保存按钮 `disabled`。

- [ ] **Step 1: Write the failing test**

渲染进程已有 `node --test` 组件测试。在 `src/renderer/src/components/SettingsPanel` 的环境区太重时，不要挂整页。把提示文案抽到 `src/renderer/src/lib/environment-encryption-status.ts`：

```ts
export function environmentEncryptionNotice(encryptionAvailable: boolean): string | null {
  return encryptionAvailable ? null : '当前未能加密，变量以明文留在本机数据库'
}

export function environmentReadable(env: { variablesReadable?: boolean }): boolean {
  return env.variablesReadable !== false
}
```

测试 `src/renderer/src/lib/environment-encryption-status.test.ts` 覆盖这两个函数。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/renderer/src/lib/environment-encryption-status.test.ts`

Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

实现上面两个函数。`SettingsPanel.vue` 在环境变量 `<label>` 下：

```vue
<p v-if="environmentEncryptionNotice(encryptionAvailable)" class="mt-1 text-[12px] text-amber-600">
  {{ environmentEncryptionNotice(encryptionAvailable) }}
</p>
<p v-if="editingEnv && !environmentReadable(editingEnv)" class="mt-2 text-[12px] text-rose-500">此环境的变量无法读取</p>
```

变量列表和保存按钮用 `environmentReadable(editingEnv)` 控制。`v-if="environmentReadable(editingEnv)"` 包住变量列表。保存按钮增加 `:disabled="!environmentReadable(editingEnv)"`。

IPC 侧把 `encryptionAvailable` 放进现有环境列表响应。渲染进程把它存到 `encryptionAvailable` ref。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/renderer/src/lib/environment-encryption-status.test.ts src/main/db/environment-repository.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/environment-encryption-status.ts src/renderer/src/lib/environment-encryption-status.test.ts src/renderer/src/components/SettingsPanel.vue src/main/services/script-store.ts src/main/ipc/handlers.ts package.json
git commit -m "fix: 设置页显示环境变量加密状态"
```
