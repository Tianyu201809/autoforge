# GitHub CI/CD 多平台发版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打 `v*` tag 后，在 GitHub Actions 上为 Windows / macOS / Linux（各 x64 + arm64）构建 NSIS / DMG / AppImage，并发布到公开 GitHub Release。

**Architecture:** 单一 workflow `.github/workflows/release.yml`：6 个原生 runner 矩阵 job 各自 `npm ci --ignore-scripts` → icons → browsers → electron-vite build → electron-builder → Artifact；全部成功后由 publish job 用 `softprops/action-gh-release@v2` 汇总上传。`package.json` 的 `build` 扩展 `mac`/`linux`；CI 不改版本号、不签名。

**Tech Stack:** GitHub Actions、Node 20、electron-vite、electron-builder 25、softprops/action-gh-release@v2、Playwright Chromium（`resources/browsers`）

**Spec:** `docs/superpowers/specs/2026-07-10-github-cicd-release-design.md`

## Global Constraints

- 仅 `v*` tag 触发；不做 PR/push 安装包构建
- 不做代码签名；CI 设 `CSC_IDENTITY_AUTO_DISCOVERY=false`
- 包格式固定：Win NSIS、Mac DMG、Linux AppImage；架构均为 x64 + arm64
- Release 直接公开；tag 名含 `-` 时 `prerelease: true`
- CI 不修改 `package.json` version；使用 `GITHUB_TOKEN`，无需额外 Secrets
- `npm ci --ignore-scripts` 后只跑一次 `install:browsers`
- YAGNI：无 lint workflow、无 electron-updater、无自动 bump 版本

---

## File Structure

| 文件 | 职责 |
|------|------|
| `package.json` | 扩展 `build.mac` / `build.linux`；新增 `dist:mac` / `dist:linux` 脚本 |
| `.github/workflows/release.yml` | tag 触发、矩阵构建、Artifact、Release 发布 |
| `README.md` | Install 节补充 Releases 下载与未签名说明 |

不修改：`scripts/after-pack.mjs`、`scripts/install-browsers.mjs`、`build.win` / `nsis` 现有行为。

---

### Task 1: 扩展 electron-builder 的 mac / linux 配置

**Files:**
- Modify: `package.json`（`scripts` 与 `build` 段）

**Interfaces:**
- Consumes: 现有 `build.win` / `build.nsis` / `extraResources`
- Produces: `build.mac`、`build.linux`；脚本 `dist:mac`、`dist:linux`（本地可选；CI 直接调 electron-builder）

- [ ] **Step 1: 在 `scripts` 中于 `dist:win` 后增加 mac/linux 脚本**

将：

```json
    "dist:win": "npm run generate:icons && npm run install:browsers && npm run build && electron-builder --win",
```

改为：

```json
    "dist:win": "npm run generate:icons && npm run install:browsers && npm run build && electron-builder --win",
    "dist:mac": "npm run generate:icons && npm run install:browsers && npm run build && electron-builder --mac",
    "dist:linux": "npm run generate:icons && npm run install:browsers && npm run build && electron-builder --linux",
```

- [ ] **Step 2: 在 `build.nsis` 对象之后、`build` 闭合之前插入 `mac` 与 `linux`**

在 `"nsis": { ... }` 块结束后添加逗号，并插入：

```json
    "mac": {
      "target": [
        {
          "target": "dmg",
          "arch": ["x64", "arm64"]
        }
      ],
      "category": "public.app-category.developer-tools",
      "identity": null
    },
    "linux": {
      "target": [
        {
          "target": "AppImage",
          "arch": ["x64", "arm64"]
        }
      ],
      "category": "Utility"
    }
```

保持现有 `win` / `nsis` / `files` / `extraResources` 不变。

- [ ] **Step 3: 验证 JSON 合法且字段存在**

Run（PowerShell，仓库根目录）：

