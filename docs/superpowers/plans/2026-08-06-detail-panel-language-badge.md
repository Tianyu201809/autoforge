# Detail Panel Language Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在详情面板头部右上角显示与脚本卡片一致的 `JS` / `Py` 语言徽标。

**Architecture:** `DetailPanel.vue` 读取现有 `script.language`，通过共享的 `scriptLanguageBadge()` 计算文案和颜色类。右侧区域使用“徽标 + 按钮行”的纵向容器，并沿用详情面板的容器查询规则适配窄宽度。

**Tech Stack:** Vue 3 Composition API、TypeScript、Tailwind CSS、CSS Container Queries、Node.js Test Runner

## Global Constraints

- JavaScript 文案必须为 `JS`，Python 文案必须为 `Py`。
- 徽标必须复用 `src/shared/script-language.ts` 的 `scriptLanguageBadge()`，不得重复语言判断和配色。
- 徽标位于详情头部右侧操作按钮上方，不提供点击行为。
- 面板宽度低于 `620px` 时，右侧操作区移动到标题下方并保持右对齐。
- 不新增依赖，不修改 `ScriptItem` 或 `ScriptLanguage` 数据结构。

---

### Task 1: Add the Detail Header Language Badge

**Files:**
- Modify: `src/renderer/src/components/DetailPanel.vue:1`
- Modify: `src/renderer/src/components/DetailPanel.vue:1167`
- Modify: `src/renderer/src/components/DetailPanel.vue:1710`
- Test: `src/renderer/src/components/DetailPanelHeader.test.mjs`

**Interfaces:**
- Consumes: `scriptLanguageBadge(language: ScriptLanguage): ScriptLanguageBadge` and `props.script.language`.
- Produces: `languageBadge: ComputedRef<ScriptLanguageBadge>` and a non-interactive language badge in the detail header.

- [x] **Step 1: Extend the regression test and verify it fails**

Add these assertions to the existing `Detail panel responsive header` test case:

```js
assert.match(source, /import\s*\{\s*scriptLanguageBadge\s*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/shared\/script-language['"]/)
assert.match(source, /const languageBadge = computed\(\(\) => scriptLanguageBadge\(props\.script\.language\)\)/)
assert.match(source, /class="detail-panel-language-badge"/)
assert.match(source, /\{\{ languageBadge\.label \}\}/)
assert.match(source, /script\.language === 'python' \? 'Python [^']+' : 'JavaScript [^']+'/)
```

Run:

```powershell
node --test src/renderer/src/components/DetailPanelHeader.test.mjs
```

Expected: FAIL because `DetailPanel.vue` does not yet import or render `scriptLanguageBadge`.

- [x] **Step 2: Compute the shared badge model**

Add the shared import beside the other shared helpers:

```ts
import { scriptLanguageBadge } from '../../../shared/script-language'
```

After `defineProps`, compute the presentation model:

```ts
const languageBadge = computed(() => scriptLanguageBadge(props.script.language))
```

- [x] **Step 3: Render the badge above the action buttons**

Replace the opening `<div class="detail-panel-header-tools">` with this wrapper and badge:

```vue
<div class="detail-panel-header-actions">
  <span
    class="detail-panel-language-badge"
    :class="languageBadge.className"
    :title="script.language === 'python' ? 'Python 脚本' : 'JavaScript 脚本'"
  >{{ languageBadge.label }}</span>
  <div class="detail-panel-header-tools">
```

Keep every existing child of `.detail-panel-header-tools` unchanged. Immediately after that tools row's closing `</div>`, insert one additional `</div>` to close `.detail-panel-header-actions`.

Add scoped styles and update the narrow-container selector:

```css
.detail-panel-header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.375rem;
  margin-left: auto;
  flex-shrink: 0;
}

.detail-panel-language-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.75rem;
  padding: 0.125rem 0.375rem;
  border-width: 1px;
  border-radius: 0.375rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1rem;
  letter-spacing: 0.025em;
  white-space: nowrap;
}

@container (max-width: 620px) {
  .detail-panel-header > .detail-panel-header-actions {
    width: 100%;
  }
}
```

- [x] **Step 4: Run focused validation**

Run:

```powershell
node --test src/renderer/src/components/DetailPanelHeader.test.mjs
npx eslint src/renderer/src/components/DetailPanel.vue src/renderer/src/components/DetailPanelHeader.test.mjs
```

Expected: the detail-header test passes and ESLint exits with code `0`.

- [x] **Step 5: Run full validation**

Run:

```powershell
npm run test:unit
npm run build
```

Expected: all unit tests pass and all Electron/Vite bundles build successfully.

- [x] **Step 6: Commit the implementation**

```powershell
git add src/renderer/src/components/DetailPanel.vue src/renderer/src/components/DetailPanelHeader.test.mjs package.json docs/superpowers/plans/2026-08-06-detail-panel-language-badge.md
git commit -m "feat: show language badge in detail panel"
```
