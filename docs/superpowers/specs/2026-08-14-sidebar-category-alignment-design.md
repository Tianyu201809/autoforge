# Sidebar Category Alignment Design

## Goal

Align top-level category rows with the category heading while retaining indentation for child categories, and make the category-management affordance explicit with a pencil icon.

## Layout

The alignment target is the category dot, not only the row boundary. Each top-level category dot will begin on the same left edge as the category heading. `CategoryTreeNodes` will remove the fixed root padding and will render an expansion control only for categories that have children. That control is positioned to the left of the dot, so it cannot shift the category label.

Child categories retain the existing `depth * 12px` indentation. The expansion control remains available for parent categories and retains its current toggle behavior.

The category list rows will extend `4px` beyond the category section on each horizontal side, matching the `8px` sidebar gutter used by the primary navigation. Category node content receives an equal `4px` compensation, so widening the active background does not move the aligned root dot or any child content.

## Category Management Control

The existing category-management button keeps its position, tooltip, color, dimensions, and click handler. Its Lucide `Plus` glyph changes to `Pencil`, matching the action of opening category management rather than creating a category directly.

## Scope And Verification

Only the sidebar category presentation changes. Category selection, expand/collapse, context-menu actions, and category management behavior remain unchanged. Focused source assertions will guard the root alignment, child indentation, matching navigation gutter, conditional expansion control, and pencil icon; lint and a production build will confirm the renderer still compiles.
