# 分类筛选覆盖导航条件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选择分类时，列表始终基于全部脚本，仅按分类（及搜索/排序）筛选，不叠加运行中、收藏、定时任务或已归档条件。

**Architecture:** 在 `useScriptStore` 的分类入口统一清空冲突筛选状态并切换到 `all` 导航；列表计算逻辑保持单一职责，继续执行分类、搜索和排序。通过源码级回归测试锁定入口行为。

**Tech Stack:** Vue 3 Composition API、TypeScript、Node test、tsx。

## Global Constraints

- 保持现有分类层级匹配（包含子分类）。
- 不改变搜索、排序、分页及分类取消行为。
- 不引入新依赖。

### Task 1: 分类筛选状态覆盖

**Files:**
- Modify: `src/renderer/src/composables/useScriptStore.ts`
- Test: `src/renderer/src/composables/useScriptStoreFilter.test.mjs`

- [x] **Step 1: Write the failing test**：断言分类入口会切换 `all` 并重置状态/收藏/定时条件，同时保留分类键。
- [x] **Step 2: Run test to verify it fails**：`node --import tsx --test src/renderer/src/composables/useScriptStoreFilter.test.mjs`。
- [x] **Step 3: Write minimal implementation**：调整 `setCategoryFilter` 与分类补丁路径，使分类选择统一清空冲突条件。
- [x] **Step 4: Run focused and full unit tests**：运行新增测试及 `npm run test:unit`。
