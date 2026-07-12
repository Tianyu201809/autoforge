# 脚本 README「说明」Tab — 设计规格

**日期**：2026-07-12  
**状态**：已实现  
**关联**：用户向规范见 `docs/script-spec.md`（实现时同步增补 README 节）

---

## 1. 背景与目标

Autoforge 脚本包已有 `autoforge.json` 短描述（`description`）与详情面板多 Tab（详情 / 运行参数 / 运行历史 / 编辑 / 日志 / 配置），但缺少包内长文说明的展示入口。脚本作者无法用 Markdown 写使用步骤、截图与注意事项并在应用内查看。

**目标**：

1. 识别脚本包根目录的可选 `README.md`
2. 在脚本详情顶栏「配置」右侧新增「说明」Tab，将 Markdown 渲染展示
3. 更新 `docs/script-spec.md`，把 README 约定写入脚本包规范

**非目标（本期不做）**：

- `readme.md` / `Readme.md` 等大小写变体
- 子目录 README，或在 `autoforge.json` 中声明说明路径
- 用 `description` 自动生成或回填 README
- 文件热监听 / 自动刷新（除再次进入 Tab）
- 提升 `autoforge` 规范版本号（仍为 `"1.0"`；README 为可选、非破坏性约定）

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| Tab 位置 | 详情顶栏，位于「配置」右侧，始终可见 |
| 无 README | 显示默认文案「暂无说明文档」 |
| 文件规则 | 仅包根 `README.md`（大小写精确） |
| 渲染 | 引入成熟库（`markdown-it`），完整 Markdown 语法 |
| 外链 | 可点击，系统浏览器打开（`shell.openExternal`） |
| 相对图片 | 从脚本包内读取并显示 |
| 实现路径 | 方案 1：懒加载 + 现有 `scripts.readFile`，小幅扩展图片读盘 |
| 与 `description` | 互不替代：卡片/列表用短描述；「说明」只认 README |

---

## 3. UI 与信息架构

脚本详情顶栏 Tab 顺序：

```
详情 | 运行参数 | 运行历史 | 编辑 | 日志 | 配置 | 说明
```

行为：

- 「说明」始终出现在 Tab 栏（与是否存在 README 无关）
- **懒加载**：仅在用户切入「说明」时读取 `README.md`
- 有正文：渲染为 HTML 展示
- 无文件、读失败、或非可用文本：面板内展示 **「暂无说明文档」**
- 每次进入该 Tab 重新读取，以便「编辑」Tab 改完 README 后切回可见最新内容

主要改动面：`DetailPanel.vue`（Tab 列表 + 说明面板内容区）。

---

## 4. 架构与数据流

```
用户切入「说明」Tab
        │
        ▼
scripts.readFile(scriptId, 'README.md')
        │
        ├─ 不存在 / 失败 / 空 → UI：「暂无说明文档」
        │
        └─ 文本 content
                │
                ▼
         markdown-it 渲染 → HTML
                │
                ▼
         DOMPurify（或等价）消毒
                │
                ▼
         解析相对图片 src
                │
                ├─ 包内安全路径 → 读二进制 → data: URL 替换
                ├─ 缺失 → 保留破损图，不阻断正文
                └─ 路径逃逸（含 ..）→ 拒绝，不加载
                │
                ▼
         v-html 展示；http(s) 链接点击 → openExternal
```

### 4.1 读文件

- 复用现有 IPC：`window.autoforge.scripts.readFile(id, relativePath)`
- 路径固定为包根相对路径 `README.md`
- 工作区安全解析继续走 `resolveSafeWorkspaceFile`（禁止逃出脚本目录）

### 4.2 图片通道扩展

当前 `ScriptFileContent` 对二进制文件返回 `binary: true` 且 `content: ''`，无法直接显示图片。

**约定：扩展现有 `readFile`（不新增 IPC）**：

