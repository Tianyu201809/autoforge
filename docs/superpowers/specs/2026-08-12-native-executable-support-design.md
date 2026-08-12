# 原生可执行程序支持设计

## 背景

Autoforge 当前将脚本包定义为 `autoforge.json` 加 JavaScript 或 Python 入口。JavaScript 由 Electron 主进程动态导入，Python 由独立子进程执行，两者都要求入口实现 `run(ctx)` 契约。用户还需要直接导入并运行 Windows PE、macOS Mach-O 和 Linux ELF 程序，包括不含 `autoforge.json` 的普通目录或 ZIP 包。

原生程序不能实现 `run(ctx)`，因此需要独立的入口识别、参数传递、进程生命周期和安全授权契约，同时保持现有 `autoforge.json` 的字段结构以及 JavaScript/Python 行为不变。

## 目标

1. 将文件型 PE、Mach-O 和 ELF 程序作为 Autoforge 的一等运行类型。
2. 支持显式声明 `"language": "executable"`，也支持根据入口文件头自动推断。
3. 托管原生子进程直到退出，采集输出，并支持停止、超时和进程树终止。
4. 继续使用现有 `env`、`params`、Profile、实例槽、定时任务和执行历史。
5. 支持从无清单的单文件、目录、本地 ZIP 和 Hub ZIP 中发现原生入口并生成最小清单。
6. 首次运行和入口内容变化后要求用户基于 SHA-256 重新授权。
7. 保持现有 JavaScript/Python 导入、运行和 ZIP 导出行为。

## 非目标

- 不支持 macOS `.app` 应用包目录。
- 不在一个包中声明 Windows、macOS、Linux 多平台入口映射；每个包只有一个字符串 `entry`。
- 不解析或自动安装 DLL、动态库、系统运行库及其他原生依赖。
- 不为原生程序定义 stdout 控制协议、结构化结果或 `run(ctx)` 等价 API。
- 不支持从 Autoforge 导出原生程序 ZIP。
- 首期不在启动前判断 CPU 架构兼容性；架构不兼容由操作系统启动错误报告。

## 清单契约

`ScriptLanguage` 扩展为：

```ts
type ScriptLanguage = 'javascript' | 'python' | 'executable'
```

现有 `autoforge.json` 结构不变，只扩展 `language` 的允许值：

```json
{
  "autoforge": "1.0",
  "name": "本地工具",
  "version": "1.0.0",
  "entry": "bin/tool.exe",
  "language": "executable",
  "env": [],
  "params": []
}
```

- 显式声明 `executable` 时，导入与每次运行仍验证真实文件头。
- 未声明 `language` 时，工作区层先按 `.py` 推断 Python、按已有 JavaScript 扩展名推断 JavaScript；其他扩展名及无扩展名入口读取文件头，合法 PE、Mach-O、ELF 推断为 `executable`，仍无法识别时才沿用 JavaScript 默认值。
- `validateManifest` 继续作为纯 JSON 校验与规范化函数，只负责接受 `executable` 枚举并保留“语言未声明”的状态；依赖文件内容的最终推断与校验由工作区服务完成。写入数据库及自动生成清单前必须得到确定的语言类型。
- 显式语言与入口格式冲突时拒绝导入或运行。
- `executable` 清单不得声明 `dependencies`，避免暗示 Autoforge 会安装原生依赖。
- 单包只接受字符串 `entry`，不增加平台映射字段。

## 二进制识别

新增 `executable-inspector`，只读取识别所需的有限文件头，不按扩展名判断原生程序。输出至少包括格式、目标操作系统、是否可作为主程序候选，以及可用于界面展示的格式标签。

支持：

- Windows PE 主程序。
- macOS 常见 Mach-O 和通用二进制变体。
- Linux ELF 主程序。

候选发现排除：

- PE DLL。
- Mach-O 动态库。
- ELF 共享库。
- 符号链接。
- 目录、设备文件及其他非普通文件。
- `node_modules`、`.venv`、`.git`、缓存目录等已知无关目录。

识别器校验入口的目标系统必须等于当前 `process.platform`。CPU 架构只作为可选诊断信息，不作为首期启动前的阻断条件。

