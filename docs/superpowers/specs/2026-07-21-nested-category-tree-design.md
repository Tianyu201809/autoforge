# 无限树形分类与侧栏底栏压缩设计

## 背景

当前分类为扁平一级结构：数据库 `categories` 无父子关系，侧栏以按钮列表展示，脚本通过 `scripts.category`（string key）挂到单一分类。分类增多后侧栏可用空间紧张；同时侧栏底部「上传脚本 + Hub / 指南 / 历史 / 设置」占用过高，挤压分类区。

需求 2（单脚本多实例批量）另开规格，本规格仅覆盖分类树与侧栏布局。

## 目标

- 支持任意深度的分类树（邻接表 `parent_id`）。
- 任意节点可挂脚本、可挂子分类（含内置分类）。
- 侧栏点选某分类时，过滤该节点及其全部子孙下的脚本；计数为递归合计。
- 侧栏右键支持：新建子分类 / 重命名 / 删除。
- 删除非空分类（有子分类或直接挂靠脚本）时禁止删除并提示。
- 压缩侧栏底栏：保留较矮的「上传脚本」主按钮，Hub / 指南 / 历史 / 设置改为一排图标（悬停显示全名）。
- 分类管理弹窗、详情面板与卡片上的分类选择器改为树形。

## 非目标

- 不实现拖拽改层级。
- 不引入闭包表 / 物化路径。
- 不设深度硬上限。
- 不支持脚本挂多个分类。
- 不改变 `scripts.category` 仍为 string key 的存储方式。
- 不做单脚本多实例（需求 2）。

## 方案选型

采用邻接表：`categories.parent_id`（可空 = 顶层）。分类规模小，在服务层内存拼树与收集子孙即可。相对物化路径 / 闭包表，迁移与移动成本更低。

## 数据模型

### Schema

- 新迁移为 `categories` 增加可空列 `parent_id`（同表 `id` 外键语义；应用层校验）。
- 现有行迁移后 `parent_id = NULL`。
- `category_overrides`、内置 key 机制不变。
- `scripts.category` 继续存分类 `key`。

### 类型

- `CategoryDefinition` / 相关类型增加 `parentId: string | null`。
- `categories:list` 返回扁平列表（含 `parentId`）；渲染层或服务层组装 `children[]` 树供 UI 使用（树不入库）。
- 侧栏计数：对每个节点统计「自身直接挂靠脚本数 + 全部子孙直接挂靠脚本数」。

### 规则

- 任意节点可挂脚本；任意节点（含内置）下可建子分类。
- 内置分类：不可删除；`parentId` 固定为 `NULL`（不可被移到其他节点下）；展示名/颜色仍走现有 override；侧栏「重命名」内置时写 override，不改内置 key。
- 自定义分类：可设置 `parentId` 为任意存在节点（含内置或其它自定义）；删除前必须无子分类，且无脚本的 `category` 等于该节点 key。
- 更新 `parentId` 时防环：禁止将节点设为自己的子孙。
- 父节点不存在时拒绝创建/移动。
- 脚本 key 指向已删除分类时：不强迁，列表侧按现有「未知/兜底」策略展示。

## UI 设计

### 侧栏分类区

- 可展开/折叠的树；展开状态本地持久化（如 localStorage）。
- 点击节点设置 `activeCategoryKey` 并筛选。
- 右键菜单：新建子分类、重命名、删除（删除受门禁约束）。
- 「管理」入口保留，打开树形管理弹窗。

### 侧栏底栏（原红框区域）

- 「上传脚本」保留为全宽主按钮，高度压缩。
- Hub / 脚本开发指南 / 执行历史 / 设置：同一行四个图标按钮，悬停 tooltip 显示完整名称；点击行为与现网一致。

### 其他入口

- `CategoryManagerModal`：树形列表，支持与侧栏同等的增删改（含指定父节点新建）。
- 详情面板分类下拉、卡片分类选择：改为可展开的树形选择器，任意节点可选。

## 组件与数据流

### 主进程

- 迁移：`parent_id`。
- `category-repository`：CRUD 支持 `parentId`；删除前查询子节点与直接挂靠脚本。
- `category-service`：组装树辅助、`collectDescendantKeys`、防环校验。
- IPC：`categories:create` 可带 `parentId`；`categories:update` 可改 label / color / `parentId`；`categories:delete` 在非空时返回明确错误。

### 渲染进程

- `Sidebar.vue`：树 + 右键 + 紧凑底栏。
- `CategoryManagerModal.vue`：树形管理。
- 分类选择器（详情 / 卡片）：树形。
- `useScriptStore` 过滤：由已加载分类树计算 `keys = self + descendants`，再 `keys.includes(script.category)`。优先在前端用 list 结果本地计算，避免每次筛选额外 IPC。

### 筛选流程

1. 用户点击树节点 → `activeCategoryKey = key`。
2. 从树收集自身及子孙 key 集合。
3. 脚本列表按该集合过滤。

## 错误处理

| 场景 | 行为 |
|------|------|
| 删除有子分类或直接挂靠脚本的分类 | 拒绝；Toast 提示先删子分类并移走脚本 |
| `parentId` 更新成环 | 拒绝；Toast 提示不能移到自己的子分类下 |
| 父节点不存在 | 拒绝创建/移动 |
| 删除内置分类 | 拒绝（现有行为） |

## 改动文件（预期）

- `src/main/db/migrations/`（新迁移）
- `src/main/db/repositories/category-repository.ts`
- `src/main/services/category-service.ts`
- `src/main/services/script-store.ts`（若分类 API 经此转发）
- `src/main/ipc/handlers.ts` / `src/preload/index.ts`
- `src/shared/types/script.ts`（及必要的 shared 类型）
- `src/renderer/src/components/Sidebar.vue`
- `src/renderer/src/components/CategoryManagerModal.vue`
- `src/renderer/src/components/ScriptCard.vue` / `DetailPanel.vue`（分类选择）
- `src/renderer/src/composables/useScriptStore.ts`

## 验证

- 迁移后旧数据均为顶层，行为与现网一致。
- `collectDescendantKeys`：多级 / 叶子 / 空子树。
- 防环：A→B→A 被拒。
- 删除门禁：有子 / 有脚本 / 皆空。
- 过滤：父节点命中子孙脚本；叶子仅命中自身。
- UI：展开折叠、右键三项、底栏图标与 tooltip、树形选择器可选任意节点。
- 既有类型检查与构建通过。

## 后续

本规格批准并实现后，另开规格处理需求 2：单脚本最多 5 个并发实例、每实例独立参数与配置。
