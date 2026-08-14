# Dropped Script Selection And Category Design

## Goal

After a script is added by dropping a folder or package, assign it to the active category context and make it the selected script. The result must stay visible even when the prior view would hide it.

## Classification Rule

The active category comes from the existing `activeCategoryKey` state. When it contains a category key, the imported script is assigned to that exact category.

When `activeCategoryKey` is empty, the import is assigned to the existing `local` category, which is the application's unclassified/default local location. This intentionally overrides any category carried by the incoming package for dropped imports.

The file-dialog import path remains unchanged.

## Selection Rule

When the drop began in a category view, retain that view after import and select the resulting script.

When the drop began outside a category view, switch to the existing `all` navigation filter after a successful import. This clears status, star, archive, and other visibility constraints before selecting the imported script and opening its detail panel.

Import errors and cancelled executable-entry selection leave the current view and selection unchanged.

## Data Flow

`App` captures the active category key before invoking the dropped-import flow. It passes `categoryKey ?? 'local'` to `useScriptStore.importFromPath`.

`useScriptStore` imports the script using the current inspection and executable-picker flow. After a successful import, it persists the target category through the existing `scripts.updateMeta` API, refreshes the list, shows the existing success toast, and returns the categorized `ScriptItem`. It returns `null` for failed or cancelled imports after preserving the existing error toast behavior.

`App` clears the loading overlay in `finally`. If an item is returned, it changes to `all` only when no category was active at drop time, then calls the existing `selectScript` helper for the returned item.

## Tests

Add focused source tests proving that dropped imports supply the captured category or `local`, switch non-category views to `all`, and select only a successful returned script. Extend the existing import-flow test to cover the category update and nullable import result. Run focused renderer tests, lint, unit tests, and the production build.