```powershell
node -e "const p=require('./package.json'); if(!p.build.mac||!p.build.linux) process.exit(1); if(!p.scripts['dist:mac']||!p.scripts['dist:linux']) process.exit(1); console.log('ok', p.build.mac.target[0].target, p.build.linux.target[0].target)"
```

Expected: `ok dmg AppImage`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: add electron-builder mac and linux targets"
```

---

### Task 2: 新增 release workflow（矩阵构建 + 发布）

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: Task 1 的 `build.mac` / `build.linux`；现有 `generate:icons`、`install:browsers`、`build` 脚本
- Produces: tag `v*` 触发时 6 平台 Artifact + 公开 GitHub Release 附件

- [ ] **Step 1: 创建目录并写入完整 workflow**

创建 `.github/workflows/release.yml`，内容必须为：

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

env:
  CSC_IDENTITY_AUTO_DISCOVERY: "false"

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - job_id: win-x64
            os: windows-latest
            eb_args: "--win --x64"
          - job_id: win-arm64
            os: windows-latest
            eb_args: "--win --arm64"
          - job_id: mac-x64
            os: macos-latest
            eb_args: "--mac --x64"
          - job_id: mac-arm64
            os: macos-latest
            eb_args: "--mac --arm64"
          - job_id: linux-x64
            os: ubuntu-latest
            eb_args: "--linux --x64"
          - job_id: linux-arm64
            os: ubuntu-24.04-arm
            eb_args: "--linux --arm64"

    name: build-${{ matrix.job_id }}
    runs-on: ${{ matrix.os }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm

      - name: Install Linux AppImage dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libfuse2 || sudo apt-get install -y libfuse2t64 || true

      - name: Install dependencies
        run: npm ci --ignore-scripts

      - name: Generate icons
        run: npm run generate:icons

      - name: Install Playwright Chromium
        run: npm run install:browsers

      - name: Build app
        run: npm run build

      - name: Package with electron-builder
        run: npx electron-builder ${{ matrix.eb_args }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: autoforge-${{ matrix.job_id }}
          path: |
            release/*.exe
            release/*.dmg
            release/*.AppImage
            release/*.yml
            release/*.yaml
          if-no-files-found: error
          retention-days: 14

  publish:
    name: publish-release
    needs: build
    runs-on: ubuntu-latest

    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: dist-upload
          merge-multiple: true

      - name: List release files
        run: find dist-upload -type f | sort

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: ${{ github.ref_name }}
          draft: false
          prerelease: ${{ contains(github.ref_name, '-') }}
          generate_release_notes: true
          files: |
            dist-upload/**/*.exe
            dist-upload/**/*.dmg
            dist-upload/**/*.AppImage
            dist-upload/**/*.yml
            dist-upload/**/*.yaml
          fail_on_unmatched_files: false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

说明：

- `fail-fast: false` 便于一次看清多平台失败；publish 仍 `needs: build`，矩阵任一失败则 publish 不跑
- `upload-artifact` 用 glob，避免上传整个 `release/` 中间目录
- `merge-multiple: true` 把多 Artifact 摊到 `dist-upload/`
- `fail_on_unmatched_files: false`：未生成 yml 不导致发布失败；主安装包由 build 的 `if-no-files-found: error` 保证

- [ ] **Step 2: 本地做结构自检**

Run：

```powershell
Test-Path .github/workflows/release.yml
Select-String -Path .github/workflows/release.yml -Pattern "ubuntu-24.04-arm|softprops/action-gh-release@v2|npm ci --ignore-scripts|CSC_IDENTITY_AUTO_DISCOVERY" | ForEach-Object { $_.Line }
```

Expected: 文件存在；输出中含上述四类关键字符串。

若本机有 `actionlint`，可额外运行 `actionlint .github/workflows/release.yml`（无则跳过）。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add multi-platform release workflow on v* tags"
```

---

### Task 3: 更新 README 安装与发版说明

**Files:**
- Modify: `README.md`（`## Install` 及相关命令表）

