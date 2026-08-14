# Tray Icon Size Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the Windows tray icon so its visible artwork fills a 30×30 area inside a centered 32×32 transparent canvas.

**Architecture:** Keep Electron's tray loading logic unchanged and fix the source asset pipeline. Extend the existing Sharp-based icon generator with an exported tray-image builder that trims alpha padding, scales the artwork proportionally, centers it with a 1px minimum safety margin, and writes the committed tray PNG.

**Tech Stack:** Node.js ESM, Sharp, Node test runner, Electron build tooling

## Global Constraints

- The tray PNG canvas must be exactly 32×32 pixels.
- The visible alpha bounds must fit within 30×30 pixels and be centered with opposite margins differing by at most 1 pixel.
- Keep the existing blue circle, orange forge mark, and transparent background unchanged.
- Do not modify the application icon, installer icon, title-bar icon, floating-ball icon, tray behavior, or tray menu.
- Do not add dependencies.

---

### Task 1: Generate a centered, edge-trimmed tray icon

**Files:**
- Create: `scripts/generate-icons.test.mjs`
- Modify: `scripts/generate-icons.mjs:1-53`
- Modify: `package.json:17`
- Regenerate: `build/icon-tray.png`

**Interfaces:**
- Consumes: `src/renderer/src/assets/logo-mark.png` as the existing brand source image.
- Produces: `buildTrayIcon(input?: string | Buffer): Promise<Buffer>`, `TRAY_SIZE = 32`, and `TRAY_CONTENT_SIZE = 30` from `scripts/generate-icons.mjs`.
- Produces: `build/icon-tray.png`, a 32×32 PNG whose non-transparent bounds fit within 30×30 and are centered.

- [ ] **Step 1: Write the failing tray generation test**

Create `scripts/generate-icons.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import {
  buildTrayIcon,
  TRAY_CONTENT_SIZE,
  TRAY_SIZE
} from './generate-icons.mjs'

function alphaBounds(data, width, height) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  assert.ok(maxX >= 0 && maxY >= 0, 'tray icon must contain visible pixels')
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

test('buildTrayIcon trims alpha padding and centers the visible artwork', async () => {
  const source = await sharp({
    create: {
      width: 16,
      height: 12,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      {
        input: {
          create: {
            width: 12,
            height: 8,
            channels: 4,
            background: { r: 20, g: 40, b: 80, alpha: 1 }
          }
        },
        left: 2,
        top: 2
      }
    ])
    .png()
    .toBuffer()

  const tray = await buildTrayIcon(source)
  const { data, info } = await sharp(tray).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bounds = alphaBounds(data, info.width, info.height)
  const margins = {
    left: bounds.x,
    right: info.width - bounds.x - bounds.width,
    top: bounds.y,
    bottom: info.height - bounds.y - bounds.height
  }

  assert.equal(info.width, TRAY_SIZE)
  assert.equal(info.height, TRAY_SIZE)
  assert.ok(bounds.width <= TRAY_CONTENT_SIZE)
  assert.ok(bounds.height <= TRAY_CONTENT_SIZE)
  assert.equal(Math.max(bounds.width, bounds.height), TRAY_CONTENT_SIZE)
  assert.ok(Math.abs(margins.left - margins.right) <= 1)
  assert.ok(Math.abs(margins.top - margins.bottom) <= 1)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
$runtimeNode = 'C:\Users\Zhang Tianyu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $runtimeNode --test scripts/generate-icons.test.mjs
```

Expected: FAIL because `scripts/generate-icons.mjs` does not export `buildTrayIcon`, `TRAY_SIZE`, or `TRAY_CONTENT_SIZE`.

- [ ] **Step 3: Add tray generation to the existing icon script**

Update `scripts/generate-icons.mjs` with the following complete implementation:

