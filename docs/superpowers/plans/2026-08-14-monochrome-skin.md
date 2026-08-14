# Monochrome Skin Pair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restrained graphite/snow monochrome skin pair that persists and renders consistently in Autoforge's main, editor, and terminal windows.

**Architecture:** Extend the existing `SkinId` catalog and pair map in `useTheme`, then provide complete semantic CSS variable sets for the two skins. Keep pre-paint HTML bootstrap logic in each renderer entry, but make all three entries recognize the same skin identifiers so popout windows do not flash or fall back to a different skin.

**Tech Stack:** Vue 3, TypeScript, Tailwind CSS 4, Electron Vite, Node test runner, Playwright/Electron visual inspection.

## Global Constraints

- Keep the existing default skins: `forge` for dark mode and `sand` for light mode.
- Store the selected skin under the existing `autoforge-skin` key.
- Use `graphite` for the dark skin and `snow` for the light skin; display them as “石墨” and “净白”.
- Keep the application chrome and card surfaces monochrome; preserve category icons, category labels, language badges, sidebar category dots, and low-saturation semantic colors.
- Do not add dependencies, alter application layout, or theme the floating ball.
- Do not change the appearance of the six existing skins.

---

### Task 1: Register and Test the Monochrome Skin Pair

**Files:**
- Modify: `src/renderer/src/composables/useTheme.ts:4-77`
- Create: `src/renderer/src/composables/useTheme.test.ts`
- Modify: `package.json:24`

**Interfaces:**
- Consumes: Existing `SkinId`, `SkinPreset`, `SKIN_PRESETS`, and `SKIN_PAIRS` theme model.
- Produces: `SkinId` values `graphite` and `snow`, exported `SKIN_PAIRS: Record<SkinId, SkinId>`, and preset metadata consumed by `SkinPicker` and `ThemeToggle`.

- [ ] **Step 1: Write the failing catalog test**

Create `src/renderer/src/composables/useTheme.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { SKIN_PAIRS, SKIN_PRESETS } from './useTheme'

test('registers a graphite and snow skin pair', () => {
  const graphite = SKIN_PRESETS.find((skin) => skin.id === 'graphite')
  const snow = SKIN_PRESETS.find((skin) => skin.id === 'snow')

  assert.deepEqual(graphite, {
    id: 'graphite',
    name: '石墨',
    tagline: '近黑灰阶，克制专注',
    mode: 'dark',
    preview: { base: '#111110', panel: '#20201f', accent: '#e7e7e2' }
  })
  assert.deepEqual(snow, {
    id: 'snow',
    name: '净白',
    tagline: '纸白墨色，清晰纯粹',
    mode: 'light',
    preview: { base: '#f7f7f4', panel: '#ffffff', accent: '#1c1c1b' }
  })
  assert.equal(SKIN_PAIRS.graphite, 'snow')
  assert.equal(SKIN_PAIRS.snow, 'graphite')
})

test('every skin pair is reciprocal', () => {
  for (const [skin, pair] of Object.entries(SKIN_PAIRS)) {
    assert.equal(SKIN_PAIRS[pair as keyof typeof SKIN_PAIRS], skin)
  }
})
```

Append the literal path `src/renderer/src/composables/useTheme.test.ts` to the existing space-delimited `test:unit` command in `package.json`, preserving every existing test path.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --import tsx --test src/renderer/src/composables/useTheme.test.ts
```

Expected: FAIL because `SKIN_PAIRS` is not exported and `graphite`/`snow` are not registered.

- [ ] **Step 3: Add the two skin records and pair mapping**

Update the union and export the pair map in `useTheme.ts`:

```ts
export type SkinId =
  | 'forge'
  | 'obsidian'
  | 'forest'
  | 'graphite'
  | 'sand'
  | 'ivory'
  | 'blossom'
  | 'snow'

