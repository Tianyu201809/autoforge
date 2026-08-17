# 原生可执行脚本 ZIP 导出设计

## 背景

Autoforge 已支持将 Windows PE、macOS Mach-O 和 Linux ELF 原生程序作为 `language: "executable"` 的脚本导入和运行，但现有 ZIP 导出器会主动拒绝该语言类型。用户需要将原生脚本包连同入口二进制和所需资源导出为可重新导入的 ZIP。

## 目标

1. 支持原生可执行脚本导出 ZIP。
2. ZIP 固定包含 `autoforge.json` 与清单声明的入口二进制。
3. 通过 `export.include` 纳入 DLL、配置和其他运行资源。
4. 保持现有路径、安全和敏感文件过滤规则。
5. 将导出单文件和全部文件的未压缩总大小上限均设为 500 MB。
6. 恢复原生脚本卡片上的导出入口，继续使用现有预览、确认与保存流程。

## 非目标

- 不自动分析 PE、Mach-O 或 ELF 的动态库依赖。
- 不放宽符号链接、路径越界、密钥、证书、数据库、缓存和生成目录的导出限制。
- 不改变 JavaScript 或 Python 脚本的静态依赖分析与导出结果。
- 不以 ZIP 压缩后的实际体积作为容量限制依据；限制以纳入文件的未压缩大小计算。

## 方案

扩展现有 `script-package-exporter`，按脚本语言分支构建导出计划，而不是创建第二个导出服务：

- JavaScript/Python 维持当前逻辑：清单、入口、README、`export.include` 和静态解析出的本地代码/资源文件。
- `executable` 分支收集清单、入口、README 与 `export.include` 匹配文件；不读取或解析二进制内容。
- 扩展可导出文件白名单，以允许二进制入口及原生包的常见运行资源。所有文件仍必须通过已有的路径规范化、工作区边界、普通文件和非符号链接校验。
- 将 `MAX_FILE_BYTES` 和 `MAX_EXPORT_BYTES` 均改为 500 MB，保留清晰的超限错误。

## 数据流

```text
脚本卡片“导出 ZIP”
  -> IPC 导出预览
  -> buildScriptExportPlan(script, manifest)
     -> executable: 清单 + 入口 + README + export.include
     -> javascript/python: 保持现有静态依赖收集
     -> 安全过滤与 500 MB 容量校验
  -> 用户确认并选择路径
  -> writeScriptExportZip()
  -> 返回文件名、文件数和大小
```

## 界面

`ScriptCard` 不再针对 `executable` 禁用“导出 ZIP”。原生脚本与其他脚本共享预览确认弹窗，提示用户使用 `export.include` 明确声明运行时动态加载的资源。

## 错误处理

- 入口文件缺失、不是普通文件或为符号链接时拒绝导出。
- `export.include` 未匹配文件、匹配受限文件或匹配越界路径时拒绝导出。
- 任一文件或累计文件大小超过 500 MB 时拒绝导出。
- 保存对话框取消时不创建文件且返回空结果。

## 测试

1. 原生脚本导出计划包含清单、入口和显式资源。
2. 原生二进制可超过原先的 10 MB 限制，但超过 500 MB 会被拒绝。
3. 原生资源的受限路径和符号链接仍被拒绝。
4. JavaScript/Python 导出计划继续执行既有静态依赖收集。
5. 卡片菜单不再禁用原生脚本的导出操作。