```js
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const currentFile = fileURLToPath(import.meta.url)
const root = join(dirname(currentFile), '..')
const buildDir = join(root, 'build')
const sourcePath = join(root, 'src/renderer/src/assets/logo-mark.png')
const pngPath = join(buildDir, 'icon.png')
const icoPath = join(buildDir, 'icon.ico')
const trayPath = join(buildDir, 'icon-tray.png')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const OUTPUT_SIZE = 1024
export const TRAY_SIZE = 32
export const TRAY_CONTENT_SIZE = 30

async function buildFromSource() {
  return sharp(sourcePath)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3
    })
    .png({ compressionLevel: 9, quality: 100 })
    .toBuffer()
}

export async function buildTrayIcon(input = sourcePath) {
  const artwork = await sharp(input)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(TRAY_CONTENT_SIZE, TRAY_CONTENT_SIZE, {
      fit: 'inside',
      kernel: sharp.kernel.lanczos3
    })
    .png()
    .toBuffer()
  const { width, height } = await sharp(artwork).metadata()

  if (!width || !height) throw new Error('Unable to determine tray artwork dimensions')

  return sharp({
    create: {
      width: TRAY_SIZE,
      height: TRAY_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      {
        input: artwork,
        left: Math.floor((TRAY_SIZE - width) / 2),
        top: Math.floor((TRAY_SIZE - height) / 2)
      }
    ])
    .png({ compressionLevel: 9, quality: 100 })
    .toBuffer()
}

async function writeIco(pngBuffer) {
  const icoBuffers = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(pngBuffer)
        .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer()
    )
  )

  await writeFile(icoPath, await pngToIco(icoBuffers))
}

async function main() {
  await mkdir(buildDir, { recursive: true })

  const png = await buildFromSource()
  await writeFile(pngPath, png)
  await writeFile(trayPath, await buildTrayIcon())
  await writeIco(png)

  console.log('Generated from source:', pngPath)
  console.log('Generated:', icoPath)
  console.log('Generated:', trayPath)
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Add the focused test to the unit-test command**

In `package.json`, replace the exact `test:unit` command prefix `node --import tsx --test ` with `node --import tsx --test scripts/generate-icons.test.mjs `. This prepends the focused test while preserving every existing test path unchanged.

```json
"test:unit": "node --import tsx --test scripts/generate-icons.test.mjs src/shared/category-tree.test.ts"
```

The code block shows the new prefix through the first existing test path; keep the remainder of the current command after `src/shared/category-tree.test.ts` byte-for-byte unchanged.

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```powershell
$runtimeNode = 'C:\Users\Zhang Tianyu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $runtimeNode --test scripts/generate-icons.test.mjs
```

Expected: one passing test and zero failures.

- [ ] **Step 6: Regenerate the committed tray asset**

Run:

```powershell
$runtimeDir = 'C:\Users\Zhang Tianyu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$npmCli = 'C:\nvm\nodejs\node_modules\npm\bin\npm-cli.js'
$env:Path = "$runtimeDir;$env:Path"
& "$runtimeDir\node.exe" $npmCli run generate:icons
```

Expected: output lists `build/icon.png`, `build/icon.ico`, and `build/icon-tray.png` as generated files.

Run `git status --short`. Expected: `build/icon-tray.png`, the generator, the test, and `package.json` are changed. `build/icon.png` and `build/icon.ico` should have no content diff; if either changes, stop and investigate the unrelated output before committing.

- [ ] **Step 7: Verify the generated tray alpha bounds**

Run:

```powershell
$runtimeNode = 'C:\Users\Zhang Tianyu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
@'
const sharp = require('sharp')

;(async () => {
  const { data, info } = await sharp('build/icon-tray.png')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  console.log({
    canvas: `${info.width}x${info.height}`,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  })
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
'@ | & $runtimeNode -
```

Expected: `canvas` is `32x32`; bounds width and height are no larger than 30; the left/right and top/bottom margins differ by at most 1 pixel.

- [ ] **Step 8: Run all automated verification**

Run:

```powershell
$runtimeDir = 'C:\Users\Zhang Tianyu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$npmCli = 'C:\nvm\nodejs\node_modules\npm\bin\npm-cli.js'
$env:Path = "$runtimeDir;$env:Path"
& "$runtimeDir\node.exe" $npmCli run test:unit
& "$runtimeDir\node.exe" $npmCli run lint
& "$runtimeDir\node.exe" $npmCli run build
git diff --check
```

Expected: all tests pass, lint reports zero errors, the production build succeeds, and `git diff --check` produces no output.

- [ ] **Step 9: Verify the Windows tray appearance**

Launch the built Electron app, enable tray mode, hide the main window, and inspect the real Windows notification area at the current display scale. Confirm the blue outer circle is complete, the icon is visibly larger than before, and it is comparable to adjacent tray icons without touching the slot edges.

- [ ] **Step 10: Commit the fix**

```powershell
git add scripts/generate-icons.mjs scripts/generate-icons.test.mjs package.json build/icon-tray.png
git commit -m "fix: enlarge tray icon artwork"
```