## 无清单包发现与导入

新增 `executable-package-discovery`，供单文件、本地目录、本地 ZIP 和 Hub ZIP 共用。发现顺序如下：

1. 按现有规则定位包根的 `autoforge.json`；存在时完全按清单处理，不猜测其他入口。
2. 不存在清单时，递归扫描普通文件并调用二进制识别器。
3. 只保留当前系统可运行的主程序候选。
4. 没有候选时拒绝导入。
5. 只有一个候选时自动选中。
6. 有多个候选时，本地交互导入显示单选列表；用户取消后不产生脚本记录或工作区残留。
7. Hub 安装属于非交互发现，多个候选时返回包含候选相对路径的明确错误，不自动猜测。

本地多候选列表展示相对路径、格式和文件大小。选定后先将源内容复制到新建的 Autoforge 工作区，再在工作区根写入清单，不修改用户原目录、原始可执行文件或 ZIP。

无清单目录直接以用户选择的目录为包根。无清单 ZIP 若解压根只有一个顶层目录，则以该目录为包根；否则以解压根为包根。候选的 `entry` 始终相对于这个确定的包根。已有清单 ZIP 继续按现有规则只接受根目录清单或唯一一层子目录中的清单。

自动生成的清单为：

```json
{
  "autoforge": "1.0",
  "name": "tool",
  "version": "1.0.0",
  "entry": "bin/tool.exe",
  "language": "executable",
  "env": [],
  "params": []
}
```

- `name` 取入口文件名并移除最后一个扩展名。
- `entry` 使用相对包根的规范化路径。
- `env` 和 `params` 均为空数组，不生成默认配置。
- 单独上传一个原生文件时，在新工作区根复制该文件并生成同样的最小清单。
- 本地 ZIP 和 Hub ZIP 继续应用现有路径穿越、条目数量、压缩包大小和解压体积限制。

## 模块边界

| 模块 | 职责 |
|------|------|
| `shared/script-language` | 增加 `executable` 类型及 `EXE` 徽标 |
| `shared/script-contract` | 接受并规范化 `language: executable`，拒绝原生依赖声明 |
| `executable-inspector` | 识别 PE、Mach-O、ELF，判断主程序候选和目标平台 |
| `executable-package-discovery` | 扫描无清单来源，返回零个、一个或多个入口候选 |
| `script-workspace` | 编排导入、复制、最小清单生成和入口边界校验 |
| `executable-script-runner` | 构建环境变量、修复权限、启动进程、采集输出和等待终态 |
| `executable-trust-store` | 计算并通过独立 SQLite 表持久化脚本入口 SHA-256 授权 |
| `script-runner` | 共用生命周期编排并将 `executable` 分派给新执行器 |
| `script-package-exporter` | 在主进程拒绝 `executable` 类型导出 |

各模块保持单一职责：识别器不修改文件，发现器不写清单，工作区不启动进程，执行器不决定交互授权，信任存储不解析二进制格式。

## 运行数据流

```text
start(scriptId, envId, params)
  -> 解析并校验 env / params
  -> 校验入口路径、普通文件、非符号链接、工作区边界
  -> 重新识别文件头与当前平台
  -> 计算 SHA-256 并检查授权
  -> 必要时等待用户确认
  -> macOS/Linux 为已验证入口补当前用户执行位
  -> spawn(entryPath, [], { cwd: scriptDir, shell: false })
  -> 托管 stdout / stderr / exit / error
  -> completed | failed | stopped
```

启动请求新增内部 `interactive` 能力标记，而不是只根据现有 `manual | scheduled` 触发类型猜测。主界面单个手动运行传入 `interactive: true`；定时任务、批量实例和 MCP 传入 `interactive: false`。该标记只决定是否允许展示原生程序信任确认，不改变执行历史中的触发类型。

原生程序继续使用现有会话阶段，并增加授权等待阶段：

```text
queued -> validating -> awaiting-confirmation -> starting -> running
                                                        |-> completed
                                                        |-> failed
                                                        `-> stopped
