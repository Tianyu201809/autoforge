# Hub 浏览器授权与账户中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用浏览器授权码登录 AutoforgeHub，在 Autoforge 展示账户信息和主题化插件中心。

**Architecture:** Hub 签发绑定 state、PKCE 和本机 callback 的单次授权码；Autoforge bridge 接收回调并兑换加密保存的 JWT。桌面端仅展示账户摘要，资料修改仍在 Hub 网页完成。

**Tech Stack:** Nuxt/H3、Vue 3、Electron、Node HTTP、PKCE SHA-256、safeStorage、Lucide。

## Global Constraints

- 不在 Autoforge 内处理密码；新 UI 不调用 `hub.login(email, password)`。
- code、state、verifier、JWT、Authorization header 和 callback query 不写日志或跨越 preload。
- code 有效期 120 秒，只可使用一次，绑定 callback URL、state 和 PKCE challenge。
- callback 仅监听 `127.0.0.1`，且同一时刻只能存在一个授权事务。

---

### Task 1: Hub 授权码端点与事务存储

**Files:**
- Create: `D:/myProject/AutoforgeHub/server/utils/autoforge-authorization.ts`
- Create: `D:/myProject/AutoforgeHub/server/utils/autoforge-authorization.test.ts`
- Create: `D:/myProject/AutoforgeHub/server/api/autoforge/authorize.post.ts`
- Create: `D:/myProject/AutoforgeHub/server/api/autoforge/token.post.ts`

**Interfaces:** `createAuthorization(input)` 与 `consumeAuthorization(input)`；`POST /api/autoforge/authorize`；`POST /api/autoforge/token`。

- [ ] **Step 1: Write failing tests**

```ts
test('consumes a matching authorization exactly once', () => {
  const code = store.create({ userId: 'u1', state: 'state', challenge: 'challenge', callbackUrl: 'http://127.0.0.1:19276/auth/callback' })
  assert.equal(store.consume({ code, state: 'state', verifier: 'verifier', callbackUrl: 'http://127.0.0.1:19276/auth/callback' }).userId, 'u1')
  assert.equal(store.consume({ code, state: 'state', verifier: 'verifier', callbackUrl: 'http://127.0.0.1:19276/auth/callback' }), null)
})
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test server/utils/autoforge-authorization.test.ts`.  
Expected: FAIL because the authorization store does not exist.

- [ ] **Step 3: Implement and validate**

Use a Map entry `{ userId, state, challenge, callbackUrl, expiresAt }`, 32-byte random codes, exact callback allowlist, SHA-256 base64url PKCE validation, and delete-on-consume. The token endpoint returns existing `signToken()` JWT and the current public user payload.

Run: `node --import tsx --test server/utils/autoforge-authorization.test.ts && npm run lint`.  
Commit: `git commit -m \"feat: add Autoforge browser authorization\"`.

### Task 2: Hub 授权确认页面

**Files:**
- Create: `D:/myProject/AutoforgeHub/app/pages/autoforge/authorize.vue`
- Modify: `D:/myProject/AutoforgeHub/app/pages/login.vue`
- Test: `D:/myProject/AutoforgeHub/app/pages/autoforge/authorize.test.mjs`

**Interfaces:** URL query `state/code_challenge/code_challenge_method/redirect_uri`; login preserves this full path as its redirect.

- [ ] **Step 1: Write failing page test**

```js
assert.match(source, /Autoforge 请求访问权限/)
assert.match(source, /授权并返回 Autoforge/)
assert.match(source, /取消/)
```

- [ ] **Step 2: Implement and validate**

Use the existing Hub login theme and `useAuth`. Guests return from `/login` to the preserved page. Authenticated users see account summary, fixed scopes, cancel and a single authorization action that calls the API then `window.location.assign(redirectUrl)`. Do not render password or management controls.

Run: `node --test app/pages/autoforge/authorize.test.mjs && npm run lint`.  
Commit: `git commit -m \"feat: add Hub authorization confirmation page\"`.

### Task 3: Autoforge PKCE, callback and IPC

**Files:**
- Create: `src/main/services/hub-browser-auth.ts`
- Create: `src/main/services/hub-browser-auth.test.ts`
- Modify: `src/main/services/hub-bridge-server.ts`, `src/main/services/hub-client.ts`
- Modify: `src/main/ipc/handlers.ts`, `src/shared/ipc-channels.ts`, `src/preload/index.ts`

**Interfaces:** `beginBrowserAuthorization()`, `cancelBrowserAuthorization()`, `onAuthorized(session)`; preload `hub.beginAuthorization/cancelAuthorization`.

- [ ] **Step 1: Write failing tests**

```ts
const request = flow.begin('https://hub.example.com')
assert.match(request.state, /^[A-Za-z0-9_-]{43}$/)
assert.equal(flow.acceptCallback({ code: 'code', state: 'wrong' }), null)
```

- [ ] **Step 2: Implement and validate**

Generate state/verifier with `randomBytes(32).toString('base64url')`; derive challenge using SHA-256; open the Hub authorization URL with `shell.openExternal`; retain only one pending request; clear it after 120 seconds. Add `GET /auth/callback` to the bridge, validate state, exchange code through Hub client, return success HTML and broadcast session. Do not remove legacy password IPC until UI callers are migrated.

Run: `node --import tsx --test src/main/services/hub-browser-auth.test.ts && npm run build`.  
Commit: `git commit -m \"feat: add Hub browser authorization callback\"`.

### Task 4: Account module and plugin-center redesign

**Files:**
- Modify: `src/renderer/src/components/HubPluginCenterPanel.vue`
- Create: `src/renderer/src/components/HubAccountPanel.vue`
- Modify: `src/renderer/src/components/SettingsPanel.vue`, `src/renderer/src/App.vue`
- Test: `src/renderer/src/components/HubPluginCenterPanel.test.mjs`

**Interfaces:** unauthenticated UI only uses `beginAuthorization`; authenticated UI displays `avatarUrl/displayName/email/teamCount`; management opens Hub profile, with reauthorize/logout actions.

- [ ] **Step 1: Write failing UI test**

```js
assert.match(source, /使用 AutoforgeHub 登录/)
assert.match(source, /beginAuthorization/)
assert.doesNotMatch(source, /type=\"password\"/)
assert.match(source, /团队/)
```

- [ ] **Step 2: Implement and validate**

Replace password form with browser authorization command and cancellable wait state. Build the dark Autoforge workbench: account strip, source sidebar, fixed filter controls, responsive cards and narrow detail overlay. Reuse CSS variables, Lucide icons, low-radius tool surfaces and reduced-motion fallback. Add Settings “账户” with avatar/name/email/team count/session persistence, Hub profile external link, reauthorize and logout.

Run: `node --test src/renderer/src/components/HubPluginCenterPanel.test.mjs && npm run lint && npm run build`.  
Commit: `git commit -m \"feat: add Hub account panel and browser login UI\"`.

### Task 5: Documentation and end-to-end verification

**Files:**
- Modify: `README.md`, `docs/architecture.md`, `docs/CHANGELOG.md`
- Modify: `D:/myProject/AutoforgeHub/docs/api/auth.md`

- [ ] **Step 1: Document protocol**

Describe browser authorization, callback restriction, one-time PKCE behavior, account settings and Hub as profile source of truth.

- [ ] **Step 2: Verify**

Run in Autoforge: `npm run test:unit && npm run lint && npm run build && git diff --check`.  
Run in Hub: `npm run test:marketplace-mine && npm run lint && git diff --check`.  
Manually test authorization, login recovery, account display, profile redirect, install, logout, cancel, expiry, replay, wrong state and offline errors.
