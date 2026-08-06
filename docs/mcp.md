# Autoforge MCP

Autoforge 提供一个默认关闭的本地 MCP 控制面。它只允许同一台电脑上的 agent 查询、编辑和运行脚本；Prompts、依赖安装、分类、调度、窗口控制和任意 shell 不在本期范围内。

## 开启

1. 打开 Autoforge 设置中的 **MCP**。
2. 开启“允许本地 MCP 控制”，并保持 Autoforge 在后台运行。
3. 在“Agent 配置”中选择客户端，复制对应的 Codex 配置或通用 JSON。

MCP client 和 `@modelcontextprotocol/sdk` 已随应用提供，普通用户不需要另外安装 MCP 客户端或 Node.js；只有从源码运行的开发环境需要安装项目依赖。Autoforge 不会自动修改第三方客户端的配置文件。

## Codex 接入

推荐直接复制设置页中的 **Codex CLI 快速安装**命令并在终端执行。开发环境示例：

```powershell
codex mcp add autoforge -- npm.cmd --prefix "C:\personal\autoforge" run mcp -- --app-env development
```

也可以把设置页生成的 TOML 写入 Codex 的 `config.toml`：

```toml
[mcp_servers.autoforge]
command = "npm.cmd"
args = ["--prefix", "C:\\personal\\autoforge", "run", "mcp", "--", "--app-env", "development"]
startup_timeout_sec = 30
```

必须保持 `command` 和 `args` 的边界：

- `command` 只能是一个可执行文件，例如 Windows 开发环境中的 `npm.cmd`。
- `args` 中每个参数必须是单独一项，不能把 `npm run mcp` 或 `--app-env development` 合并成一个值。
- 已经存在错误的同名配置时，先运行 `codex mcp remove autoforge`，再执行新的安装命令。
- 可用 `codex mcp list` 检查 Autoforge 是否已经注册；更新配置后请新建一个 Codex 会话。

Codex 的 stdio 模式会为每个会话启动一个轻量 adapter 子进程，这是正常行为。adapter 只连接已运行的 Autoforge，不会启动新的桌面窗口；如果窗口反复出现，通常表示旧配置没有把 `--mcp-stdio` 或开发环境参数正确拆开。

## 其他 MCP 客户端

生产安装包使用：

```json
{
  "mcpServers": {
    "autoforge": {
      "command": "<Autoforge executable>",
      "args": ["--mcp-stdio", "--app-env", "production"]
    }
  }
}
```

开发环境使用设置页生成的配置。其结构等价于：

```json
{
  "mcpServers": {
    "autoforge": {
      "command": "npm.cmd",
      "args": ["--prefix", "C:\\personal\\autoforge", "run", "mcp", "--", "--app-env", "development"]
    }
  }
}
```

## Token 与安全

主进程每次启用或轮换时生成 32 字节 token，并写入当前用户的 runtime descriptor。stdio adapter 自动发现 descriptor 并完成本地握手；token 不会进入 Electron renderer、复制的配置、工具结果、日志或审计记录。关闭 MCP 会关闭现有连接并删除 descriptor；轮换 token 会立即使旧连接失效。

Codex 不需要配置 Autoforge token、环境变量或 OpenAI API key。这里的 token 只用于 Autoforge 主进程与本机 adapter 之间的认证，并由应用自动管理；Codex 自身的账号或 API 认证仍按 Codex 的正常方式配置。

工作区写入、创建、导入、删除、环境/参数变更必须传 `confirm: true`。`start_script` 默认不持久化参数；只有 `persistParams: true` 时需要确认。secret 字段只返回存在性，不回显原值。

## 可用能力

工具覆盖脚本和文件 CRUD、环境 Profile、脚本参数、异步 session、增量日志、等待终态和执行历史。只读 resources 为：`autoforge://app/status`、`autoforge://scripts`、`autoforge://scripts/{scriptId}/manifest`、`autoforge://sessions/{sessionId}`、`autoforge://sessions/{sessionId}/logs`。

Autoforge 未运行或 MCP 关闭时，adapter 仍可完成 MCP 初始化，但调用控制工具会返回 `app_not_ready`；它不会监听 TCP 端口，也不会执行任意 shell。
