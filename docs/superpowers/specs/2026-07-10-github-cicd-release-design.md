# GitHub CI/CD 多平台发版 — 设计规格

**日期**：2026-07-10  
**状态**：已批准（方案 1）  
**决策**：原生 OS 矩阵构建 + Artifact 汇总 + `softprops/action-gh-release` 发布到 GitHub Releases；暂不代码签名

---

## 1. 背景与目标

Autoforge 是 Electron（electron-vite + electron-builder）桌面应用。本地已有 `dist` / `dist:win`，`package.json` 的 `build` 仅配置了 Windows NSIS（x64）。仓库已连接 GitHub（`github` remote → `Tianyu201809/autoforge`），尚无 `.github/workflows`。

**目标**：

1. 在 GitHub Actions 上构建可执行安装包，不再依赖本机打包作为正式发版路径
2. 支持 Windows、macOS、Linux 三端
3. 每端覆盖 **x64** 与 **arm64**（共 6 份产物）
4. 打 `v*` tag 后自动创建/更新 **公开** GitHub Release 并上传安装包

**非目标（本期不做）**：

- 代码签名 / macOS 公证 / Windows Authenticode
- PR / push 触发的 lint-only 或日常构建 workflow
- 自动 bump `package.json` version、changelog bot
- electron-updater 自动更新渠道
- 额外安装包格式（ZIP、Deb、portable 等）

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 触发与分发 | 推送 `v*` tag → 构建 → 上传 GitHub Releases |
| 代码签名 | 不做；macOS 用户可能需手动允许未签名应用 |
| 架构 | Win / Mac / Linux 均 x64 + arm64 |
| 包格式 | Windows NSIS、macOS DMG、Linux AppImage |
| Release 可见性 | 直接发布（非 draft）；tag 含 `-`（如 `v1.14.0-beta.1`）时标为 prerelease |
| 编排方式 | 方案 1：原生矩阵 + Artifact + `softprops/action-gh-release` |

---

## 3. 架构概览

```
git push tag vX.Y.Z
        │
        ▼
.github/workflows/release.yml
        │
        ├─ build (matrix, 6 jobs, parallel)
        │     checkout → Node 20 → npm ci --ignore-scripts
        │     → electron install.js → generate:icons → install:browsers
        │     → electron-vite build → electron-builder --<os> --<arch>
        │     → upload-artifact (release 目录产物)
        │
        └─ publish (needs: all builds)
              download-artifact → 过滤安装包
              → softprops/action-gh-release（公开 Release）
```

**版本约定**：CI **不修改** `package.json` 的 `version`。打 tag 前必须已提交正确版本；Release 的 tag/名称与推送的 tag 一致。

**权限**：`permissions.contents: write`；使用默认 `GITHUB_TOKEN`，无需额外 Secrets。

---

## 4. 构建矩阵

| Job id | Runner | electron-builder 参数 | 期望产物 |
|--------|--------|----------------------|----------|
| win-x64 | `windows-latest` | `--win --x64` | NSIS `.exe` |
| win-arm64 | `windows-latest` | `--win --arm64` | NSIS `.exe` |
| mac-x64 | `macos-latest` | `--mac --x64` | `.dmg` |
| mac-arm64 | `macos-latest` | `--mac --arm64` | `.dmg` |
| linux-x64 | `ubuntu-latest` | `--linux --x64` | `.AppImage` |
| linux-arm64 | `ubuntu-24.04-arm` | `--linux --arm64` | `.AppImage` |

**说明**：

- Windows arm64 在 x64 runner 上由 electron-builder 交叉打包（官方支持）
- Linux arm64 使用原生 `ubuntu-24.04-arm`，避免 QEMU，并保证 Playwright Chromium 下载到正确架构
- 每个 job 在本机执行 `npm run install:browsers`（`PLAYWRIGHT_BROWSERS_PATH=resources/browsers`），与现有 `extraResources` 打包路径一致
- `scripts/after-pack.mjs` 仅处理 Windows 图标嵌入，矩阵下无需改逻辑

**每个 build job 步骤（顺序）**：

1. `actions/checkout@v4`
2. `actions/setup-node@v4`（Node 20，`cache: npm`）
3. `npm ci --ignore-scripts`（跳过 `postinstall` 装浏览器，避免与步骤 5 重复下载；同时也会跳过 electron 的二进制下载）
4. `node node_modules/electron/install.js`（补回 Electron 二进制，供 electron-builder 打包）
5. `npm run generate:icons`
6. `npm run install:browsers`（仅此一次，按当前 runner OS/架构写入 `resources/browsers`）
7. `npm run build`（electron-vite production）
8. `npx electron-builder <platform-flags>`（`CSC_IDENTITY_AUTO_DISCOVERY=false` 关闭签名探测）
9. `actions/upload-artifact@v4`，name 按 job id 区分，path 指向 `release/` 下本平台产物

