# Sidebar Category Alignment Design

## Goal

Align top-level category rows with the category heading while retaining indentation for child categories, and make the category-management affordance explicit with a pencil icon.

## Layout

The category tree list container will no longer offset its rows to compensate for a scrollbar. A top-level category row will therefore begin on the same left edge as the category heading. `CategoryTreeNodes` continues to calculate child padding from its existing `depth * 12px` rule, preserving the current hierarchy treatment.

## Category Management Control

The existing category-management button keeps its position, tooltip, color, dimensions, and click handler. Its Lucide `Plus` glyph changes to `Pencil`, matching the action of opening category management rather than creating a category directly.

## Scope And Verification

Only the sidebar category presentation changes. Category selection, expand/collapse, context-menu actions, and category management behavior remain unchanged. A focused source assertion will guard the alignment container classes and pencil icon; lint and a production build will confirm the renderer still compiles.
