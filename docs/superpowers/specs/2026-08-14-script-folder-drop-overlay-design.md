# Script Folder Drop Overlay Design

## Goal

When a user drags a script folder or supported package over the script library, make the upload target unambiguous. On release, retain a visible loading state until importing either completes, is cancelled, or fails.

## Scope

The overlay belongs to the main content panel. It covers the script list and its controls, while the title bar and bottom status bar remain visible. Existing file-dialog import, toast messages, and executable-entry selection remain supported.

## Interaction States

`idle`
: No overlay is visible.

`drag-over`
: A pointer-blocking overlay covers main content. Its centered drop panel uses the active skin's background, border, text, and accent variables. It shows an upload icon, "松开鼠标上传脚本", and a short support hint.

`importing`
: Dropping a valid path starts import and replaces the drop prompt in place with a stable-size loading panel. The panel shows a spinner, "正在上传脚本", and "正在检查并导入文件，请稍候". The overlay remains until the import flow returns.

## Import Flow

1. `dragenter` with files activates `drag-over`; nested drag events are counted so moving between child elements does not flicker the overlay.
2. `dragleave` removes the state only when the final tracked drag leaves the main content panel.
3. `drop` resolves the file path using the existing resolver, starts `importFromPath`, and transitions to `importing`.
4. A successful import refreshes the script list, emits the existing success toast, and clears the overlay.
5. A failed import emits the existing error toast and clears the overlay.
6. If import inspection requires selecting an executable entry, clear the loading overlay before opening the existing executable picker. Cancelling the picker leaves no overlay.

## Component Boundaries

`MainContent` owns native drag event tracking and renders the visual overlay because it defines the main-content boundary.

`App` coordinates import execution. It receives the dropped path, marks the import active before awaiting the existing store import function, and clears loading in `finally`.

`useScriptStore` continues to own inspection, import, refresh, picker handling, and toast results. Its import method returns a completion signal so callers can distinguish completed/cancelled flows without duplicating import behavior.

`script-drop-import` keeps path resolution as a pure helper. Event binding moves out of this helper so `MainContent` can represent drag state without a second listener set.

## Accessibility And Visual Rules

The overlay has an accessible live status message. It blocks pointer input in main content while importing. It does not intercept the operating system drop event.

The overlay uses CSS variables already provided by `themes.css`; it must not hard-code a skin-specific palette. The visual transition between states changes content only, keeping the panel geometry stable and avoiding layout movement.

## Tests

Add focused tests for path helper behavior already covered where relevant, plus unit tests for drag-depth state transitions and import completion cleanup. Verify typecheck and renderer tests.