Linux AppImage 构建若需要系统依赖（如 `libfuse2`），仅在 Linux job 中按 electron-builder 当前文档安装最小依赖。

**产物命名**：依赖 electron-builder 默认命名（含产品名、版本、非默认架构后缀），保证 6 份文件名互不覆盖，便于同一 Release 并存。

---

## 5. electron-builder / package.json 改动

在现有 `build.win` / `build.nsis` 旁扩展（保持 Windows 本地 `dist:win` 行为不变）：

```json
"mac": {
  "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }],
  "category": "public.app-category.developer-tools",
  "identity": null
},
"linux": {
  "target": [{ "target": "AppImage", "arch": ["x64", "arm64"] }],
  "category": "Utility"
}
```

可选本地脚本（CI 可不依赖，直接调 electron-builder）：

- `dist:mac`：icons + browsers + build + `electron-builder --mac`
- `dist:linux`：icons + browsers + build + `electron-builder --linux`

`build.files` / `extraResources`（含 `resources/browsers`、examples、python runtime、skills）保持现状；CI 与本地打包内容一致。

环境变量（CI build job）：

- `CSC_IDENTITY_AUTO_DISCOVERY=false`（避免 macOS 上尝试签名）
- 不设置 Apple / Windows 签名相关 Secrets

---

## 6. Publish job

- `needs`：全部 6 个 build job
- 下载全部 Artifact
- **上传到 Release 的文件**：`.exe`、`.dmg`、`.AppImage`；若存在同名 `.yml` / `.yaml`（latest*.yml）可一并上传；**排除** `.blockmap`、未打包目录、日志
- 使用 `softprops/action-gh-release@v2`：
  - `tag_name`: `${{ github.ref_name }}`
  - `draft: false`
  - `prerelease`: tag 名称包含 `-` 时为 `true`，否则 `false`
  - `generate_release_notes: true`
  - `files`: 过滤后的产物路径（glob，例如 `dist-upload/**/*.{exe,dmg,AppImage,yml,yaml}`）
  - 同 tag 重跑时更新同一 Release 的附件（允许覆盖已有 asset）

任一 build 失败则 publish 不执行；已成功 job 的 Artifact 仍可在 Actions 中下载用于排查。不实现自动重试循环；人工使用 Re-run failed jobs。

---

## 7. 错误处理与约束

| 场景 | 行为 |
|------|------|
| `npm ci` / build / electron-builder 失败 | 该 job 失败；无正式 Release 附件集更新 |
| `install:browsers` 失败 | 该 job 失败（沿用脚本内官方 CDN → npmmirror 回退） |
| 部分平台成功、部分失败 | 不跑 publish；避免发半套正式包 |
| 同 tag 重跑全部成功 | 更新同一 Release 附件 |
| macOS Gatekeeper | 预期：未签名；README 注明「右键打开 / 系统设置允许」 |
| 产物体积 | 含 Chromium，单包较大；接受，不在本期做「可选不捆绑浏览器」 |

---

## 8. 人工发版流程（成功标准）

1. 将 `package.json` 的 `version` 改为目标版本（及如需的 `docs/CHANGELOG` / 版本说明）
2. 提交并 push 到 GitHub（`github` remote）
3. `git tag vX.Y.Z && git push github vX.Y.Z`
4. 在 GitHub Actions 观察 `release` workflow；全部绿后 Release 页出现 6 个安装包
5. 抽测：至少下载当前主力平台安装包安装/打开一次

**成功标准**：对任意新 `v*` tag，Actions 产出 Win/Mac/Linux × x64/arm64 共 6 个安装包，并出现在对应公开 GitHub Release 中。

---

## 9. 文档改动

- README「Install」：补充从 GitHub Releases 下载预构建安装包；列出三端格式；注明未代码签名（尤其 macOS）
- 不新增独立 CI 运维长文；本规格即设计依据

---

## 10. 测试计划（实现阶段）

- 本地：扩展 `build.mac` / `build.linux` 后，在可用机器上至少验证一种非 Windows 目标的配置解析（或 dry-run / 文档对照），确保 `package.json` 合法
- CI：推送测试 tag（如 `v0.0.0-ci-test`）验证矩阵与 Release；验证通过后删除测试 Release/tag（可选）
- 确认 Artifact 过滤不会漏传主安装包或误传目录

---

## 11. 实现范围清单

| 交付物 | 说明 |
|--------|------|
| `.github/workflows/release.yml` | tag 触发、矩阵 build、publish |
| `package.json` `build.mac` / `build.linux` | 及可选 `dist:mac` / `dist:linux` |
| README 安装说明 | Releases + 未签名提示 |
| 本规格文档 | `docs/superpowers/specs/2026-07-10-github-cicd-release-design.md` |
