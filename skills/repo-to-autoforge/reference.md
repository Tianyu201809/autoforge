# 仓库转换速查

`autoforge.json` 字段的完整说明以 `docs/script-spec.md` 为准；`env` / `params` 的类型速查见 `skills/autoforge-script-create/reference.md`。本文件只覆盖「从既有仓库转换」相关的内容。

## 转换工作区布局

```
<userData>/repo-workspaces/<taskId>/
├── repo/                       # 原始仓库（只读参考，不要写入产物）
└── .autoforge/
    ├── profile.json            # 仓库画像（结构化）
    ├── HANDOFF.md              # 完整交接说明
    └── package/                # 产物目录 —— 脚本包写在这里
        ├── autoforge.json
        ├── index.mjs | index.py
        └── vendor/             # 复制进来的仓库源码（按需）
```

`<userData>` 在 Windows 上为 `%APPDATA%/autoforge-development/`（开发模式）或 `autoforge-production/`（安装包）。

## 画像字段含义

| 字段 | 含义 | 你怎么用 |
|------|------|----------|
| `convertibility` | 启发式可转换性级别 | **必须自己复核**，不要盲信 |
| `convertibilityReason` | 判定理由 | 用于向用户解释 |
| `fetchMethod` | `archive`（GitHub 归档 zip）、`git`（浅克隆）或 `local`（本机目录） | 决定 `repo/` 里有没有 `.git` |
| `commitSha` | 仓库快照 commit；归档方式通常为 `null` | 引用来源时用 |
| `languages` | 按字节排序的语言分布 | 决定选 Python 还是 JavaScript |
| `entryCandidates` | 疑似入口文件 | 适配入口的调用目标 |
| `runtimeDependencies` | 运行期依赖名（npm + pip 合并） | 筛选后写入 `dependencies` |
| `manifests` | 依赖清单文件 | 进一步确认依赖来源 |
| `hasBuildScript` | 是否需要构建 | 为 true 时重点找已提交的构建产物 |
| `hasWebServer` | 是否识别到 Express / Django / FastAPI 一类服务端依赖 | 为 true 时先看能否收成一次任务或本地静态服务；整站依赖外部基础设施才判 `unsupported` |
| `hasMonorepo` | 是否 monorepo | 需要先确定目标子包 |
| `hasNativeBinary` | 是否含原生二进制 | 跨平台不可移植 |
| `license` | 许可证 | 无许可证要提醒用户 |
| `risks` | 风险列表 | 原样向用户转达 |

## 可转换性判定规则

```
识别到必须依赖外部基础设施的 Web 服务 → unsupported
纯前端 / 单进程本地静态服务           → 可按 run(ctx) 常驻转换
无 JS/Python 源码 且 有原生二进制     → unsupported
无 JS/Python 源码                    → unsupported
monorepo / workspace                 → needs-build
需要构建（TS / 打包器）              → needs-build
无入口候选                           → wrappable
文件 ≤12 且 依赖 ≤3                  → direct
其余                                 → wrappable
```

## 语言选择决策

| 仓库特征 | language | entry | dependencies 体系 |
|----------|----------|-------|-------------------|
| 有 `.py` 且无 `.ts/.js` 主体 | `python` | `index.py` | pip 包名 → specifier |
| 有 `.js/.mjs` 主体 | `javascript` | `index.mjs` | npm 包名 → 版本 |
| 有 `.ts` 但已提交编译产物 | `javascript` | 指向编译后的 `.js` | npm 包名 → 版本 |
| 有 `.ts` 且无编译产物 | — | — | 判 `needs-build`，不产出包 |
| 仓库自带当前平台可执行文件 | `executable` | 可执行文件相对路径 | **不可声明** `dependencies` |

## 常见仓库形态的适配入口

### CLI 工具（推荐模式）

```javascript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)

export async function run(ctx) {
  const { stdout } = await run('node', ['vendor/cli.js', '--json'], {
    cwd: ctx.sdk.paths.scriptDir,
    maxBuffer: 32 * 1024 * 1024
  })
  return { ok: true, output: stdout.trim() }
}
```

Python CLI：

```python
import asyncio, json, sys
from pathlib import Path

async def run(ctx):
    script = Path(ctx.sdk.paths.script_dir) / "vendor" / "cli.py"
    proc = await asyncio.create_subprocess_exec(
        sys.executable, str(script), "--json",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(ctx.sdk.paths.script_dir),
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(err.decode("utf-8", "replace"))
    return {"ok": True, "output": out.decode("utf-8", "replace").strip()}
```

### 库 / 无 CLI（谨慎使用）

只有确认该库有**稳定的公开 API** 时才用 `import` 模式；内部函数随时可能变。

```javascript
export async function run(ctx) {
  const mod = await import(new URL('./vendor/index.js', import.meta.url).href)
  const fn = mod.convert ?? mod.default?.convert
  if (typeof fn !== 'function') throw new Error('vendor 未导出可用的 convert 函数')
  return { ok: true, result: await fn({ input: ctx.params.INPUT }) }
}
```

## 路径解析注意

复制进 `vendor/` 的代码可能保留了对原仓库结构的路径假设。逐项检查：

| 原代码写法 | 问题 | 修法 |
|------------|------|------|
| `__dirname` / `__filename` | CJS 变量，在 `.mjs` 中不存在 | 改用 `new URL('.', import.meta.url)` |
| `path.join(__dirname, '../data')` | 指向仓库旧结构 | 改为基于 `ctx.sdk.paths.scriptDir` |
| `sys.path.append('..')` | Python 相对导入 | 改为 `Path(ctx.sdk.paths.script_dir)` |
| 硬编码绝对路径 | 换机即失效 | 一律改为 `ctx.sdk.paths` 派生 |
| `process.cwd()` 假设 | Autoforge 的 cwd 是脚本目录 | 显式传 `cwd: ctx.sdk.paths.scriptDir` |

## 产物自检清单

- [ ] `autoforge.json` 合法 JSON，`autoforge` 为 `"1.0"`，`name` 非空
- [ ] `entry` 指向包目录内真实文件
- [ ] 入口导出 `run(ctx)` / `main(ctx)` / `default`
- [ ] 包目录内无 `.git` / `node_modules` / `.venv`
- [ ] `dependencies` 只含运行期依赖，无 `devDependencies`
- [ ] 无硬编码绝对路径
- [ ] 有产物输出时返回值含 `outputDir`
- [ ] 已试运行验证
