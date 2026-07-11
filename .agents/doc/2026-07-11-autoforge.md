# Documentation Report: Autoforge

**Date:** 2026-07-11  
**Project Type:** CODING (Electron + Vue 3 + Python runtime)  
**Trigger:** `/doc` — sync user-facing docs after Hub local-install (v1.15.0)

## Coverage

| 类别 | 数量 | 已文档化 | 覆盖率 |
|------|------|----------|--------|
| 用户面向文档（README、CHANGELOG、版本说明、架构、script-spec） | 同步至 1.15.0 | 是 | **100%** |
| 版本说明 vs package.json | 1.15.0 | 1.15.0 | **同步** |
| Hub 桥内部 API | 2 模块 | 架构表 + 版本说明 + 规格 | **摘要级** |

**综合用户面向覆盖率：~95%**

## Generated / Updated（本次）

| 文件 | 动作 |
|------|------|
| `package.json` | version → **1.15.0** |
| `docs/v1.15.0.md` | **新建** Hub 一键安装说明 |
| `docs/CHANGELOG.md` | **新增** [1.15.0]；补记 [1.14.0] CI 发版、[1.13.0] UI |
| `docs/architecture.md` | 版本 1.15.0、`hub-*` 模块、安装数据流、路线图调整 |
| `docs/script-spec.md` | **新增**「以 zip 分发」节 |
| `README.md` | badge / 导入方式 / 信任表网络说明 / FAQ / 文档表 |
| `docs/superpowers/specs/2026-07-11-hub-local-install-design.md` | 状态 → 已实现 |
| `docs/superpowers/specs/2026-07-11-hub-local-install-hub-side-design.md` | 状态注明桌面端已落地 |

## Discover — 已处理缺口

| 变更 | 文档动作 |
|------|----------|
| Hub localhost 桥 + zip 导入 | v1.15.0 + CHANGELOG + architecture + README + script-spec |
| package.json 仍为 1.14.0 / 文档停在 1.11.0 | 升至 1.15.0 并全量同步 |
| 1.13 / 1.14 无 CHANGELOG | 补记摘要条目 |

## Gaps Remaining

- `docs/v1.13.0.md` / `docs/v1.14.0.md` 未单独成文（CHANGELOG 已覆盖；与历史「非每个小版本都有独立说明」一致）
- Hub 仓库侧实现文档不在本仓库（规格已独立成文供拷贝）
- 侧边栏「脚本市场」仍为占位，未写成已交付能力

## Validation Issues（已修复）

| 问题 | 状态 |
|------|------|
| architecture / README 仍标 1.11.0 | ✅ → 1.15.0 |
| CHANGELOG 缺 1.13–1.15 | ✅ |
| script-spec 无 zip / Hub 分发约定 | ✅ |
| 设计规格仍写「已批准」未标实现 | ✅ 桌面端 |

## Next Steps

- [ ] 用户确认后提交文档与 `package.json` version bump
- [ ] Hub 仓库按 Hub 端规格实现后，可在两边规格中互链实现 PR
