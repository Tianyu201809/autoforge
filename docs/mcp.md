# Autoforge MCP

Autoforge 提供一个默认关闭的本地 MCP 控制面。它只允许同一台电脑上的 agent 查询、编辑和运行脚本；Prompts、依赖安装、分类、调度、窗口控制和任意 shell 不在本期范围内。

## 开启

1. 打开 Autoforge 设置中的 **MCP**。
2. 开启“Allow local MCP control”。Autoforge 必须保持运行，adapter 不会自动启动桌面程序。
3. 点击 **Copy JSON**，把配置片段粘贴到所用 agent 的 MCP 配置中。Autoforge 不会自动修改第三方配置文件。

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

开发环境使用 `npm run mcp -- --app-env development`。MCP client 和 `@modelcontextprotocol/sdk` 随应用/项目提供，用户不需要单独安装 Node（开发环境除外）。

## Token 与安全

主进程每次启用或轮换时生成 32 字节 token，并写入当前用户的 runtime descriptor。stdio adapter 自动发现 descriptor 并完成本地握手；token 不会进入 Electron renderer、复制的配置、工具结果、日志或审计记录。关闭 MCP 会关闭现有连接并删除 descriptor；轮换 token 会立即使旧连接失效。

工作区写入、创建、导入、删除、环境/参数变更必须传 `confirm: true`。`start_script` 默认不持久化参数；只有 `persistParams: true` 时需要确认。secret 字段只返回存在性，不回显原值。

## 可用能力

工具覆盖脚本和文件 CRUD、环境 Profile、脚本参数、异步 session、增量日志、等待终态和执行历史。只读 resources 为：`autoforge://app/status`、`autoforge://scripts`、`autoforge://scripts/{scriptId}/manifest`、`autoforge://sessions/{sessionId}`、`autoforge://sessions/{sessionId}/logs`。

Autoforge 未运行或 MCP 关闭时，adapter 仍可完成 MCP 初始化，但调用控制工具会返回 `app_not_ready`；它不会监听 TCP 端口，也不会执行任意 shell。
