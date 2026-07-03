# Documentation Report: Autoforge

**Date:** 2026-07-03（全量校验）  
**Project Type:** CODING (Electron + Vue 3 + Python runtime)  
**Trigger:** `/doc` — default mode (discover · validate · sync)

## Coverage

| 类别 | 数量 | 已文档化 | 覆盖率 |
|------|------|----------|--------|
| 用户面向文档（README、CHANGELOG、版本说明、架构、script-spec） | 7 文件 | 7 | **100%** |
| 版本说明 vs package.json | 1.10.0 | 1.10.0 | **同步** |
| 内部 service API（逐模块） | ~20 模块 | 架构表摘要 | ~85% |

**综合用户面向覆盖率：~95%**

## Generated / Updated（本次）

- `docs/v1.10.0.md` — **新建** 数据隔离、迁移规则、运行确认、构建命令
- `docs/CHANGELOG.md` — **新增** [1.10.0] 条目
- `docs/architecture.md` — **更新** AppEnv/userData 表、`app-data-root` 模块、已交付能力
- `docs/v1.9.0.md` — **标注** 数据目录已被 v1.10.0 取代
- `docs/script-spec.md` — **新增**「平台数据目录」小节；移除不存在的 `crowdsourcing-token` 示例引用
- `README.md` — **同步** 版本 1.10.0、信任块路径、数据目录表、`npm run prod`

## Discover — 代码变更未文档化项（已处理）

| 变更 | 来源 commit | 文档动作 |
|------|-------------|----------|
| dev/prod userData 隔离 | f02ae2c, f4787d0 | v1.10.0.md + architecture + README |
| 运行二次确认 | 50fadcc | v1.10.0.md + architecture + README |
| `npm run prod` | package.json | v1.10.0.md + README |
| electron-vite mode | electron.vite.config.ts | v1.10.0.md CHANGELOG |

## Gaps Remaining

- `docs/v1.0.0.md` 保留 JSON 扁平布局与 `hello-scriptbox` 引用（历史快照， intentional）
- 内部 API（`app-data-root` 各函数）无独立 API 文档（架构表已摘要）

## Validation Issues（已修复）

| 问题 | 状态 |
|------|------|
| package.json `1.10.0` vs README badge `1.9.0` | ✅ |
| README trust 块仍写 `%APPDATA%/autoforge/` | ✅ |
| CHANGELOG 缺少 1.10.0 | ✅ |
| architecture 版本仍标注 1.9.0 | ✅ |

## Next Steps

- [ ] 为 v1.2.0 / v1.6.0 补充独立版本说明（可选）
- [ ] 提交 package.json 与文档变更（用户未请求 commit）