- 对常见图片扩展名（`.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg`）：`content` 为 base64，`binary: true`，并增加可选字段 `encoding: 'base64'` 与 `mimeType`
- 其它二进制文件行为保持现状（空 `content` + `binary: true`），避免编辑器误当文本打开
- 文本文件：`encoding: 'utf8'`（或缺省，与现有兼容）

渲染前将相对 `src` 改写为 `data:{mime};base64,...`。绝对 `http(s)` 图片 URL 可直接保留（由 Chromium 加载）；`file:` 与其它危险协议丢弃。

### 4.3 渲染与安全

| 能力 | 约定 |
|------|------|
| 库 | `markdown-it`（按需启用 linkify、表格等） |
| 消毒 | 渲染后 HTML 必须消毒后再 `v-html`；禁止 `script`、内联事件等 |
| 链接协议 | 仅允许 `http:` / `https:`（及可选相对锚点 `#`）；拦截 `javascript:` 等 |
| 外链打开 | 点击外链 → 主进程 `shell.openExternal`（与应用现有外链策略一致） |
| 样式 | 独立说明区样式类，贴近详情面板，不依赖 DevGuide 的旧轻量渲染器 |

本期**不要求**改造 `DevGuidePanel` 的轻量 `renderMarkdown`；说明 Tab 使用独立渲染管线。后续若要统一，可再抽公共模块（非本期范围）。

---

## 5. `docs/script-spec.md` 增补要点

实现时在脚本包规范中新增「README 说明文档」节（建议靠近「最小示例」或「上传方式」），至少包含：

| 项 | 约定 |
|----|------|
| 文件 | 包根可选 `README.md`（大小写精确匹配） |
| 用途 | 脚本使用说明；平台脚本详情 → **说明** Tab 渲染展示 |
| 与 description | 不替代 `autoforge.json` 的 `description` |
| 语法 | Markdown；平台以完整渲染器展示 |
| 图片 | 相对路径相对**包根**；随包分发；缺失不阻断正文 |
| 外链 | 可点击，系统浏览器打开 |
| zip / Hub | 若有 README，分发 zip 须放在含 `autoforge.json` 的同一包根 |
| 最小示例树 | 可选增加 `README.md` 一行 |

规范版本字段 `autoforge: "1.0"` **不变**。

---

## 6. 错误处理

| 情况 | 行为 |
|------|------|
| 无 `README.md` | 「暂无说明文档」 |
| 读文件抛错 / IPC null | 「暂无说明文档」 |
| Markdown 渲染异常 | 「暂无说明文档」（与无文档一致，避免技术噪音） |
| 单张相对图片缺失 / 读失败 | 该图不显示或破损占位；正文其余正常 |
| 相对路径含 `..` 逃逸 | 不加载该资源 |

---

## 7. 测试范围

- 无 README → 文案「暂无说明文档」
- 有 README → 标题、列表、代码块、表格等渲染正确
- 相对图片：存在可显示；缺失不阻断
- 外链点击走系统浏览器
- `../` 路径逃逸被拒绝
- 恶意 HTML / `javascript:` 链接被消毒或拦截
- 在「编辑」中修改 README 后再次进入「说明」可见更新

---

## 8. 组件边界（建议）

| 单元 | 职责 | 依赖 |
|------|------|------|
| `DetailPanel` Tab「说明」 | Tab 切换、空态、触发加载 | scriptId、IPC |
| README 加载 composable（可选） | 读 `README.md`、缓存当次 Tab 会话、重置 | `scripts.readFile` |
| Markdown 渲染工具 | md → 消毒 HTML；相对图改写 | `markdown-it`、消毒库、资源读取 |
| Main `script-workspace` | 安全读文本/图片字节 | 现有路径校验 |

每个单元应可独立理解：输入、输出、依赖清晰；渲染逻辑不散落在多个 Vue 模板里复制。

---

## 9. 成功标准

1. 任意已导入脚本可打开「说明」Tab
2. 包根放置 `README.md` 后，Markdown（含相对图片与外链）按本规格展示
3. `docs/script-spec.md` 已包含 README 约定，作者可按文档编写说明

