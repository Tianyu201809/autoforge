import { AUTOFORGE_MANIFEST_VERSION, MANIFEST_FILENAME } from '../../../shared/script-contract'
import type { AiProject } from '../../../shared/ai-workspace-types'

/** Bundled with the app so every provider receives the contract without reading repository docs. */
export function makeAutoforgeDevelopmentPrompt(language: AiProject['language']): string {
  const python = language === 'python'
  const manifest = {
    autoforge: AUTOFORGE_MANIFEST_VERSION,
    name: '项目名称',
    description: '项目用途',
    version: '1.0.0',
    language,
    entry: python ? 'index.py' : 'index.mjs'
  }
  return [
    'Autoforge development requirements (mandatory baseline for creating and modifying projects):',
    `The project is a script directory package, with ${MANIFEST_FILENAME} at its root and an existing entry file. Minimal manifest: ${JSON.stringify(manifest)}. Preserve existing project metadata and structure when modifying files.`,
    'Provide a root README.md explaining purpose, configuration, usage, dependencies and any build prerequisites. Deliver working project files through the file tools, not only code blocks in chat.',
    python
      ? 'Python entry: async def run(ctx):\n    ctx.log("INFO", "开始执行")\n    return {"ok": True}\nUse Python 3.9+; no top-level business execution or command-line input. Paths: ctx.sdk.paths.script_dir and ctx.sdk.paths.user_data. Report stages with ctx.stage(name="work", label="处理中") and progress with ctx.progress(scope="task", current=1, total=1).'
      : 'JavaScript entry: export async function run(ctx) { ctx.log("INFO", "开始执行"); return { ok: true } }. Prefer index.mjs; for .js ESM set package.json type to module. No top-level business execution or command-line input. Paths: ctx.sdk.paths.scriptDir and ctx.sdk.paths.userData. Report stages with ctx.stage({ name: "work", label: "处理中" }) and progress with ctx.progress({ scope: "task", current: 1, total: 1 }).',
    'Declare persistent environment configuration in manifest.env and per-run business input in manifest.params. Each definition uses key, label, type, required, description and optional default (a string). Supported types: text, textarea, number, select, radio, checkbox, boolean, attachment. Select/radio/checkbox options are strings or {label,value} objects; secret is only for text fields.',
    'ctx.env and ctx.params contain string values. Explicitly parse numbers; compare booleans to "true"; JSON-parse checkbox and attachment array strings. Validate required input and report actionable errors. Never embed actual credentials, tokens or .env values; declare secret configuration for the user to fill in Autoforge.',
    `Declare runtime ${python ? 'pip' : 'npm'} dependencies as package/version pairs in manifest.dependencies. Autoforge installs these before script execution. Do not rely only on ${python ? 'requirements.txt' : 'package.json'} for runtime dependency declaration; never generate or bundle node_modules, .venv or caches.`,
    'For browser automation use await ctx.sdk.browser.launch() so Autoforge manages browser configuration. Set manifest.browser.headless to false for manual captcha/2FA (default false). Close pages, browsers, files and other owned resources in finally blocks. Check ctx.signal.aborted in long loops and stop promptly; use ctx.log with INFO, WARN or ERROR and avoid logging secrets.',
    python ? 'Python browser automation requires playwright in manifest.dependencies; use Python Playwright APIs such as browser.new_page().' : 'Use the browser returned by the SDK; do not launch a separate browser through an independently imported Playwright launcher.',
    'Keep manifest.entry and local imports/resources relative and inside the project; never use absolute, parent traversal or symlink paths to external files. Use manifest.export.include relative globs for dynamically loaded resources that static import analysis cannot discover. Exclude secrets and business data from exported assets.',
    'If compilation/bundling is needed, provide package.json scripts.build and set manifest.entry to the generated runnable artifact (for example dist/index.mjs). The manual import workflow runs npm run build when that script exists, then validates the package and syntax and imports it. It does not install build dependencies: document prerequisites. Without scripts.build, deliver directly runnable source. Do not build, check, or import during chat; these actions require the user to click the separate import button.'
  ].join('\n')
}