export const SKIN_PAIRS: Record<SkinId, SkinId> = {
  forge: 'sand',
  sand: 'forge',
  obsidian: 'ivory',
  ivory: 'obsidian',
  forest: 'blossom',
  blossom: 'forest',
  graphite: 'snow',
  snow: 'graphite'
}
```

Insert the dark preset after `forest` and the light preset after `blossom`:

```ts
{
  id: 'graphite',
  name: '石墨',
  tagline: '近黑灰阶，克制专注',
  mode: 'dark',
  preview: { base: '#111110', panel: '#20201f', accent: '#e7e7e2' }
},
{
  id: 'snow',
  name: '净白',
  tagline: '纸白墨色，清晰纯粹',
  mode: 'light',
  preview: { base: '#f7f7f4', panel: '#ffffff', accent: '#1c1c1b' }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
node --import tsx --test src/renderer/src/composables/useTheme.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit the catalog change**

```powershell
git add package.json src/renderer/src/composables/useTheme.ts src/renderer/src/composables/useTheme.test.ts
git commit -m "feat: register monochrome skin pair"
```

---

### Task 2: Implement the Graphite and Snow Visual Tokens

**Files:**
- Modify: `src/renderer/src/assets/themes.css:301-358`
- Modify: `src/renderer/src/assets/main.css:281-324,349-403,649-661`

**Interfaces:**
- Consumes: Root attributes `data-theme="dark|light"` and `data-skin="graphite|snow"`.
- Produces: Complete existing `--sb-*` semantic variables plus `--sb-status-success`, `--sb-status-success-hover`, `--sb-status-error`, and `--sb-status-error-hover` for status controls.

- [ ] **Step 1: Add complete graphite and snow variable blocks**

Insert two selectors before the shared terminal-variable section in `themes.css`. Each block must define every variable defined by the existing skins. Use these core values and derive the remaining editor/terminal values from the same neutral ladder:

```css
[data-theme='dark'][data-skin='graphite'] {
  color-scheme: dark;
  --sb-bg-base: #111110;
  --sb-bg-panel: #151514;
  --sb-bg-surface: rgba(255, 255, 255, 0.035);
  --sb-bg-elevated: #20201f;
  --sb-bg-input: #1b1b1a;
  --sb-bg-card: #191918;
  --sb-bg-card-hover: #232321;
  --sb-bg-log: #0d0d0c;
  --sb-bg-hover: rgba(255, 255, 255, 0.07);
  --sb-bg-muted: rgba(255, 255, 255, 0.045);
  --sb-bg-inset: rgba(255, 255, 255, 0.08);
  --sb-text-primary: #f2f2ef;
  --sb-text-secondary: #c7c7c2;
  --sb-text-muted: #969691;
  --sb-text-faint: #676763;
  --sb-text-label: #deded9;
  --sb-text-inverse: #111110;
  --sb-border: #545450;
  --sb-border-subtle: #363633;
  --sb-border-input: #62625d;
  --sb-accent-bg: #e7e7e2;
  --sb-accent-solid: #e7e7e2;
  --sb-accent-text: #111110;
  --sb-accent-hover: #ffffff;
  --sb-titlebar: rgba(17, 17, 16, 0.94);
  --sb-logo-bg: #ededE9;
  --sb-logo-text: #111110;
  --sb-ring: #a8a8a2;
  --sb-grain-opacity: 0;
  --sb-glow: transparent;
  --sb-editor-bg: #0f0f0e;
  --sb-editor-toolbar: #151514;
  --sb-editor-gutter: #121211;
  --sb-editor-gutter-text: #5d5d59;
  --sb-editor-gutter-active: #b6b6b0;
  --sb-editor-line-active: rgba(255, 255, 255, 0.045);
  --sb-editor-badge: #232321;
  --sb-editor-text: #d2d2cd;
  --sb-editor-caret: #ffffff;
  --sb-editor-selection-bg: rgba(255, 255, 255, 0.15);
  --sb-hl-keyword: #c8b88c;
  --sb-hl-string: #91ad96;
  --sb-hl-comment: #676763;
  --sb-hl-number: #b89b87;
  --sb-hl-boolean: #a49eb8;
  --sb-hl-fn: #92a9b3;
  --sb-hl-key: #beb89d;
  --sb-status-success: #7f9f87;
  --sb-status-success-hover: #9ab5a0;
  --sb-status-error: #b77f7f;
  --sb-status-error-hover: #c99a9a;
}

[data-theme='light'][data-skin='snow'] {
  color-scheme: light;
  --sb-bg-base: #f7f7f4;
  --sb-bg-panel: #fbfbf9;
  --sb-bg-surface: rgba(255, 255, 255, 0.86);
  --sb-bg-elevated: #ffffff;
  --sb-bg-input: #ffffff;
  --sb-bg-card: rgba(255, 255, 255, 0.92);
  --sb-bg-card-hover: #ffffff;
  --sb-bg-log: #ecece8;
  --sb-bg-hover: rgba(17, 17, 16, 0.055);
  --sb-bg-muted: rgba(17, 17, 16, 0.035);
  --sb-bg-inset: rgba(17, 17, 16, 0.05);
  --sb-text-primary: #171716;
  --sb-text-secondary: #4b4b48;
  --sb-text-muted: #73736f;
  --sb-text-faint: #a1a19b;
  --sb-text-label: #292927;
  --sb-text-inverse: #ffffff;
  --sb-border: #b7b7b1;
  --sb-border-subtle: #d4d4ce;
  --sb-border-input: #9f9f99;
  --sb-accent-bg: #1c1c1b;
  --sb-accent-solid: #1c1c1b;
  --sb-accent-text: #ffffff;
  --sb-accent-hover: #000000;
  --sb-titlebar: rgba(251, 251, 249, 0.94);
  --sb-logo-bg: #1c1c1b;
  --sb-logo-text: #ffffff;
  --sb-ring: #777772;
  --sb-grain-opacity: 0;
  --sb-glow: transparent;
  --sb-editor-bg: #f4f4f1;
  --sb-editor-toolbar: #ecece8;
  --sb-editor-gutter: #efefeb;
  --sb-editor-gutter-text: #a1a19b;
  --sb-editor-gutter-active: #555551;
  --sb-editor-line-active: rgba(17, 17, 16, 0.045);
  --sb-editor-badge: rgba(17, 17, 16, 0.06);
  --sb-editor-text: #383836;
  --sb-editor-caret: #000000;
  --sb-editor-selection-bg: rgba(17, 17, 16, 0.13);
  --sb-hl-keyword: #75653e;
  --sb-hl-string: #52705a;
  --sb-hl-comment: #969691;
  --sb-hl-number: #805e49;
  --sb-hl-boolean: #655f7c;
  --sb-hl-fn: #4f6871;
  --sb-hl-key: #6d6748;
  --sb-status-success: #58745f;
  --sb-status-success-hover: #405e48;
  --sb-status-error: #915f5f;
  --sb-status-error-hover: #774747;
}
```

Normalize `#ededE9` to lowercase `#edede9` while applying the block.

- [ ] **Step 2: Route run and error states through skin-aware variables**

In `main.css`, replace each run-control `#34d399` with `var(--sb-status-success, #34d399)`, each success hover `#6ee7b7` with `var(--sb-status-success-hover, #6ee7b7)`, each state `#f87171` with `var(--sb-status-error, #f87171)`, and each error hover `#fca5a5` with `var(--sb-status-error-hover, #fca5a5)`. Change terminal errors to:

```css
.terminal-log-level-error {
  color: var(--sb-status-error, #ef4444);
}

[data-theme='dark'] .terminal-log-level-error {
  color: var(--sb-status-error, #f87171);
}
```

The fallback values preserve all six existing skins exactly.

- [ ] **Step 3: Build to catch invalid CSS or variable usage**

Run:

```powershell
npm run build
```

Expected: Electron Vite completes all main, preload, and renderer builds without errors.

- [ ] **Step 4: Commit the visual tokens**

```powershell
git add src/renderer/src/assets/themes.css src/renderer/src/assets/main.css
git commit -m "feat: style graphite and snow skins"
```

---

### Task 3: Add Responsive Picker Previews

**Files:**
- Modify: `src/renderer/src/components/SkinPicker.vue:26,58,84-153`
- Modify: `src/renderer/src/components/SkinPreviewIcon.vue:109-130`

**Interfaces:**
- Consumes: `SkinPreset` records for `graphite` and `snow`.
- Produces: Four-column desktop/two-column narrow picker grids and monochrome line-work preview icons.

- [ ] **Step 1: Make both picker groups responsive**

Replace both fixed grid declarations:

```vue
<div class="skin-picker__grid">
```

Add scoped CSS:

```css
.skin-picker__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}

@media (max-width: 760px) {
  .skin-picker__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 2: Add graphite and snow line-work icons**

Insert these branches before the `blossom` branch in `SkinPreviewIcon.vue`:

```vue
<svg
  v-else-if="skinId === 'graphite'"
  class="skin-preview-icon"
  viewBox="0 0 72 52"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <rect x="11" y="7" width="50" height="38" rx="2" fill="#191918" stroke="#545450" stroke-width="0.8" />
  <path d="M11 16 H61" stroke="#363633" />
  <path d="M25 16 V45" stroke="#363633" />
  <rect x="29" y="21" width="25" height="7" rx="1" fill="#232321" stroke="#676763" stroke-width="0.7" />
  <rect x="29" y="32" width="25" height="7" rx="1" fill="#20201f" stroke="#545450" stroke-width="0.7" />
  <path d="M15 21 H21 M15 27 H21 M15 33 H21" stroke="#969691" stroke-width="1.2" stroke-linecap="round" />
  <rect x="48" y="10" width="8" height="3" rx="0.5" fill="#e7e7e2" />
</svg>

<svg
  v-else-if="skinId === 'snow'"
  class="skin-preview-icon"
  viewBox="0 0 72 52"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <rect x="11" y="7" width="50" height="38" rx="2" fill="#ffffff" stroke="#b7b7b1" stroke-width="0.8" />
  <path d="M11 16 H61" stroke="#d4d4ce" />
  <path d="M25 16 V45" stroke="#d4d4ce" />
  <rect x="29" y="21" width="25" height="7" rx="1" fill="#f7f7f4" stroke="#b7b7b1" stroke-width="0.7" />
  <rect x="29" y="32" width="25" height="7" rx="1" fill="#fbfbf9" stroke="#d4d4ce" stroke-width="0.7" />
  <path d="M15 21 H21 M15 27 H21 M15 33 H21" stroke="#73736f" stroke-width="1.2" stroke-linecap="round" />
  <rect x="48" y="10" width="8" height="3" rx="0.5" fill="#1c1c1b" />
</svg>
```

- [ ] **Step 3: Run lint and build**

Run:

```powershell
npm run lint
npm run build
```

Expected: Both commands exit successfully; Vue recognizes every `SkinId` branch.

- [ ] **Step 4: Commit picker changes**

```powershell
git add src/renderer/src/components/SkinPicker.vue src/renderer/src/components/SkinPreviewIcon.vue
git commit -m "feat: add monochrome skin previews"
```

---

### Task 4: Keep All Renderer Windows on the Selected Skin

**Files:**
- Create: `src/renderer/theme-bootstrap.test.mjs`
- Modify: `src/renderer/index.html:7-22`
- Modify: `src/renderer/editor.html:7-16`
- Modify: `src/renderer/terminal.html:7-22`
- Modify: `package.json:24`

**Interfaces:**
- Consumes: `autoforge-skin`, `autoforge-theme`, and `scriptbox-theme` local storage values.
- Produces: Pre-paint `data-theme` and `data-skin` attributes in all three themed renderer windows.

- [ ] **Step 1: Write a failing consistency test**

Create `src/renderer/theme-bootstrap.test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const entries = ['index.html', 'editor.html', 'terminal.html']

for (const entry of entries) {
  test(`${entry} initializes graphite and snow before paint`, async () => {
    const source = await readFile(new URL(entry, import.meta.url), 'utf8')

    assert.match(source, /graphite:\s*'dark'/)
    assert.match(source, /snow:\s*'light'/)
    assert.match(source, /localStorage\.getItem\('autoforge-skin'\)/)
    assert.match(source, /setAttribute\('data-skin', skin\)/)
  })
}
```

Append `src/renderer/theme-bootstrap.test.mjs` to `test:unit` in `package.json`.

- [ ] **Step 2: Run the bootstrap test and verify it fails**

Run:

```powershell
node --test src/renderer/theme-bootstrap.test.mjs
```

Expected: 3 tests fail; the editor also lacks `autoforge-skin` and `data-skin` initialization.

- [ ] **Step 3: Use the same bootstrap in all three entry files**

In each HTML entry, use this inline script before the body renders:

```html
<script>
  ;(function () {
    var MODES = {
      forge: 'dark',
      obsidian: 'dark',
      forest: 'dark',
      graphite: 'dark',
      sand: 'light',
      ivory: 'light',
      blossom: 'light',
      snow: 'light'
    }
    var skin =
      localStorage.getItem('autoforge-skin') ||
      (function () {
        var t =
          localStorage.getItem('autoforge-theme') || localStorage.getItem('scriptbox-theme')
        if (t === 'light') return 'sand'
        if (t === 'dark') return 'forge'
        return 'forge'
      })()
    if (!MODES[skin]) skin = 'forge'
    document.documentElement.setAttribute('data-theme', MODES[skin])
    document.documentElement.setAttribute('data-skin', skin)
  })()
</script>
```

- [ ] **Step 4: Run focused and full automated checks**

Run:

```powershell
node --test src/renderer/theme-bootstrap.test.mjs
npm run test:unit
npm run build
```

Expected: 3 bootstrap tests pass, the complete unit suite passes, and the production build succeeds.

- [ ] **Step 5: Commit bootstrap consistency**

```powershell
git add package.json src/renderer/index.html src/renderer/editor.html src/renderer/terminal.html src/renderer/theme-bootstrap.test.mjs
git commit -m "fix: keep popout windows on selected skin"
```

---

### Task 5: Visual and Interaction Verification

**Files:**
- Modify only if verification reveals a monochrome-skin defect in files already listed above.

**Interfaces:**
- Consumes: Completed graphite/snow pair and the existing settings, editor, and terminal workflows.
- Produces: Verified screenshots and a clean final test run.

- [ ] **Step 1: Start the development application**

Run:

```powershell
npm run dev
```

Expected: Autoforge launches without a renderer error.

- [ ] **Step 2: Verify graphite at common desktop sizes**

Select “石墨” in Settings > 窗口与外观. Inspect the main list, detail panel, settings, code editor, and log console at approximately 1440×900 and 1024×768. Confirm:

- Main surfaces are neutral gray only.
- Active controls use light-on-dark inversion without gradients or glow.
- Card category icons, category labels, language badges, and sidebar category dots retain their existing identity colors.
- Status and syntax colors are subdued but distinguishable.
- The four-column picker has no clipping or text overlap.

- [ ] **Step 3: Verify snow and narrow picker layout**

Use the title-bar mode toggle to switch to “净白”, then narrow the settings window below 760 CSS pixels. Confirm:

- The selected skin becomes “净白” and survives reload.
- The picker changes to two columns without a lone fourth card.
- Focus rings, borders, disabled text, and input values remain visible.

- [ ] **Step 4: Verify popout windows**

Open the detached editor and terminal while each monochrome skin is active. Confirm the first painted frame and final frame both match the selected skin and do not fall back to “锻炉” or “暖纸”.

- [ ] **Step 5: Run the final checks**

Stop the development process, then run:

```powershell
npm run lint
npm run test:unit
npm run build
git diff --check
```

Expected: Every command exits successfully and `git diff --check` prints no output.

- [ ] **Step 6: Commit any verification fixes**

If verification required changes, stage only the affected monochrome files and commit:

```powershell
git add src/renderer/index.html src/renderer/editor.html src/renderer/terminal.html src/renderer/theme-bootstrap.test.mjs src/renderer/src/composables/useTheme.ts src/renderer/src/composables/useTheme.test.ts src/renderer/src/assets/themes.css src/renderer/src/assets/main.css src/renderer/src/components/SkinPicker.vue src/renderer/src/components/SkinPreviewIcon.vue package.json
git commit -m "fix: polish monochrome skin states"
```

If no files changed, do not create an empty commit.
