# AutoforgeHub 入口配置设计

## 背景

侧边栏当前的“脚本市场”入口只是占位提示。AutoforgeHub 已提供浏览器访问地址，因此需要允许用户在设置页配置地址，并从桌面应用直接进入该站点。

## 目标

- 在设置页提供 AutoforgeHub 地址配置项。
- 将配置持久化到现有应用配置 JSON 中，并兼容旧配置。
- 将侧边栏“脚本市场”改名为“进入AutoforgeHub”。
- 配置有效地址后，点击入口使用系统默认浏览器打开。
- 未配置地址时提示“AutoforgeHub地址未设置”。

## 非目标

- 不在应用内嵌入 Hub 网站。
- 不新增 Hub 专用 IPC 通道。
- 不新增数据库迁移或改变现有脚本市场数据模型。

## 方案

在 `AppConfig` 中增加可选字段 `hub.url`。设置页通过现有 `config.get` / `config.set` 读写该字段；侧边栏通过现有 `system.openExternal` 打开地址。该接口已在主进程限制为 `http:` 和 `https:`，因此无需引入新的外部打开能力。

## 数据与交互流程

1. 设置面板首次打开时调用 `window.autoforge.config.get()`，将 `config.hub?.url` 映射到输入框。
2. 点击“保存设置”时对地址执行 `trim()`；空字符串保存为 `undefined`，非空值保存为 `hub: { url }`。
3. 侧边栏入口点击时读取当前应用配置并对地址执行 `trim()`。
4. 地址为空时显示信息 Toast，标题为“AutoforgeHub”，内容为“AutoforgeHub地址未设置”。
5. 地址非空时调用 `window.autoforge.system.openExternal(url)`。
6. 若 URL 不符合现有 `http/https` 校验，或系统浏览器打开失败，显示错误 Toast“AutoforgeHub地址无效”。

## 配置合并规则

`ConfigRepository.getConfig` 和 `setConfig` 均保留现有配置字段，并对 `hub` 做浅层嵌套合并：保存其他设置时不覆盖已保存的 `hub.url`，保存 Hub 地址时也不影响浏览器、窗口等其他配置。旧配置缺少 `hub` 时按空配置处理。

## UI 设计

- 设置页增加独立“AutoforgeHub”区块。
- 标签为“AutoforgeHub 地址”。
- 输入框使用单行文本输入，使用 URL 示例作为 placeholder，并允许用户直接粘贴地址。
- 说明文案提示该地址用于打开 AutoforgeHub；不填写时点击入口会提示未设置。
- 侧边栏入口保留 Store 图标，显示“进入AutoforgeHub”，移除原“Soon”徽标。

## 改动文件

- `src/shared/types/script.ts`
- `src/main/db/repositories/config-repository.ts`
- `src/renderer/src/components/SettingsPanel.vue`
- `src/renderer/src/components/Sidebar.vue`

## 验证

- 运行项目既有类型检查和构建命令。
- 静态检查 `AppConfig` 的 hub 字段从 renderer 类型声明贯通到 preload API。
- 手工验证四条路径：未配置提示、`http` 地址打开、`https` 地址打开、无效地址错误提示。
- 验证保存其他设置不会清空已保存的 Hub 地址。