```

程序启动后不使用 detached 模式。Autoforge 持续托管直到子进程退出；没有输出不影响状态更新。

## 环境变量契约

原生程序不接收命令行参数，首期统一通过环境变量传值：

- 清单 `env` 解析结果按原键名注入。
- 每个参数注入为 `AUTOFORGE_PARAM_<NORMALIZED_KEY>`。
- 完整参数对象注入 `AUTOFORGE_PARAMS_JSON`。
- 注入 `AUTOFORGE_SESSION_ID`、`AUTOFORGE_SCRIPT_ID`、`AUTOFORGE_SCRIPT_DIR`。

参数键规范化规则：转换为大写，将非 ASCII 字母或数字替换为 `_`。若两个参数键规范化后相同，清单校验或运行前校验失败。`AUTOFORGE_PARAMS_JSON` 始终保留原始键和值。

子进程环境以 Autoforge 当前进程环境为基础，再覆盖清单 `env` 和上述保留变量。Autoforge 保留变量优先级最高，清单不得覆盖。

## 进程与日志生命周期

- 使用 `spawn(entryPath, [], { cwd: script.workspacePath, shell: false })`，不经过 shell。
- stdout 和 stderr 以 UTF-8 增量解码并按行写入现有日志总线；stderr 使用错误级别。
- 无效 UTF-8 字节使用替换字符，不导致会话失败。
- 退出码 `0` 表示完成；非零退出码表示失败。
- 启动 `error` 事件表示失败，并保留系统错误码与消息。
- 由信号退出时记录信号；非用户停止导致的信号退出按失败处理。
- 停止与超时终止整个进程树。Windows 使用 `taskkill /PID <pid> /T /F`；macOS/Linux 将子进程置于独立进程组，先向进程组发送 `SIGTERM`，两秒后仍未退出则发送 `SIGKILL`。
- macOS/Linux 仅在入口已通过格式、平台和授权校验后补充当前用户执行权限；权限修改失败则不启动。

## 运行授权

原生程序拥有独立于 JavaScript/Python 的信任边界：

1. 每次运行前计算入口文件 SHA-256。
2. 信任身份由 `scriptId + entry 相对路径 + SHA-256` 组成。
3. 首次运行或哈希变化时进入 `awaiting-confirmation`。
4. 主进程展示确认框，内容包括程序名称、入口相对路径、来源和完整 SHA-256，并说明程序将以当前用户权限访问本机文件与网络。
5. 用户确认后，主进程在落库和启动前重新读取同一路径并计算哈希；只有哈希仍与确认内容一致时才持久化授权并继续，否则返回“入口文件已变化”并要求重新确认。
6. 用户取消时将会话结束为 `stopped`，不记为执行失败，也不写入信任记录。
7. Hub 更新、重新导入或编辑替换入口后，只要哈希变化，下次运行必须重新确认。
8. 删除脚本时同步删除其信任记录。

信任只覆盖入口内容，不覆盖整个目录；DLL、动态库或资源变化不会触发重新确认。即使哈希已授权，每次运行仍重新执行路径、符号链接、文件头和平台校验。

信任记录使用独立 SQLite 迁移和表，以脚本 ID、入口相对路径和 SHA-256 建立唯一约束，并记录授权时间。脚本删除通过显式清理或外键级联删除其记录。授权校验、确认、二次哈希校验和启动均由主进程编排，renderer 不能直接写入信任状态。

### 非交互触发

`interactive: false` 的定时任务、批量实例和 MCP 调用在入口尚未授权时不得弹出隐藏确认框，直接返回“需要先在 Autoforge 中手动确认运行”。主界面手动确认相同哈希后，这些触发方式可以正常运行。Hub 安装本身永不授予运行权限。

## ZIP 导入与导出

- 无清单 ZIP 可以通过本地导入或 Hub 安装进入发现流程。
- 有清单 ZIP 沿用现有包根定位规则。
- `executable` 类型不能从 Autoforge 导出 ZIP。
- 主进程导出接口必须拒绝原生程序，不能只依赖前端隐藏按钮。
- UI 隐藏或禁用“导出 ZIP”并显示不支持原因。
- JavaScript/Python 导出分析、显式 `export.include` 和容量限制保持不变。

## 界面设计

- 脚本卡片和详情页显示 `EXE` 徽标，悬停标题为“可执行程序”。
- 二进制入口在在线编辑器中只读，复用现有二进制文件提示。
- 本地无清单包出现多个候选时显示单选列表，包含相对路径、格式和大小。
- 首次运行使用危险操作确认框，确认按钮文案为“信任并运行”。
- 原生程序不显示浏览器无头选项、npm/pip 依赖管理入口。
- 原生程序的 ZIP 导出入口禁用，并提供“不支持导出原生程序包”的说明。

## 错误处理

| 场景 | 行为 |
|------|------|
| 文件头不合法 | 拒绝并提示入口不是有效 PE、Mach-O 或 ELF 主程序 |
| 平台不匹配 | 展示检测平台和当前平台 |
| 入口越界或符号链接 | 导入或运行阶段拒绝 |
| 无清单且无候选 | 提示未找到当前系统可运行的原生程序 |
| Hub 无清单且多候选 | 返回候选相对路径，要求发布方补清单 |
| 本地多候选取消 | 取消导入，不产生数据库记录或工作区残留 |
| 自动补权限失败 | 展示入口路径和系统错误 |
| 启动失败 | 会话失败，记录系统错误码与消息 |
| 非零退出 | 会话失败，记录退出码和信号 |
| stdout/stderr 读取异常 | 记录日志，不使主进程崩溃 |
| 未授权的非交互运行 | 拒绝并提示先手动确认 |
| 原生包导出 | 主进程拒绝并返回明确错误 |

## 测试计划

### 单元测试

1. 识别 PE、Mach-O、Mach-O 通用二进制和 ELF。
2. 排除 PE DLL、Mach-O 动态库、ELF 共享库、符号链接和无效文件。
3. 显式 `executable`、自动推断、格式冲突和平台不匹配。
4. 参数键规范化、冲突检测和完整 JSON 保留。
5. SHA-256 首次授权、授权复用、文件变化重新授权和脚本删除清理。
6. stdout/stderr 增量分行、无效 UTF-8、退出码、信号和启动错误。
7. 原生程序导出在主进程被拒绝。

### 导入集成测试

1. 无清单单文件、目录和 ZIP 的零候选、单候选和多候选。
2. 本地多候选选择和取消路径。
3. Hub 单候选自动生成清单，多候选返回候选列表。
4. 自动清单的名称、入口相对路径、语言、空 env 和空 params。
5. ZIP 路径穿越、符号链接、大小和条目数量限制不回归。

### 执行集成测试

1. 环境变量和参数注入。
2. 正常退出、非零退出、无输出进程和大量分段输出。
3. 用户停止、超时以及子孙进程清理。
4. Unix 执行位自动修复与失败处理。
5. 手动首次授权、取消授权和非交互未授权拒绝。

### 跨平台与回归

- Windows、macOS、Linux CI 各使用当前平台的小型测试程序验证真实启动。
- 其他平台格式使用静态二进制夹具验证识别，不尝试跨平台启动。
- 回归 JavaScript/Python 的清单校验、导入、执行、依赖安装、徽标和 ZIP 导出。

## 验收标准

1. 用户可以导入声明 `language: executable` 的 PE、Mach-O 或 ELF 包，并由 Autoforge 托管运行。
2. 未声明语言但入口为有效原生程序时，Autoforge 能正确推断类型。
3. 无 `autoforge.json` 的单文件、目录或 ZIP 能发现唯一入口并在工作区生成最小清单。
4. 本地多候选由用户选择，Hub 多候选不猜测并返回明确错误。
5. `env`、`params` 和 Autoforge 元数据按规定注入子进程环境。
6. 首次运行和入口哈希变化后必须确认，相同哈希授权可复用。
7. 停止和超时可以清理原生程序进程树，退出码正确映射到执行历史。
8. macOS/Linux 缺少执行位时能在授权后自动修复并启动。
9. 原生程序不能通过 UI 或主进程接口导出 ZIP。
10. JavaScript/Python 现有导入、运行和导出行为无回归。