**Interfaces:**
- Consumes: Task 2 的发版行为（GitHub Releases、未签名）
- Produces: 用户可从 README 找到预构建包与 macOS 未签名提示

- [ ] **Step 1: 更新「环境要求」与安装/打包小节**

在 `## Install` 中：

1. 将「Windows x64（当前主要目标平台）」改为多平台预构建说明
2. 在「开发模式」之前插入「预构建安装包（推荐）」小节，内容包含：
   - 链接：`https://github.com/Tianyu201809/autoforge/releases`
   - 表格：Windows NSIS `.exe` / macOS `.dmg` / Linux `.AppImage`
   - 发版一句：改 `version` 后推送 `v*` tag 到 GitHub
   - 未签名提示（macOS 右键打开 / 系统设置允许）
3. 将「打包安装程序」改为「本地打包」，命令包含：

```bash
npm run dist:win     # Windows NSIS → release/
npm run dist:mac     # macOS DMG（需在 macOS 上）
npm run dist:linux   # Linux AppImage（需在 Linux 上）
```

- [ ] **Step 2: 更新「其他命令」表**

在 details 表格中增加：

| 命令 | 说明 |
|------|------|
| `npm run dist:mac` | 打包 macOS DMG → `release/` |
| `npm run dist:linux` | 打包 Linux AppImage → `release/` |

- [ ] **Step 3: 轻量核对**

Run：

```powershell
Select-String -Path README.md -Pattern "GitHub Releases|dist:mac|未代码签名|AppImage" | ForEach-Object { $_.LineNumber.ToString() + ': ' + $_.Line.Trim() }
```

Expected: 至少各命中一次。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document GitHub Releases and multi-platform packages"
```

---

### Task 4: 端到端验证清单（推送后）

**Files:**
- 无代码改动（验证与可选清理）

**Interfaces:**
- Consumes: Task 1–3 已合并并 push 到 `github` remote 的提交
- Produces: 确认 Actions 与 Release 符合规格成功标准

- [ ] **Step 1: 确认改动已在 GitHub 上**

```bash
git push github HEAD
```

Expected: push 成功；仓库出现 `.github/workflows/release.yml`。

- [ ] **Step 2: 推送测试 tag（可选但推荐）**

仅在用户同意消耗 Actions 分钟数时执行：

```bash
git tag v0.0.0-ci-test
git push github v0.0.0-ci-test
```

然后在 GitHub → Actions → Release 观察 6 个 `build-*` job 与 `publish-release`。

Expected：

- 6 个 build 成功
- Release `v0.0.0-ci-test` 为 **prerelease**（因 tag 含 `-`）
- 附件含 6 个主安装包（`.exe`×2、`.dmg`×2、`.AppImage`×2）

- [ ] **Step 3: 清理测试 Release/tag（若执行了 Step 2）**

```bash
gh release delete v0.0.0-ci-test --yes
git push github :refs/tags/v0.0.0-ci-test
git tag -d v0.0.0-ci-test
```

- [ ] **Step 4: 正式发版提醒（不在本任务自动执行）**

正式版本流程（规格 §8）：改 `version` → commit/push → `git tag vX.Y.Z && git push github vX.Y.Z` → 抽测主力平台安装包。

本任务无额外 commit。

---

## Spec coverage self-check

| 规格要求 | 对应任务 |
|----------|----------|
| `v*` tag → Release | Task 2 |
| Win/Mac/Linux × x64/arm64 | Task 2 matrix |
| NSIS / DMG / AppImage | Task 1 + Task 2 |
| 无签名 + CSC 关闭 | Task 2 `env` |
| `npm ci --ignore-scripts` + 单次 browsers | Task 2 |
| softprops + 非 draft + `-` → prerelease | Task 2 publish |
| package.json mac/linux | Task 1 |
| README Releases + 未签名 | Task 3 |
| 人工发版 / 测试 tag | Task 4 |
| 不做 lint workflow / updater / 自动 bump | 无任务（刻意省略） |
