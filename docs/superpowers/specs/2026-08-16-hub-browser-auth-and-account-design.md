# AutoforgeHub 浏览器授权与账户中心设计

**日期：** 2026-08-16  
**状态：** 已确认，待实施  
**关联项目：** `D:/myProject/AutoforgeHub`

## 目标

将 Autoforge 的 Hub 登录改为浏览器授权码流程：用户在 Autoforge 中发起登录，在 Hub 网页登录并确认授权，随后自动回到桌面端。桌面端展示已登录账户信息，在设置中提供账户模块，并将插件中心重构为与 Autoforge 主题一致的工具工作台。

## 非目标

- 不在 Autoforge 内收集或处理用户密码。
- 不在桌面端实现账户资料、密码、团队或发布管理表单；这些能力继续由 Hub 网页承担。
- 不注册 `autoforge://` 系统协议，不引入 WebView，不改变网页安装 bridge 协议。

## 授权协议

1. Autoforge 主进程生成 32 字节随机 `state`、PKCE verifier/challenge、120 秒过期时间和 `http://127.0.0.1:19276/auth/callback` callback URL。
2. 主进程通过默认浏览器打开 Hub 的 `/autoforge/authorize`，传递 `client=autoforge`、`state`、`code_challenge`、`code_challenge_method=S256` 和 callback URL。
3. Hub 未登录用户先进入现有登录页；登录成功后恢复授权上下文。已登录用户直接查看授权确认页。
4. 用户确认后，Hub 保存单次、120 秒、绑定用户 ID、state、PKCE challenge 和 callback URL 的授权码，并重定向本机 callback。
5. Autoforge bridge 验证 callback 的 state，主进程以 code、state 和 verifier 调用 Hub token 兑换接口。Hub 验证后签发当前 JWT 并立即作废 code。
6. JWT 仍通过 Electron `safeStorage` 加密存储，渲染进程只接收脱敏会话和成功/失败状态。

Hub 的授权码必须单次使用；过期、取消、state 不匹配、callback URL 不匹配或 PKCE 校验失败均不得创建桌面会话。bridge 只绑定 `127.0.0.1`，且同一时刻仅允许一个授权事务。

## Hub API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/autoforge/authorize` | 已登录用户确认授权，返回浏览器重定向目标。 |
| `POST` | `/api/autoforge/token` | 以 code、state、PKCE verifier 和 callback URL 兑换 JWT 与用户摘要。 |
| `GET` | `/autoforge/authorize` | Hub 授权页面；未登录时保留授权上下文并跳转现有登录页。 |

授权作用域固定为读取用户资料、读取有权访问的插件/团队和申请一次性安装令牌；不授予账户编辑、上传、发布、团队管理或删除权限。

## Autoforge UI

### 插件中心

- 未登录态只有“使用 AutoforgeHub 登录”主操作及浏览器授权等待/取消状态，不显示密码输入。
- 已登录态顶部显示头像、昵称、邮箱和团队数量；左侧导航为市场、个人和团队；中部为搜索、分类、语言、排序、分页插件列表；右侧为详情、README 和安装操作。
- 卡片与详情明确展示安装中、已安装、更新、无权限和配额状态。安装仍复用既有 Hub ZIP 导入逻辑。
- 视觉延续 Autoforge 的深色工具工作台：炭黑表面、Hub 暖色强调、低圆角、稳定工具尺寸和克制动效。窄窗口下将筛选收进工具菜单，详情区域改为覆盖层。

### 设置账户模块

- 新增“账户”导航段，展示头像、昵称、邮箱、团队数、Hub 地址和会话持久化状态。
- 提供“登录/重新授权”“在 Hub 中管理账户”“退出登录”操作。
- “管理账户”打开 Hub 的现有个人资料页面；返回 Autoforge 时重新请求 `/api/auth/me`。
- Hub 地址变化、退出、401 或授权失败均清除桌面端会话。

### Hub 授权页

- 使用 Hub 现有登录页的深色编辑风格，但授权确认页只保留产品标识、当前账户、权限摘要、取消和授权按钮。
- 明确显示“Autoforge 请求访问权限”，避免让用户误以为在登录第三方页面或授权上传/删除权限。

## 错误与验证

- Autoforge：测试 state/PKCE 生成、等待回调、取消、超时、错误 state、code 兑换失败、会话成功广播和退出清理。
- Hub：测试授权上下文跨登录恢复、未确认不能签发 code、code 过期/重放、state/callback/PKCE 不匹配和成功兑换。
- UI：测试未登录不展示密码、授权等待可取消、已登录账户摘要、账户管理外链、退出、市场/个人/团队插件状态。
- 所有日志严禁输出 verifier、JWT、code、Authorization header 或完整 callback 查询字符串。
